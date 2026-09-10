<script setup>
import { onMounted, onBeforeUnmount, ref } from 'vue';
import { api } from './api';
import DashboardView from './components/DashboardView.vue';
import NodesView from './components/NodesView.vue';
import PlansView from './components/PlansView.vue';
import PlanDetail from './components/PlanDetail.vue';
import UploadCert from './components/UploadCert.vue';

const tab = ref('dashboard');
const dashboard = ref(null);
const live = ref(true);
const lastError = ref('');
const selectedPlanId = ref(null);
let timer = null;

const activeTab = () => (selectedPlanId.value ? 'plans' : tab.value);

async function refresh() {
  try {
    dashboard.value = await api.dashboard();
    lastError.value = '';
  } catch (e) {
    lastError.value = e.message;
    live.value = false;
  }
}

function go(t) {
  tab.value = t;
  selectedPlanId.value = null;
}
function openPlan(id) {
  selectedPlanId.value = id;
}

onMounted(async () => {
  await refresh();
  timer = setInterval(refresh, 4000);
});
onBeforeUnmount(() => clearInterval(timer));
</script>

<template>
  <header class="app-header">
    <h1>🔐 TLS 证书轮换工作台</h1>
    <span class="sub">集中管理域名 · 证书链 · 部署节点 · 切换记录（私钥不进入本系统）</span>
    <span class="spacer"></span>
    <span class="live-dot" :class="{ off: lastError }">
      <i :class="{ pulse: !lastError }"></i>{{ lastError ? '后端不可达' : '实时同步 4s' }}
    </span>
    <button class="ghost tiny" @click="refresh">立即刷新</button>
  </header>

  <nav class="tabs">
    <div class="tab" :class="{ active: activeTab() === 'dashboard' }" @click="go('dashboard')">📋 到期清单与节点矩阵</div>
    <div class="tab" :class="{ active: activeTab() === 'plans' }" @click="go('plans')">🚀 部署计划与切换记录</div>
    <div class="tab" :class="{ active: activeTab() === 'nodes' }" @click="go('nodes')">🧪 节点模拟器</div>
  </nav>

  <main>
    <DashboardView v-if="tab === 'dashboard' && !selectedPlanId" :dashboard="dashboard"
      @uploaded="refresh" @create-plan="openPlan" />
    <PlansView v-else-if="tab === 'plans' && !selectedPlanId" @open="openPlan" />
    <NodesView v-else-if="tab === 'nodes'" :dashboard="dashboard" @changed="refresh" />
    <PlanDetail v-else :plan-id="selectedPlanId" @back="go('plans')" @changed="refresh" />
  </main>
</template>
