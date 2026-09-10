// 后端 API 封装：统一错误信息提取（Nest 400 可能带 problems 数组）
async function request(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const err = new Error();
    err.status = res.status;
    if (data && typeof data === 'object') {
      err.message = data.message || `请求失败 (${res.status})`;
      err.problems = data.problems || null;
      err.payload = data;
    } else {
      err.message = String(data) || `请求失败 (${res.status})`;
    }
    throw err;
  }
  return data;
}

export const api = {
  dashboard: () => request('/api/dashboard'),
  listCerts: () => request('/api/certificates'),
  uploadCert: (body) => request('/api/certificates', { method: 'POST', body }),
  listPlans: () => request('/api/plans'),
  getPlan: (id) => request(`/api/plans/${id}`),
  createPlan: (body) => request('/api/plans', { method: 'POST', body }),
  canary: (id) => request(`/api/plans/${id}/canary`, { method: 'POST' }),
  advance: (id) => request(`/api/plans/${id}/advance`, { method: 'POST' }),
  pause: (id) => request(`/api/plans/${id}/pause`, { method: 'POST' }),
  resume: (id) => request(`/api/plans/${id}/resume`, { method: 'POST' }),
  rollback: (id) => request(`/api/plans/${id}/rollback`, { method: 'POST' }),
  retryItem: (id, itemId) =>
    request(`/api/plans/${id}/items/${itemId}/retry`, { method: 'POST' }),
  listNodes: () => request('/api/nodes'),
  setBehavior: (id, behavior) =>
    request(`/api/nodes/${id}/behavior`, { method: 'POST', body: { behavior } }),
  injectOnce: (id, behavior) =>
    request(`/api/nodes/${id}/inject`, { method: 'POST', body: { behavior } }),
  rollbackCandidates: (id) => request(`/api/nodes/${id}/rollback-candidates`),
};

export function errorText(err) {
  if (!err) return '';
  if (err.problems?.length) return `${err.message}\n${err.problems.map((p) => `• ${p}`).join('\n')}`;
  return err.message;
}
