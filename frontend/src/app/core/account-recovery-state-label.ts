import type { AccountRecoveryStatus } from "./models";

/**
 * Where a reinforced account recovery stands.
 *
 * The review queue's badge and its filter read the same map. The wording is
 * singular because it describes one case; a filter over that state reads the same
 * way in Spanish ("Estado: Aprobada" agrees with recuperación).
 */
export const ACCOUNT_RECOVERY_STATE_LABEL: Record<AccountRecoveryStatus, string> = {
  requested: "Email pendiente",
  email_confirmed: "Lista para revisar",
  in_review: "En revisión",
  approved: "Aprobada",
  rejected: "Rechazada",
  completed: "Completada",
  expired: "Caducada",
  cancelled: "Cancelada",
};

/**
 * The states the review queue offers, in the backend's own priority order.
 *
 * `requested` is deliberately absent: that case has no confirmed mailbox yet, so
 * there is nothing to review and no card can be acted on. The queue orders its
 * rows with `email_confirmed` first for the same reason.
 */
export const ACCOUNT_RECOVERY_REVIEW_FILTER: readonly AccountRecoveryStatus[] = [
  "email_confirmed",
  "in_review",
  "approved",
  "completed",
  "rejected",
  "expired",
  "cancelled",
];

export function accountRecoveryStateLabel(status: AccountRecoveryStatus): string {
  return ACCOUNT_RECOVERY_STATE_LABEL[status];
}
