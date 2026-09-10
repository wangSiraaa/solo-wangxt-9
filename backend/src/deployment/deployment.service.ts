import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { DeploymentPlan } from '../entities/deployment-plan.entity';
import { DeploymentItem } from '../entities/deployment-item.entity';
import { DeployNode } from '../entities/deploy-node.entity';
import { NodeReceipt } from '../entities/node-receipt.entity';
import { PlanEvent } from '../entities/plan-event.entity';
import { Certificate } from '../entities/certificate.entity';
import {
  ItemStatus,
  PlanStatus,
  ReceiptKind,
} from '../domain.types';
import { SimulatorService, SimOutcome } from '../simulator/simulator.service';
import { certStatusAt } from '../cert/cert.service';
import { coversDomain } from '../cert/crypto.util';

const ROLLBACKABLE_PLAN_STATUSES: PlanStatus[] = [
  'canary_failed',
  'awaiting_approval',
  'partial',
  'paused',
  'bulk_running',
  'canary_running',
];

@Injectable()
export class DeploymentService {
  private readonly logger = new Logger('Deployment');

  constructor(
    @InjectRepository(DeploymentPlan)
    private readonly planRepo: Repository<DeploymentPlan>,
    @InjectRepository(DeploymentItem)
    private readonly itemRepo: Repository<DeploymentItem>,
    @InjectRepository(DeployNode)
    private readonly nodeRepo: Repository<DeployNode>,
    @InjectRepository(NodeReceipt)
    private readonly receiptRepo: Repository<NodeReceipt>,
    @InjectRepository(PlanEvent)
    private readonly eventRepo: Repository<PlanEvent>,
    @InjectRepository(Certificate)
    private readonly certRepo: Repository<Certificate>,
    private readonly simulator: SimulatorService,
    private readonly dataSource: DataSource,
  ) {}

  // ---------- 查询 ----------

  async listPlans() {
    const plans = await this.planRepo.find({ order: { createdAt: 'DESC' } });
    const items = await this.itemRepo.find();
    return plans.map((p) => ({ ...p, items: items.filter((i) => i.planId === p.id) }));
  }

  async getPlan(planId: string) {
    const plan = await this.planRepo.findOne({ where: { id: planId } });
    if (!plan) throw new NotFoundException('部署计划不存在');
    const items = await this.itemRepo.find({
      where: { planId },
      order: { createdAt: 'ASC' },
    });
    const receipts = await this.receiptRepo.find({
      where: { planId },
      order: { receivedAt: 'ASC' },
    });
    const events = await this.eventRepo.find({
      where: { planId },
      order: { at: 'ASC' },
    });
    return { plan, items, receipts, events };
  }

  private async recordEvent(
    planId: string,
    action: string,
    message: string,
    level: 'info' | 'warn' | 'error' = 'info',
    detail: Record<string, unknown> | null = null,
  ) {
    await this.eventRepo.save(
      this.eventRepo.create({ planId, action, message, level, detail }),
    );
  }

  // ---------- 创建计划 ----------

