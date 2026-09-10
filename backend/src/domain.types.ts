export type CertStatus = 'valid' | 'expiring' | 'expired';
export type NodeType = 'canary' | 'bulk';
export type NodeBehavior = 'success' | 'timeout' | 'duplicate' | 'flaky';

export type PlanStatus =
  | 'draft'
  | 'canary_running'
  | 'canary_failed'
  | 'awaiting_approval'
  | 'bulk_running'
  | 'partial'
  | 'complete'
  | 'paused'
  | 'rolled_back'
  | 'rollback_failed';

export type ItemStage = 'canary' | 'bulk';
export type ItemStatus =
  | 'pending'
  | 'dispatched'
  | 'success'
  | 'failed'
  | 'timeout'
  | 'skipped';

export type ReceiptKind = 'success' | 'failure' | 'duplicate';

export const EXPIRY_WARN_DAYS = 30;
export const DISPATCH_TIMEOUT_MS = 5000;
export const SIM_MIN_DELAY_MS = 200;
export const SIM_MAX_DELAY_MS = 900;
