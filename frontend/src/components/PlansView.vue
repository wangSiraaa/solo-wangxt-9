<script setup>
import { onMounted, ref } from 'vue';
import { api } from '../api';
import { fmtDate, PLAN_STATUS } from '../labels';

const emit = defineEmits(['open']);
const plans = ref([]);
const certs = ref([]);

async function load() {
  plans.value = await api.listPlans();
  certs.value = await api.listCerts();
}
function certLabel(id) {
  return certs.value.find((c) => c.id === id)?.label || id.slice(0, 8);
}
onMounted(load);
</script>

<template>
  <div class="panel">
    <div class="hd"><h3>部署计划与切换记录</h3><span class="spacer"></span>
      <button class="ghost tiny" @click="load">刷新</button>
    </div>
    <div class="bd" style="padding:0">
      <table v-if="plans.length">
        <thead>
          <tr><th>计划</th><th>新证书</th><th>状态</th><th>节点进度</th><th>最近信息</th><th>创建时间</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="p in plans" :key="p.id" style="cursor:pointer" @click="emit('open', p.id)">
            <td><b>{{ p.label }}</b></td>
            <td class="small">{{ certLabel(p.newCertificateId) }}</td>
            <td><span class="badge" :class="p.status">{{ PLAN_STATUS[p.status] || p.status }}</span></td>
            <td class="small">
              成功 {{ p.items.filter(i=>!i.isRollback && i.status==='success').length }} /
              失败 {{ p.items.filter(i=>!i.isRollback && i.status==='failed').length }} /
              超时 {{ p.items.filter(i=>!i.isRollback && i.status==='timeout').length }} /
              跳过 {{ p.items.filter(i=>!i.isRollback && i.status==='skipped').length }}
              <span v-if="p.items.some(i=>i.isRollback)" class="badge rolled_back" style="margin-left:6px">含回滚</span>
            </td>
            <td class="small muted" style="max-width:280px">{{ p.lastMessage }}</td>
            <td class="small muted">{{ fmtDate(p.createdAt) }}</td>
            <td><button class="ghost tiny" @click.stop="emit('open', p.id)">详情/操作 →</button></td>
          </tr>
        </tbody>
      </table>
      <div v-else class="bd muted">还没有部署计划。请在「到期清单与节点矩阵」页上传新证书并新建轮换计划。</div>
    </div>
  </div>
</template>