  async createPlan(dto: { label: string; certificateId: string; nodeIds: string[] }) {
    const cert = await this.certRepo.findOne({ where: { id: dto.certificateId } });
    if (!cert) throw new BadRequestException('目标证书不存在');
    if (certStatusAt(cert.notAfter) === 'expired') {
      throw new BadRequestException('目标证书已过期，不能用于发布');
    }

    const nodeIds = [...new Set(dto.nodeIds ?? [])];
    if (nodeIds.length === 0) throw new BadRequestException('请至少选择一个节点');
    const nodes = await this.nodeRepo.find({ where: { id: In(nodeIds) } });
    if (nodes.length !== nodeIds.length) throw new BadRequestException('部分节点不存在');

    const coverageProblems: string[] = [];
    for (const n of nodes) {
      if (!coversDomain(cert.sanDomains, n.domain)) {
        coverageProblems.push(`节点 ${n.name} 的域名 ${n.domain} 不在证书 SAN 覆盖范围内`);
      }
    }
    if (coverageProblems.length) {
      throw new BadRequestException({ message: '域名覆盖不通过', problems: coverageProblems });
    }

    const canary = nodes.filter((n) => n.type === 'canary');
    if (canary.length === 0) {
      throw new BadRequestException('所选节点中没有测试节点（canary），无法按 灰度 -> 全量 推进');
    }
    if (nodes.some((n) => n.activeCertificateId === cert.id)) {
      throw new BadRequestException('部分节点已经在运行该证书版本，无需重复建计划');
    }

    // 锁定每个节点的回滚目标：仅选择"当前仍有效 + 域名匹配"的历史版本
    const rollbackTargets: DeploymentPlan['rollbackTargets'] = {};
    const allCerts = await this.certRepo.find();
    for (const n of nodes) {
      const candidates = allCerts
        .filter(
          (c) =>
            c.id !== cert.id &&
            coversDomain(c.sanDomains, n.domain) &&
            certStatusAt(c.notAfter) !== 'expired',
        )
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      if (candidates[0]) {
        rollbackTargets[n.id] = {
          certificateId: candidates[0].id,
          fingerprint: candidates[0].fingerprintSha256,
        };
      }
    }

    const baseline: DeploymentPlan['baseline'] = {};
    for (const n of nodes) {
      baseline[n.id] = {
        certificateId: n.activeCertificateId,
        fingerprint: n.activeFingerprintSha256,
      };
    }

    const planId = await this.dataSource.transaction(async (mgr) => {
      const plan = await mgr.save(
        mgr.create(DeploymentPlan, {
          label: dto.label?.trim() || `轮换至 ${cert.label}`,
          newCertificateId: cert.id,
          baseline,
          rollbackTargets,
          status: 'draft',
        }),
      );
      const items = nodes.map((n) =>
        mgr.create(DeploymentItem, {
          planId: plan.id,
          nodeId: n.id,
          stage: n.type === 'canary' ? 'canary' : 'bulk',
          isRollback: false,
          targetCertificateId: cert.id,
          status: 'pending',
          requestToken: randomUUID().replace(/-/g, ''),
        }),
      );
      await mgr.save(items);
      await mgr.save(
        mgr.create(PlanEvent, {
          planId: plan.id,
          action: 'plan_created',
          message: `计划创建：${canary.length} 个测试节点 + ${nodes.length - canary.length} 个其余节点；回滚目标已锁定 ${Object.keys(rollbackTargets).length}/${nodes.length}`,
        }),
      );
      return plan.id;
    });
    return this.getPlan(planId);
  }

  // ---------- 回执处理 ----------

  /**
   * 节点回执 -> 状态机。重复回执（同一 requestToken 已被处理过）只记流水，不改状态。
   */
  async applyReceipt(
    planId: string,
    nodeId: string,
    token: string,
    outcome: SimOutcome,
  ): Promise<void> {
    await this.dataSource.transaction(async (mgr) => {
      // 找到该 token 对应的、尚未终结的下发条目（取最新一条）
      const item = await mgr.findOne(DeploymentItem, {
        where: { planId, nodeId },
        order: { createdAt: 'DESC' },
      });
      const receipt = mgr.create(NodeReceipt, {
        planId,
        nodeId,
        requestToken: token,
        kind: outcome.kind,
        fingerprintSha256: outcome.fingerprint,
        message: outcome.message,
      });

      if (!item || item.requestToken !== token) {
        receipt.accepted = false;
        receipt.message = '回执令牌与当前下发不匹配（过期/重复请求），忽略';
        await mgr.save(receipt);
        return;
      }
      // 超时只表示"等待窗口内结果未知"：节点迟到的成功回执是其实际版本的权威自报，
      // 应予采纳并把 timeout -> success；其余终态收到的回执一律视为重复，不覆盖结果。
      const lateSuccessAfterTimeout =
        item.status === 'timeout' && outcome.kind === 'success' && !!outcome.fingerprint;
      if (
        ['success', 'failed'].includes(item.status) ||
        (item.status === 'timeout' && !lateSuccessAfterTimeout)
      ) {
        receipt.accepted = false;
        receipt.message = `重复回执：条目已是 ${item.status}，保持原结果不变`;
        await mgr.save(receipt);
        return;
      }

      receipt.accepted = true;
      await mgr.save(receipt);
      item.ackedAt = new Date();

      if (outcome.kind === 'success' && outcome.fingerprint) {
        const targetCert = await mgr.findOne(Certificate, {
          where: { id: item.targetCertificateId },
        });
        if (targetCert && outcome.fingerprint === targetCert.fingerprintSha256) {
          item.status = 'success';
          item.reportedFingerprintSha256 = outcome.fingerprint;
          item.completedAt = new Date();
          item.errorMessage = '';
          await mgr.save(item);
          // 只有指纹与目标一致才更新节点实际版本
          await mgr.update(DeployNode, nodeId, {
            activeCertificateId: targetCert.id,
            activeFingerprintSha256: targetCert.fingerprintSha256,
            activeSince: new Date(),
            lastSeenAt: new Date(),
          });
        } else {
          item.status = 'failed';
          item.errorMessage = `回执指纹与目标证书不一致（回执=${outcome.fingerprint ?? 'null'}），保留节点实际版本`;
          await mgr.save(item);
        }
      } else {
        item.status = 'failed';
        item.reportedFingerprintSha256 = outcome.fingerprint;
        item.errorMessage = outcome.message || '节点报告失败';
        await mgr.save(item);
        await mgr.update(DeployNode, nodeId, { lastSeenAt: new Date() });
      }
    });

    // 迟到回执可能改变稳态结果，尝试把 partial / canary_failed 向前推进
    await this.recomputeSteadyState(planId);
  }

