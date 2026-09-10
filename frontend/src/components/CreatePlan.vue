<script setup>
import { computed, ref } from 'vue';
import { api, errorText } from '../api';

const props = defineProps({ dashboard: { type: Object, required: true } });
const emit = defineEmits(['created', 'cancel']);

const certId = ref('');
const selected = ref(new Set());
const label = ref('');
const busy = ref(false);
const error = ref('');

const usableCerts = computed(() =>
  (props.dashboard?.expiryList || []).filter((c) => c.status !== 'expired'),
);
const nodes = computed(() => props.dashboard?.nodeMatrix || []);

function toggle(id) {
  if (selected.value.has(id)) selected.value.delete(id);
  else selected.value.add(id);
  selected.value = new Set(selected.value);
}
function selectAll(onlyEligible = false) {
  selected.value = new Set(
    nodes.value.filter((n) => !onlyEligible || certCovers(n)).map((n) => n.id),
  );
}

const chosenCert = computed(() =>
  (props.dashboard?.expiryList || []).find((c) => c.id === certId.value),
);

function certCovers(node) {
  const c = chosenCert.value;
  if (!c) return false;
  return coverMatch(c.sanDomains, node.domain);
}

const selectedNodes = computed(() =>
  nodes.value.filter((n) => selected.value.has(n.id)),
);
const canarySelected = computed(() => selectedNodes.value.some((n) => n.type === 'canary'));
const uncoveredSelected = computed(() => selectedNodes.value.filter((n) => !certCovers(n)));
const alreadyOnTarget = computed(() =>
  selectedNodes.value.filter((n) => n.activeCertificateId === certId.value),
);
const canSubmit = computed(
  () =>
    certId.value &&
    selected.value.size > 0 &&
    canarySelected.value &&
    uncoveredSelected.value.length === 0 &&
    alreadyOnTarget.value.length === 0 &&
    !busy.value,
);

async function submit() {
  busy.value = true;
  error.value = '';
  try {
    const res = await api.createPlan({
      label: label.value || '',
      certificateId: certId.value,
      nodeIds: [...selected.value],
    });
    emit('created', res);
  } catch (e) {
    error.value = errorText(e);
  } finally {
    busy.value = false;
  }
}

// 与后端相同的通配符覆盖规则，用于前端即时提示
function coverMatch(sans, host) {
  const h = host.toLowerCase();
  return (sans || []).some((san) => {
    if (san === h) return true;
    if (san.startsWith('*.')) {
      const suffix = san.slice(1);
      const base = san.slice(2);
      const label = h.slice(0, h.length - suffix.length);
      return (
        h.endsWith(suffix) &&
        label.length > 0 &&
        !label.includes('.') &&
        h.split('.').length === base.split('.').length + 1
      );
    }
    return false;
  });
}
</script>

<template>
  <div class="panel">
    <div class="hd"><h3>新建轮换计划（分批：测试节点先行）</h3><span class="spacer"></span>
      <button class="ghost tiny" @click="emit('cancel')">关闭</button>
    </div>
    <div class="bd">
      <div v-if="error" class="alert error">{{ error }}</div>
      <div class="two-col">
        <div>
          <label class="field">
            <span>① 选择要发布的新证书（过期证书不允许发布）</span>
            <select v-model="certId">
              <option value="" disabled>— 请选择证书 —</option>
              <option v-for="c in usableCerts" :key="c.id" :value="c.id">
                {{ c.label }}（{{ c.status === 'expiring' ? '即将到期·' + c.daysLeft + '天' : '有效·' + c.daysLeft + '天' }}）SAN: {{ c.sanDomains.join(', ') }}
              </option>
            </select>
          </label>
          <div v-if="chosenCert" class="alert info small">
            指纹：<span class="mono">{{ chosenCert.fingerprintSha256 }}</span><br />
            到期：{{ chosenCert.notAfter }} · 覆盖：{{ chosenCert.sanDomains.join(', ') }}
          </div>
          <label class="field">
            <span>计划名称（可选）</span>
            <input v-model="label" placeholder="例如：v2→v3 九月轮换" />
          </label>
        </div>
        <div>
          <span>② 勾选发布节点（必须包含测试节点）</span>
          <div class="row" style="margin:6px 0">
            <button class="ghost tiny" @click="selectAll()">全选</button>
            <button class="ghost tiny" @click="selectAll(true)">仅选证书覆盖的节点</button>
            <span class="spacer"></span>
            <span class="small muted">已选 {{ selected.size }} / {{ nodes.length }}</span>
          </div>
          <div class="checklist">
            <label v-for="n in nodes" :key="n.id">
              <input type="checkbox" :checked="selected.has(n.id)" @change="toggle(n.id)" />
              <span>
                <span class="row" style="gap:8px">
                  <b>{{ n.name }}</b>
                  <span class="badge" :class="n.type">{{ n.type === 'canary' ? '测试' : '常规' }}</span>
                  <span class="muted small">{{ n.domain }}</span>
                  <span class="spacer"></span>
                  <span v-if="certId && !certCovers(n)" class="badge failed">域名不匹配</span>
                  <span v-else-if="certId && n.activeCertificateId === certId" class="badge expired">已是该版本</span>
                  <span v-else-if="certId" class="badge success">可发布</span>
                </span>
                <span class="small muted">当前：{{ n.activeCertLabel || '无' }}（{{ n.activeFingerprintSha256?.slice(0, 17) || '—' }}）</span>
              </span>
            </label>
          </div>
        </div>
      </div>
      <div class="alert error small" v-if="certId && uncoveredSelected.length">
        所选节点中 {{ uncoveredSelected.map((n) => n.name).join('、') }} 的域名不被证书 SAN 覆盖，后端将拒绝。
      </div>
      <div class="alert warn small" style="background:rgba(245,158,11,.12);border-color:rgba(245,158,11,.35);color:#fcd34d"
           v-if="certId && !canarySelected && selected.size">
        必须至少包含一个测试节点（canary），才能按「先灰度验证、再推进全量」发布。
      </div>
      <div class="row">
        <button :disabled="!canSubmit" @click="submit">{{ busy ? '创建中…' : '创建计划' }}</button>
        <span class="muted small" v-if="certId">
          回滚策略：优先回到各节点轮换前基线；基线已过期时改选其他仍有效且域名匹配的证书，均不可用则拒绝回滚。
        </span>
      </div>
    </div>
  </div>
</template>
