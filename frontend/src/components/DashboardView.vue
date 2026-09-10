<script setup>
import { ref, computed } from 'vue';
import UploadCert from './UploadCert.vue';
import CreatePlan from './CreatePlan.vue';
import { fmtDate, fpShort } from '../labels';

const props = defineProps({ dashboard: Object });
const emit = defineEmits(['uploaded', 'create-plan']);
const showCreate = ref(false);

function onCreated(res) {
  showCreate.value = false;
  emit('create-plan', res.plan.id);
}
</script>

<template>
  <div v-if="!dashboard" class="muted">加载中…</div>
  <template v-else>
    <div class="cards">
      <div class="stat" :class="{ danger: dashboard.counts.expired }">
        <div class="n">{{ dashboard.counts.expired }}</div><div class="l">已过期证书</div>
      </div>
      <div class="stat" :class="{ warn: dashboard.counts.expiring }">
        <div class="n">{{ dashboard.counts.expiring }}</div><div class="l">30 天内到期</div>
      </div>
      <div class="stat ok"><div class="n">{{ dashboard.counts.valid }}</div><div class="l">有效证书</div></div>
      <div class="stat" :class="{ danger: dashboard.counts.nodesRunningExpired, warn: dashboard.counts.nodesRunningExpiring }">
        <div class="n">{{ dashboard.counts.nodesRunningExpired + dashboard.counts.nodesRunningExpiring }}</div>
        <div class="l">节点运行到期/临期版本</div>
      </div>
      <div class="stat"><div class="n">{{ dashboard.nodeMatrix.length }}</div><div class="l">受管节点</div></div>
      <div class="stat warn"><div class="n">{{ dashboard.counts.activePlans }}</div><div class="l">进行中计划</div></div>
    </div>

    <div class="row" style="margin-bottom:14px">
      <UploadCert @uploaded="emit('uploaded')" />
      <button class="tiny" @click="showCreate = !showCreate">🚀 新建轮换计划</button>
    </div>

    <CreatePlan v-if="showCreate" :dashboard="dashboard" @cancel="showCreate = false" @created="onCreated" />

    <!-- 到期清单 -->
    <div class="panel">
      <div class="hd"><h3>到期清单</h3><span class="spacer"></span>
        <span class="muted small">按到期时间升序，含每个指纹正在哪些节点运行</span>
      </div>
      <div class="bd" style="padding:0">
        <table>
          <thead>
            <tr><th>证书</th><th>签发者</th><th>SAN 域名覆盖</th><th>到期时间</th><th>剩余</th>
            <th>状态</th><th>叶子指纹 SHA-256</th><th>运行节点</th></tr>
          </thead>
          <tbody>
            <tr v-for="c in dashboard.expiryList" :key="c.id">
              <td><b>{{ c.label }}</b><div class="muted small">链长 {{ c.chainLength }} 张</div></td>
              <td class="small">{{ c.issuerCn }}</td>
              <td class="small">
                <span v-for="(d,i) in c.sanDomains" :key="d" class="mono">{{ d }}<span v-if="i<c.sanDomains.length-1">, </span></span>
              </td>
              <td class="small">{{ fmtDate(c.notAfter) }}</td>
              <td :class="c.status==='expired'?'danger-text':c.status==='expiring'?'warn-text':'ok-text'">
                <b>{{ c.daysLeft < 0 ? `已过期 ${-c.daysLeft} 天` : `${c.daysLeft} 天` }}</b>
              </td>
              <td><span class="badge" :class="c.status">{{ c.status === 'valid' ? '有效' : c.status === 'expiring' ? '临期' : '已过期' }}</span></td>
              <td class="fp" :title="c.fingerprintSha256">{{ c.fingerprintSha256 }}</td>
              <td class="small">
                <span v-if="!c.activeNodeCount" class="muted">未部署</span>
                <span v-else>{{ c.activeNodeCount }} 个：<span class="muted">{{ c.activeNodes.join('、') }}</span></span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 节点矩阵 -->
    <div class="panel">
      <div class="hd"><h3>节点矩阵 — 每个节点最终使用的指纹</h3><span class="spacer"></span>
        <span class="muted small">指纹来自节点成功回执自报，并与目标证书指纹核对一致后生效</span>
      </div>
      <div class="bd" style="padding:0">
        <table>
          <thead>
            <tr><th>节点</th><th>类型</th><th>服务域名</th><th>模拟行为</th><th>当前版本</th>
            <th>当前证书状态</th><th>实际指纹（节点运行中）</th><th>生效时间</th></tr>
          </thead>
          <tbody>
            <tr v-for="n in dashboard.nodeMatrix" :key="n.id">
              <td><b>{{ n.name }}</b></td>
              <td><span class="badge" :class="n.type">{{ n.type === 'canary' ? '测试 canary' : '常规 bulk' }}</span></td>
              <td class="mono small">{{ n.domain }}</td>
              <td>
                <span class="badge" :class="n.behavior === 'success' ? 'success' : n.behavior">
                  {{ { success:'正常', timeout:'超时', duplicate:'重复回执', flaky:'首次失败' }[n.behavior] }}
                </span>
              </td>
              <td class="small">{{ n.activeCertLabel || '无' }}</td>
              <td>
                <span v-if="n.activeStatus" class="badge" :class="n.activeStatus">
                  {{ n.activeStatus === 'valid' ? `有效 ${n.activeDaysLeft}d` : n.activeStatus === 'expiring' ? `临期 ${n.activeDaysLeft}d` : '已过期' }}
                </span>
                <span v-else class="muted">—</span>
              </td>
              <td class="fp" :title="n.activeFingerprintSha256 || ''">{{ n.activeFingerprintSha256 || '—' }}</td>
              <td class="small muted">{{ fmtDate(n.activeSince) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </template>
</template>