  /** 根据当前条目状态重算处于"稳态"的计划（不干预运行中/暂停/回滚态） */
  private async recomputeSteadyState(planId: string) {
    const plan = await this.planRepo.findOne({ where: { id: planId } });
    if (!plan || plan.status === 'paused' || plan.status === 'rolled_back' || plan.status === 'rollback_failed') return;
    const forward = await this.itemRepo.find({ where: { planId, isRollback: false } });
    if (forward.length === 0) return;

    if (plan.status === 'canary_failed') {
      const canary = forward.filter((i) => i.stage === 'canary');
      if (canary.length && canary.every((i) => i.status === 'success')) {
        await this.planRepo.update(planId, {
          status: 'awaiting_approval',
          lastMessage: '测试节点迟到回执全部成功，可推进剩余节点',
        });
        await this.recordEvent(planId, 'canary_recovered', '迟到回执确认测试节点全部成功');
      }
      return;
    }

    if (plan.status === 'partial') {
      const terminal = (s: string) => ['success', 'failed', 'timeout', 'skipped'].includes(s);
      if (forward.every((i) => terminal(i.status))) {
        const failed = forward.filter((i) => ['failed', 'timeout'].includes(i.status));
        if (failed.length === 0) {
          await this.planRepo.update(planId, {
            status: 'complete',
            finishedAt: plan.finishedAt ?? new Date(),
            lastMessage: '迟到回执确认：全部节点发布成功',
          });
          await this.recordEvent(planId, 'plan_complete', '迟到回执补齐后全部成功');
        } else {
          // 迟到回执可能让部分 timeout 转 success，刷新计数文案
          const ok = forward.filter((i) => i.status === 'success').length;
          const skipped = forward.filter((i) => i.status === 'skipped').length;
          await this.planRepo.update(planId, {
            lastMessage: `部分成功：${ok}/${forward.length} 成功，${failed.length} 失败，${skipped} 因暂停跳过`,
          });
        }
      }
    }
  }

  // ---------- 下发 ----------

  private async dispatchOne(item: DeploymentItem, node: DeployNode, target: Certificate) {
    await this.itemRepo.update(item.id, { status: 'dispatched', dispatchedAt: new Date(), errorMessage: '' });
    const outcome = await this.simulator.dispatch(
      {
        requestToken: item.requestToken,
        nodeId: node.id,
        targetFingerprint: target.fingerprintSha256,
        currentFingerprint: node.activeFingerprintSha256,
        behavior: node.behavior,
      },
      (o) => this.applyReceipt(item.planId, node.id, item.requestToken, o),
    );
    if (outcome === null) {
      // 等待窗口超时：若迟到回执已抢先落库则不覆盖
      const fresh = await this.itemRepo.findOne({ where: { id: item.id } });
      if (fresh && fresh.status === 'dispatched') {
        await this.itemRepo.update(item.id, {
          status: 'timeout',
          errorMessage: `等待节点回执超过 5s，节点实际版本以其迟到回执/当前指纹为准`,
        });
        await this.recordEvent(item.planId, 'node_timeout', `节点 ${node.name} 超时`, 'warn');
      }
    }
  }

