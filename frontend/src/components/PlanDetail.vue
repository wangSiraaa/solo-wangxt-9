<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { api, errorText } from '../api';
import { fmtDate, ITEM_STATUS, PLAN_STATUS } from '../labels';

const props = defineProps({ planId: String });
const emit = defineEmits(['back', 'changed']);

const detail = ref(null);
const nodes = ref([]);
const certs = ref([]);
const err = ref('');
const busy = ref('');
let timer = null;

const nodeMap = computed(() => Object.fromEntries(nodes.value.map((n) => [n.id, n])));
const certMap = computed(() => Object.fromEntries(certs.value.map((c) => [c.id, c])));

const forwardItems = computed(() => detail.value?.items.filter((i) => !i.isRollback) || []);
const rollbackItems = computed(() => detail.value?.items.filter((i) => i.isRollback) || []);
const plan = computed(() => detail.value?.plan);

const progress = computed(() => {
  const items = forwardItems.value;
  if (!items.length) return { pct: 0, ok: 0, fail: 0, timeout: 0, skip: 0, total: 0 };
  const ok = items.filter((i) => i.status === 'success').length;
  const fail = items.filter((i) => i.status === 'failed').length;
  const timeout = items.filter((i) => i.status === 'timeout').length;
  const skip = items.filter((i) => i.status === 'skipped').length;
  return { pct: Math.round(((ok + fail + timeout + skip) / items.length) * 100), ok, fail, timeout, skip, total: items.length };
});

async function load() {
  try {
    detail.value = await api.getPlan(props.planId);
    [nodes.value, certs.value] = await Promise.all([api.listNodes(), api.listCerts()]);
    err.value = '';
  } catch (e) {
    err.value = errorText(e);
  }
}

async function act(kind, fn) {
  busy.value = kind;
  err.value = '';
  try {
    detail.value = await fn();
    emit('changed');
  } catch (e) {
    err.value = errorText(e);
  } finally {
    busy.value = '';
  }
}
const doCanary = () => act('canary', () => api.canary(props.planId));
const doAdvance = () => act('advance', () => api.advance(props.planId));
const doPause = () => act('pause', () => api.pause(props.planId));
const doResume = () => act('resume', () => api.resume(props.planId));
const doRollback = () => {
  if (!window.confirm('确认回滚？仅实际切换到新版本的节点会被回滚；目标必须仍有效且覆盖节点域名。')) return;
  act('rollback', () => api.rollback(props.planId));
};
const doRetry = (itemId) => act('retry-' + itemId, () => api.retryItem(props.planId, itemId));

function tgtLabel(id) {
  return certMap.value[id]?.label || id.slice(0, 8);
}
function baselineFor(nodeId) {
  const b = plan.value?.baseline?.[nodeId];
  return b?.certificateId ? tgtLabel(b.certificateId) : '（无基线）';
}
function lockedTarget(nodeId) {
  const t = plan.value?.rollbackTargets?.[nodeId];
  return t?.certificateId ? tgtLabel(t.certificateId) : null;
}

const isRunning = computed(() =>
  ['canary_running', 'bulk_running'].includes(plan.value?.status),
);

onMounted(async () => {
  await load();
  // 运行中 2s 快轮询，稳态 5s
  timer = setInterval(async () => {
    if (busy.value) return;
    await load();
  }, 2500);
});
onBeforeUnmount(() => clearInterval(timer));
</script>

