export const PLAN_STATUS = {
  draft: '草稿',
  canary_running: '灰度发布中',
  canary_failed: '灰度失败',
  awaiting_approval: '待确认推进',
  bulk_running: '全量发布中',
  partial: '部分成功',
  complete: '已完成',
  paused: '已暂停',
  rolled_back: '已回滚',
  rollback_failed: '回滚失败',
};

export const ITEM_STATUS = {
  pending: '待下发',
  dispatched: '已下发',
  success: '成功',
  failed: '失败',
  timeout: '超时',
  skipped: '已跳过',
};

export const NODE_BEHAVIOR = {
  success: '正常',
  timeout: '超时',
  duplicate: '重复回执',
  flaky: '首次失败',
};

export const BEHAVIOR_DESC = {
  success: '正常：延迟后回执成功',
  timeout: '超时：处理 >5s，先发超时、迟到成功回执',
  duplicate: '重复回执：成功后补发一条相同回执',
  flaky: '首次失败：第一次失败保留旧版，重试成功',
};

export function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  const p = (n) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())} ${p(dt.getHours())}:${p(dt.getMinutes())}`;
}

export function fpShort(fp, n = 12) {
  return fp ? fp.slice(0, n) + '…' : '—';
}
