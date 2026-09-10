<script setup>
import { ref } from 'vue';
import { api, errorText } from '../api';

const emit = defineEmits(['uploaded']);
const open = ref(false);
const label = ref('');
const pem = ref('');
const busy = ref(false);
const error = ref('');
const coverage = ref(null);

function onFile(e) {
  const f = e.target.files?.[0];
  if (!f) return;
  if (f.size > 256 * 1024) {
    error.value = '文件过大（>256KB），证书链应为纯文本小文件';
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    pem.value = String(reader.result || '');
    if (!label.value) label.value = f.name.replace(/\.(pem|crt|cer|chain)$/i, '');
  };
  reader.readAsText(f);
}

async function submit() {
  busy.value = true;
  error.value = '';
  coverage.value = null;
  try {
    const res = await api.uploadCert({ label: label.value || '未命名证书', pem: pem.value });
    coverage.value = res.coveredDomains;
    emit('uploaded', res);
    pem.value = '';
    label.value = '';
    setTimeout(() => (open.value = false), 1400);
  } catch (e) {
    error.value = errorText(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div>
    <button class="ghost tiny" @click="open = !open">＋ 上传新证书链</button>
    <div v-if="open" class="panel" style="margin-top:10px">
      <div class="hd"><h3>上传证书链（仅证书，不含私钥）</h3></div>
      <div class="bd">
        <div class="alert info small">
          系统会自动核对三件事：<b>有效期</b>（叶子及链上 CA 当前均须有效）、<b>证书链</b>（签名连续、链尾自签根、顺序为 叶子→中间→根）、<b>域名覆盖</b>（SAN 必须覆盖受管域名）。
          检测到 PRIVATE KEY 将直接拒绝；同一叶子指纹不可重复上传。
        </div>
        <div v-if="error" class="alert error">{{ error }}</div>
        <div v-if="coverage" class="alert success">
          上传成功，域名覆盖：
          <span v-for="(d,i) in coverage" :key="i">
            <b :class="d.covered ? 'ok-text' : 'danger-text'">{{ d.name }}{{ d.covered ? '✓' : '✗' }}</b>{{ i < coverage.length - 1 ? '，' : '' }}
          </span>
        </div>
        <label class="field">
          <span>证书标签（便于识别，如 v3-2027 通配符）</span>
          <input v-model="label" placeholder="例如：v3-通配符新证" />
        </label>
        <label class="field">
          <span>证书链 PEM（可粘贴，或选择 .pem/.crt 文件）</span>
          <textarea v-model="pem" placeholder="-----BEGIN CERTIFICATE-----&#10;（叶子证书）&#10;-----END CERTIFICATE-----&#10;-----BEGIN CERTIFICATE-----&#10;（中间 CA）&#10;-----END CERTIFICATE-----&#10;...根 CA"></textarea>
        </label>
        <input type="file" accept=".pem,.crt,.cer,.chain,text/plain" @change="onFile" style="width:auto;margin-bottom:12px" />
        <div class="row">
          <button :disabled="busy || !pem.trim()" @click="submit">
            {{ busy ? '校验并入库…' : '核对并上传' }}
          </button>
          <button class="ghost" @click="open = false">取消</button>
        </div>
      </div>
    </div>
  </div>
</template>