  async startCanary(planId: string) {
    const { plan, items } = await this.getPlan(planId);
    if (plan.status !== 'draft') throw new ConflictException(`当前状态 ${plan.status} 不能启动灰度`);
    const canaryItems = items.filter((i) => i.stage === 'canary' && !i.isRollback);
    if (!canaryItems.length) throw new ConflictException('没有测试节点');

    await this.planRepo.update(planId, { status: 'canary_running', canaryStartedAt: new Date() });
    await this.recordEvent(planId, 'canary_started', `灰度开始：下发 ${canaryItems.length} 个测试节点`);

    for (const it of canaryItems) {
      const node = await this.nodeRepo.findOne({ where: { id: it.nodeId } });
      const target = await this.certRepo.findOne({ where: { id: it.targetCertificateId } });
      if (!node || !target) continue;
      await this.dispatchOne(it, node, target);
    }

    const after = await this.itemRepo.find({ where: { planId } });
    const canaryAfter = after.filter((i) => i.stage === 'canary' && !i.isRollback);
    const ok = canaryAfter.every((i) => i.status === 'success');
    if (ok) {
      await this.planRepo.update(planId, {
        status: 'awaiting_approval',
        lastMessage: '测试节点全部验证通过，等待确认推进',
      });
      await this.recordEvent(planId, 'canary_passed', '测试节点全部成功，可推进剩余节点');
    } else {
      const failed = canaryAfter.filter((i) => i.status !== 'success');
      await this.planRepo.update(planId, {
        status: 'canary_failed',
        lastMessage: `${failed.length} 个测试节点未通过：${failed.map((f) => f.status).join(',')}`,
      });
      await this.recordEvent(planId, 'canary_failed', plan.lastMessage || '测试节点存在失败，已阻断全量推进', 'error');
    }
    return this.getPlan(planId);
  }

  /** 推进剩余节点（后台执行，支持暂停） */
  async advanceBulk(planId: string) {
    const { plan, items } = await this.getPlan(planId);
    if (plan.status !== 'awaiting_approval' && plan.status !== 'paused') {
      throw new ConflictException(`当前状态 ${plan.status} 不能推进全量`);
    }
    const bulkItems = items.filter((i) => i.stage === 'bulk' && !i.isRollback);
    if (!bulkItems.length) {
      // 没有 bulk 节点，canary 通过即完成
      await this.planRepo.update(planId, { status: 'complete', finishedAt: new Date() });
      return this.getPlan(planId);
    }

    await this.planRepo.update(planId, {
      status: 'bulk_running',
      bulkStartedAt: plan.bulkStartedAt ?? new Date(),
      pausedAt: null,
      lastMessage: '全量发布进行中',
    });
    await this.recordEvent(planId, 'bulk_started', `开始推进剩余 ${bulkItems.length} 个节点`);
    void this.runBulk(planId);
    return this.getPlan(planId);
  }

  private async runBulk(planId: string) {
    try {
      const items = await this.itemRepo.find({
        where: { planId, stage: 'bulk', isRollback: false },
        order: { createdAt: 'ASC' },
      });
      for (const it of items) {
        const plan = await this.planRepo.findOne({ where: { id: planId } });
        if (!plan || plan.status === 'paused' || plan.status === 'rolled_back' || plan.status === 'rollback_failed') {
          this.logger.log(`bulk loop stopped for plan ${planId} (status=${plan?.status})`);
          return;
        }
        const fresh = await this.itemRepo.findOne({ where: { id: it.id } });
        if (!fresh || ['success', 'skipped'].includes(fresh.status)) continue;

        const node = await this.nodeRepo.findOne({ where: { id: it.nodeId } });
        const target = await this.certRepo.findOne({ where: { id: it.targetCertificateId } });
        if (!node || !target) continue;
        await this.dispatchOne(fresh, node, target);
        await new Promise((r) => setTimeout(r, 300));
      }
      await this.recomputeAfterBulk(planId);
    } catch (e) {
      this.logger.error(`runBulk failed: ${(e as Error).message}`);
    }
  }