<template>
  <div v-if="!detail" class="muted">加载中…</div>
  <template v-else>
    <button class="ghost tiny" @click="emit('back')" style="margin-bottom:12px">← 返回计划列表</button>
    <div v-if="err" class="alert error">{{ err }}</div>

    <div class="panel">
      <div class="hd">
        <h3>{{ plan.label }}</h3>
        <span class="badge" :class="plan.status">{{ PLAN_STATUS[plan.status] || plan.status }}</span>
        <span class="spacer"></span>
        <span class="muted small">创建于 {{ fmtDate(plan.createdAt) }}</span>
      </div>
      <div class="bd">
        <div class="row" style="gap:8px">
          <button v-if="plan.status === 'draft'" :disabled="!!busy" @click="doCanary">
            {{ busy === 'canary' ? '灰度下发中…' : '① 启动灰度（测试节点先行）' }}
          </button>
          <button v-if="plan.status === 'awaiting_approval'" :disabled="!!busy" @click="doAdvance">
            {{ busy === 'advance' ? '下发中…' : '② 测试通过，推进剩余节点' }}
          </button>
          <button v-if="plan.status === 'canary_failed'" disabled
                  title="必须测试节点全部成功后才能推进">② 推进剩余节点（灰度未通过，已阻断）</button>
          <button v-if="plan.status === 'paused'" class="ghost" :disabled="!!busy" @click="doResume">
            {{ busy === 'resume' ? '恢复中…' : '继续发布' }}
          </button>
          <button v-if="isRunning" class="warn" :disabled="!!busy" @click="doPause">
            {{ busy === 'pause' ? '暂停中…' : '⏸ 暂停' }}
          </button>
          <button v-if="['canary_failed','awaiting_approval','partial','paused','bulk_running','canary_running'].includes(plan.status)"
                  class="danger" :disabled="!!busy || rollbackItems.length" @click="doRollback"
                  :title="rollbackItems.length ? '该计划已执行过回滚' : ''">
            {{ busy === 'rollback' ? '回滚中…' : '↩ 回滚' }}
          </button>
          <span class="spacer"></span>
          <span class="small muted" v-if="plan.lastMessage">{{ plan.lastMessage }}</span>
        </div>
        <div v-if="plan.status === 'canary_failed'" class="alert error small" style="margin-top:10px;margin-bottom:0">
          测试节点未全部通过，已阻断全量推进。可在下方对失败节点单独重试（其他节点版本不受影响），通过后再推进；也可直接回滚。
        </div>
        <div class="progress-line"><i :style="{ width: progress.pct + '%' }"></i></div>
        <div class="small muted" style="margin-top:6px">
          正向进度 {{ progress.pct }}% ｜ 成功 {{ progress.ok }} ｜ 失败 {{ progress.fail }} ｜ 超时 {{ progress.timeout }} ｜ 跳过 {{ progress.skip }} ｜ 共 {{ progress.total }} 节点
        </div>
      </div>
    </div>

    <!-- 节点下发矩阵 -->
    <div class="panel">
      <div class="hd"><h3>节点下发与最终指纹</h3><span class="spacer"></span>
        <span class="muted small">失败/超时只影响该节点；其他成功节点保留其实际版本</span>
      </div>
      <div class="bd" style="padding:0">
        <table>
          <thead>
            <tr><th>阶段</th><th>节点</th><th>域名</th><th>条目状态</th><th>目标版本</th>
              <th>节点最终指纹</th><th>基线（可回滚）</th><th>回执信息</th><th></th></tr>
          </thead>
          <tbody>
            <template v-for="it in forwardItems" :key="it.id">
              <tr>
                <td><span class="badge" :class="it.stage">{{ it.stage === 'canary' ? '测试' : '常规' }}</span></td>
                <td><b>{{ nodeMap[it.nodeId]?.name }}</b>
                  <div class="small muted">{{ {success:'正常',timeout:'超时',duplicate:'重复回执',flaky:'首次失败'}[nodeMap[it.nodeId]?.behavior] }}</div>
                </td>
                <td class="mono small">{{ nodeMap[it.nodeId]?.domain }}</td>
                <td><span class="badge" :class="it.status">{{ ITEM_STATUS[it.status] }}</span></td>
                <td class="small">{{ tgtLabel(it.targetCertificateId) }}</td>
                <td class="fp" :title="nodeMap[it.nodeId]?.activeFingerprintSha256 || ''">
                  {{ nodeMap[it.nodeId]?.activeFingerprintSha256 || '—' }}
                  <div class="small muted" v-if="it.reportedFingerprintSha256 && it.reportedFingerprintSha256 !== nodeMap[it.nodeId]?.activeFingerprintSha256">
                    回执:{{ it.reportedFingerprintSha256.slice(0,17) }}
                  </div>
                </td>
                <td class="small">{{ baselineFor(it.nodeId) }}</td>
                <td class="small muted" style="max-width:260px">{{ it.errorMessage }}</td>
                <td>
                  <button v-if="['failed','timeout'].includes(it.status)" class="tiny ghost"
                          :disabled="!!busy" @click="doRetry(it.id)">
                    {{ busy === 'retry-' + it.id ? '重试中…' : '重试此节点' }}
                  </button>
                </td>
              </tr>
            </template>
            <template v-for="it in rollbackItems" :key="it.id">
              <tr style="background:rgba(239,68,68,.05)">
                <td><span class="badge rolled_back">回滚</span></td>
                <td class="small"><b>{{ nodeMap[it.nodeId]?.name }}</b></td>
                <td class="mono small">{{ nodeMap[it.nodeId]?.domain }}</td>
                <td><span class="badge" :class="it.status">{{ ITEM_STATUS[it.status] }}</span></td>
                <td class="small">↩ {{ tgtLabel(it.targetCertificateId) }}</td>
                <td class="fp">{{ nodeMap[it.nodeId]?.activeFingerprintSha256 || '—' }}</td>
                <td class="small muted">—</td>
                <td class="small muted">{{ it.errorMessage || '已回到旧版有效证书' }}</td>
                <td></td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>

    <div class="two-col">
      <!-- 切换记录（审计事件） -->
      <div class="panel">
        <div class="hd"><h3>切换记录（审计事件）</h3></div>
        <div class="bd event-log">
          <div class="e" v-for="e in [...detail.events].reverse()" :key="e.id">
            <span class="t">{{ fmtDate(e.at) }}</span>
            <span class="m" :class="e.level">
              <b>{{ e.action }}</b> {{ e.message }}
            </span>
          </div>
        </div>
      </div>
      <!-- 节点回执流水 -->
      <div class="panel">
        <div class="hd"><h3>节点回执流水</h3><span class="spacer"></span>
          <span class="muted small">透明记录：重复/过期回执标记为未采纳</span>
        </div>
        <div class="bd event-log">
          <div class="e receipt-row" :class="{ 'accepted-false': !r.accepted }" v-for="r in [...detail.receipts].reverse()" :key="r.id">
            <span class="t">{{ fmtDate(r.receivedAt) }}</span>
            <span>
              <span class="badge" :class="r.kind === 'success' ? 'success' : 'failed'" style="margin-right:6px">
                {{ r.kind === 'success' ? '成功' : '失败' }}
              </span>
              <span class="muted">{{ nodeMap[r.nodeId]?.name }}</span>
              <span :class="r.accepted ? '' : 'danger-text'">· {{ r.accepted ? '已采纳' : '未采纳（重复/过期）' }}</span>
              <div class="muted">{{ r.message }}</div>
              <div class="fp">{{ r.fingerprintSha256?.slice(0, 23) || '—' }} · token {{ r.requestToken.slice(0, 8) }}</div>
            </span>
          </div>
          <div v-if="!detail.receipts.length" class="muted small">暂无回执</div>
        </div>
      </div>
    </div>
  </template>
</template>
