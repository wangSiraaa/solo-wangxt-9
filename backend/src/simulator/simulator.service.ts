import { Injectable, Logger } from '@nestjs/common';
import {
  DISPATCH_TIMEOUT_MS,
  NodeBehavior,
  ReceiptKind,
  SIM_MAX_DELAY_MS,
  SIM_MIN_DELAY_MS,
} from '../domain.types';

export interface SimDispatchParams {
  requestToken: string;
  nodeId: string;
  targetFingerprint: string;
  /** 节点当前指纹（flaky 失败时节点保持该版本） */
  currentFingerprint: string | null;
  behavior: NodeBehavior;
}

export interface SimOutcome {
  kind: ReceiptKind;
  /** 节点自报当前指纹；flaky 失败时为旧指纹 */
  fingerprint: string | null;
  message: string;
  delayedMs: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const randDelay = () =>
  SIM_MIN_DELAY_MS +
  Math.floor(Math.random() * (SIM_MAX_DELAY_MS - SIM_MIN_DELAY_MS));

/**
 * 本地节点模拟器（不绑定真实进程，所有状态在内存中）：
 *  - success：延迟后成功，节点指纹切换为目标指纹；
 *  - timeout：处理耗时超过后端等待窗口，后端先判超时，节点事后仍发迟到回执；
 *  - duplicate：成功回执发送两次，验证后端按 requestToken 去重；
 *  - flaky：第一次下发失败（节点保留旧指纹 => 部分失败），重试后成功。
 */
@Injectable()
export class SimulatorService {
  private readonly logger = new Logger('Simulator');
  private attempts = new Map<string, number>();
  /** 测试钩子：nodeId -> 强制下一次行为覆盖 */
  private overrides = new Map<string, NodeBehavior>();

  resetAttempts(nodeId?: string) {
    if (nodeId) this.attempts.delete(nodeId);
    else this.attempts.clear();
  }

  setOverride(nodeId: string, behavior: NodeBehavior | null) {
    if (behavior) this.overrides.set(nodeId, behavior);
    else this.overrides.delete(nodeId);
  }

  getAttemptCount(nodeId: string): number {
    return this.attempts.get(nodeId) ?? 0;
  }

  /**
   * 模拟"下发并等待节点回执"。
   * @param onReceipt 节点产出回执时的回调（由部署服务注入：写回执流水、更新节点版本）
   * @returns 等待窗口内的结果；超时返回 null（迟到回执稍后仍会经 onReceipt 落库）
   */
  async dispatch(
    p: SimDispatchParams,
    onReceipt: (o: SimOutcome) => Promise<void> | void,
  ): Promise<SimOutcome | null> {
    const behavior = this.overrides.get(p.nodeId) ?? p.behavior;
    if (this.overrides.has(p.nodeId)) this.overrides.delete(p.nodeId);
    const attemptN = (this.attempts.get(p.nodeId) ?? 0) + 1;
    this.attempts.set(p.nodeId, attemptN);

    const mk = (kind: ReceiptKind, fingerprint: string | null, msg: string, delay: number): SimOutcome => ({
      kind,
      fingerprint,
      message: `${msg}（第 ${attemptN} 次尝试）`,
      delayedMs: delay,
    });

    // 决定本次节点会做什么、多久之后做
    let processingDelay = randDelay();
    let outcome: SimOutcome;
    switch (behavior) {
      case 'timeout':
        processingDelay = DISPATCH_TIMEOUT_MS + 2500 + Math.floor(Math.random() * 2000);
        outcome = mk('success', p.targetFingerprint, '节点处理超时后完成加载，发出迟到回执', processingDelay);
        break;
      case 'flaky':
        outcome =
          attemptN === 1
            ? mk('failure', p.currentFingerprint, '节点 reload 失败，继续运行旧版本', processingDelay)
            : mk('success', p.targetFingerprint, '节点重试后成功加载新证书', processingDelay);
        break;
      case 'duplicate':
      case 'success':
      default:
        outcome = mk('success', p.targetFingerprint, '节点已加载并启用证书', processingDelay);
    }

    // 节点在延迟后发回执：主回执必须被等待（保证后端读到已提交状态）；
    // 重复回执在主回执落库后继续于后台发送。
    const mainPromise = (async () => {
      await sleep(processingDelay);
      await onReceipt(outcome);
      if (behavior === 'duplicate') {
        await sleep(randDelay());
        await onReceipt({
          ...outcome,
          kind: 'success',
          message: '节点重复发送的成功回执',
        });
      }
    })();
    mainPromise.catch((e) => this.logger.error(`simulator receipt failed: ${e}`));

    // 后端等待窗口：仅当主回执（含其落库回调）在窗口内完成才算成功
    const result = await Promise.race([
      sleep(DISPATCH_TIMEOUT_MS).then(() => null),
      (async () => {
        await sleep(processingDelay);
        await mainPromise;
        return outcome;
      })(),
    ]);

    if (result === null) {
      this.logger.warn(
        `dispatch timeout node=${p.nodeId} token=${p.requestToken.slice(0, 8)}，节点可能稍后补发回执`,
      );
    }
    return result;
  }
}