  private async recomputeAfterBulk(planId: string) {
    const plan = await this.planRepo.findOne({ where: { id: planId } });
    if (!plan || plan.status === 'paused') return;
    const bulk = await this.itemRepo.find({ where: { planId, stage: 'bulk', isRollback: false } });
    const failed = bulk.filter((i) => ['failed', 'timeout'].includes(i.status));
    const skipped = bulk.filter((i) => i.status === 'skipped');
    if (failed.length === 0 && skipped.length === 0) {
      await this.planRepo.update(planId, { status: 'complete', finishedAt: new Date(), lastMessage: '全部节点发布成功' });
      await this.recordEvent(planId, 'plan_complete', '全部节点已切换到新证书');
    } else {
      await this.planRepo.update(planId, {
        status: 'partial',
        lastMessage: `部分成功：${bulk.length - failed.length - skipped.length}/${bulk.length} 成功，${failed.length} 失败，${skipped.length} 因暂停跳过`,
      });
      await this.recordEvent(planId, 'plan_partial', plan.lastMessage, 'warn');
    }
  }

  async pause(planId: string) {
    const plan = await this.planRepo.findOne({ where: { id: planId } });
    if (!plan) throw new NotFoundException('计划不存在');
    if (!['bulk_running', 'canary_running'].includes(plan.status)) {
      throw new ConflictException(`当前状态 ${plan.status} 不能暂停`);
    }
    await this.planRepo.update(planId, { status: 'paused', pausedAt: new Date() });
    // 尚未下发的 bulk 项标记 skipped
    await this.itemRepo.update(
      { planId, stage: 'bulk', isRollback: false, status: 'pending' },
      { status: 'skipped', errorMessage: '发布暂停，未下发' },
    );
    await this.recordEvent(planId, 'paused', '用户暂停发布，未下发节点保持原版本', 'warn');
    return this.getPlan(planId);
  }

  async resume(planId: string) {
    const plan = await this.planRepo.findOne({ where: { id: planId } });
    if (!plan) throw new NotFoundException('计划不存在');
    if (plan.status !== 'paused') throw new ConflictException('仅暂停状态可恢复');
    // 将 skipped 恢复为 pending 再继续
    await this.itemRepo.update(
      { planId, stage: 'bulk', isRollback: false, status: 'skipped' },
      { status: 'pending', errorMessage: '' },
    );
    await this.recordEvent(planId, 'resumed', '恢复发布');
    return this.advanceBulk(planId);
  }

  /** 单个节点重试（flaky 场景：失败节点重试成功；其余节点版本不受影响） */
  async retryItem(planId: string, itemId: string) {
    const item = await this.itemRepo.findOne({ where: { id: itemId, planId } });
    if (!item) throw new NotFoundException('下发条目不存在');
    if (!['failed', 'timeout'].includes(item.status)) {
      throw new ConflictException(`条目状态 ${item.status} 不可重试`);
    }
    const node = await this.nodeRepo.findOne({ where: { id: item.nodeId } });
    const target = await this.certRepo.findOne({ where: { id: item.targetCertificateId } });
    if (!node || !target) throw new NotFoundException('节点或目标证书缺失');

    item.status = 'pending';
    item.requestToken = randomUUID().replace(/-/g, '');
    item.errorMessage = '';
    item.dispatchedAt = null;
    item.ackedAt = null;
    item.completedAt = null;
    await this.itemRepo.save(item);
    await this.recordEvent(planId, 'item_retry', `重试节点 ${node.name}（新令牌）`);
    await this.dispatchOne(item, node, target);
    await this.recomputeAfterBulk(planId);
    return this.getPlan(planId);
  }

  // ---------- 回滚 ----------

