<script setup>
import { ref } from 'vue';
import { api, errorText } from '../api';
import { fmtDate, NODE_BEHAVIOR, BEHAVIOR_DESC } from '../labels';

const props = defineProps({ dashboard: Object });
const emit = defineEmits(['changed']);
const msg = ref('');
const busyId = ref('');
const candidates = ref(null);
const candidatesFor = ref('');

const behaviors = ['success', 'timeout', 'duplicate', 'flaky'];

async function setBehavior(node, b) {
  busyId.value = node.id + '-b';
  msg.value = '';
  try {
    await api.setBehavior(node.id, b);
    emit('changed');
  } catch (e) {
    msg.value = errorText(e);
  } finally {
    busyId.value = '';
  }
}

async function inject(node, b) {
  busyId.value = node.id + '-i';
  msg.value = '';
  try {
    await api.injectOnce(node.id, b);
    msg.value = `已让「${node.name}」下一次下发表现为「${NODE_BEHAVIOR[b]}」（仅一次）`;
    emit('changed');
  } catch (e) {
    msg.value = errorText(e);
  } finally {
    busyId.value = '';
  }
}

async function showCandidates(node) {
  candidatesFor.value = node.id;
  candidates.value = await api.rollbackCandidates(node.id);
}
</script>

<template>
  <div v-if="!dashboard" class="muted">加载中…</div>
  <template v-else>
    <div class="alert info">
      本地节点模拟器：可把任意节点设为固定行为，或用「注入一次」只影响下一次下发。
      <ul style="margin:6px 0 0 18px;padding:0">
        <li><b>超时</b>：节点处理超过后端 5s 等待窗口 → 条目先判超时；节点事后发出迟到成功回执，后端按其真实指纹采纳。</li>
        <li><b>重复回执</b>：成功后补发一条相同回执，第二条按 requestToken 识别并标记「未采纳」，结果不被覆盖。</li>
        <li><b>首次失败</b>：第一次下发失败、节点保留旧指纹（部分成功），对该节点重试后成功。</li>
      </ul>
    </div>
    <div v-if="msg" class="alert success">{{ msg }}</div>

    <div class="panel">
      <div class="hd"><h3>节点模拟控制与实际版本</h3><span class="spacer"></span>
        <span class="muted small">切换行为后，新建计划即按该行为模拟</span>
      </div>
      <div class="bd" style="padding:0">
        <table>
          <thead>
            <tr><th>节点</th><th>域名</th><th>类型</th><th>固定行为</th><th>一次性注入</th>
              <th>当前指纹</th><th>可回滚证书</th></tr>
          </thead>
          <tbody>
            <tr v-for="n in dashboard.nodeMatrix" :key="n.id">
              <td><b>{{ n.name }}</b></td>
              <td class="mono small">{{ n.domain }}</td>
              <td><span class="badge" :class="n.type">{{ n.type === 'canary' ? '测试' : '常规' }}</span></td>
              <td>
                <div class="pill-group">
                  <button v-for="b in behaviors" :key="b" :class="{ on: n.behavior === b }"
                          :disabled="busyId === n.id + '-b'" @click="setBehavior(n, b)">
                    {{ NODE_BEHAVIOR[b] }}
                  </button>
                </div>
                <div class="small muted" style="margin-top:4px">{{ BEHAVIOR_DESC[n.behavior] }}</div>
              </td>
              <td>
                <div class="pill-group">
                  <button v-for="b in behaviors.filter(x=>x!=='success')" :key="b"
                          :disabled="busyId === n.id + '-i'" class="tiny"
                          style="padding:5px 8px" @click="inject(n, b)"
                          :title="BEHAVIOR_DESC[b]">注入{{ NODE_BEHAVIOR[b] }}</button>
                </div>
              </td>
              <td>
                <div class="fp">{{ n.activeFingerprintSha256 || '—' }}</div>
                <div class="small muted">{{ n.activeCertLabel }} · {{ fmtDate(n.activeSince) }}</div>
              </td>
              <td>
                <button class="ghost tiny" @click="showCandidates(n)">查看候选</button>
                <div v-if="candidatesFor === n.id && candidates" class="small" style="margin-top:6px;max-width:240px">
                  <div v-if="!candidates.length" class="danger-text">无有效且匹配域名的历史证书（回滚将被拒绝）</div>
                  <div v-for="c in candidates" :key="c.id" :class="c.activeOnNode ? 'ok-text' : 'muted'">
                    • {{ c.label }} {{ c.activeOnNode ? '（当前）' : '' }}<br />
                    <span class="fp">{{ c.fingerprintSha256.slice(0,20) }}…</span>
                  </div>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </template>
</template>