  /**
   * 为节点实时选择回滚目标：仍有效（notAfter > now）且覆盖节点域名。
   * 优先级：基线版本（轮换前该节点实际运行的版本）> 其他有效匹配版本中最新的一张。
   * 返回 null 表示没有任何安全回滚候选。
   */
  private async pickRollbackTarget(
    node: DeployNode,
    plan: DeploymentPlan,
    allCerts: Certificate[],
  ): Promise<Certificate | null> {
    const usable = allCerts
      .filter(
        (c) =>
          c.id !== plan.newCertificateId &&
          coversDomain(c.sanDomains, node.domain) &&
          certStatusAt(c.notAfter) !== 'expired',
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const baselineCertId = plan.baseline[node.id]?.certificateId;
    return usable.find((c) => c.id === baselineCertId) ?? usable[0] ?? null;
  }

  /**
   * 回滚只能回到：仍有效（notAfter > now）且覆盖节点域名 的证书。
   * 创建计划时锁定的 rollbackTargets 仅作预期展示；执行时实时再选一次：
   * 基线版本优先；基线若已中途过期，则改选其他有效匹配版本；全部不可用才拒绝。
   */
  async rollback(planId: string) {
    const { plan, items } = await this.getPlan(planId);
    if (!ROLLBACKABLE_PLAN_STATUSES.includes(plan.status)) {
      throw new ConflictException(`当前状态 ${plan.status} 不允许回滚`);
    }
    if (items.some((i) => i.isRollback)) {
      throw new ConflictException('该计划已经执行过回滚');
    }

    // 先暂停全量循环
    if (plan.status === 'bulk_running' || plan.status === 'canary_running') {
      await this.planRepo.update(planId, { status: 'paused', pausedAt: new Date() });
    }

    const nodes = await this.nodeRepo.find({ where: { id: In(items.map((i) => i.nodeId)) } });
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const allCerts = await this.certRepo.find();
    const targets: {
      node: DeployNode;
      item: DeploymentItem;
      target: Certificate;
      baseline: boolean;
    }[] = [];
    const blocked: string[] = [];

    for (const item of items.filter((i) => !i.isRollback)) {
      const node = nodeMap.get(item.nodeId);
      if (!node) continue;
      // 节点没切到新版本（失败/超时/未下发/仍为旧指纹） => 无需回滚
      const switched =
        item.status === 'success' &&
        node.activeCertificateId === item.targetCertificateId;
      if (!switched) continue;

      const target = await this.pickRollbackTarget(node, plan, allCerts);
      if (!target) {
        blocked.push(
          `节点 ${node.name} 没有任何仍有效且覆盖域名 ${node.domain} 的历史证书可回滚`,
        );
        continue;
      }
      targets.push({
        node,
        item,
        target,
        baseline: target.id === plan.baseline[node.id]?.certificateId,
      });
    }

    if (blocked.length) {
      throw new BadRequestException({ message: '回滚被安全规则阻止', problems: blocked });
    }
    if (targets.length === 0) {
      await this.planRepo.update(planId, {
        status: 'rolled_back',
        finishedAt: new Date(),
        lastMessage: '没有节点实际切换到新版本，无需回滚（各节点保持原版本）',
      });
      await this.recordEvent(planId, 'rollback_skipped', plan.lastMessage, 'warn');
      return this.getPlan(planId);
    }

    await this.recordEvent(
      planId,
      'rollback_started',
      `回滚 ${targets.length} 个已切换节点到有效匹配版本` +
        (targets.every((t) => t.baseline)
          ? '（全部回到轮换前基线）'
          : `（${targets.filter((t) => !t.baseline).length} 个基线已失效，改选次新有效证书：` +
            targets.filter((t) => !t.baseline).map((t) => `${t.node.name}->${t.target.label}`).join('；') + '）'),
      'warn',
    );

    const results: { name: string; ok: boolean; status: ItemStatus; error?: string }[] = [];
    for (const { node, target } of targets) {
      const rbItem = this.itemRepo.create({
        planId,
        nodeId: node.id,
        stage: node.type === 'canary' ? 'canary' : 'bulk',
        isRollback: true,
        targetCertificateId: target.id,
        status: 'pending',
        requestToken: randomUUID().replace(/-/g, ''),
      });
      await this.itemRepo.save(rbItem);
      await this.dispatchOne(rbItem, node, target);
      const done = await this.itemRepo.findOne({ where: { id: rbItem.id } });
      results.push({
        name: node.name,
        ok: done?.status === 'success',
        status: done?.status ?? 'failed',
        error: done?.errorMessage,
      });
    }

    const failed = results.filter((r) => !r.ok);
    if (failed.length === 0) {
      await this.planRepo.update(planId, {
        status: 'rolled_back',
        finishedAt: new Date(),
        lastMessage: `已回滚 ${results.length} 个节点`,
      });
      await this.recordEvent(planId, 'rollback_done', '回滚完成，所有节点已恢复到旧版有效证书');
    } else {
      await this.planRepo.update(planId, {
        status: 'rollback_failed',
        lastMessage: `回滚部分失败：${failed.length}/${results.length} 个节点未恢复，节点版本以矩阵指纹为准`,
      });
      await this.recordEvent(planId, 'rollback_failed', plan.lastMessage, 'error', {
        failed: failed.map((f) => f.name),
      });
    }
    return this.getPlan(planId);
  }
}
