import type { MailOutboxStatus } from "./models";

/**
 * Where one transactional message stands in the outbox.
 *
 * The row badge and the outbox filter read the same map, so an operator cannot
 * filter for a state the badge never prints.
 */
export const MAIL_OUTBOX_STATE_LABEL: Record<MailOutboxStatus, string> = {
  pending: "Pendiente",
  queued: "En cola",
  processing: "Procesando",
  sent: "Enviado",
  failed: "Fallido",
  obsolete: "Obsoleto",
  comp_pending: "Compensación pendiente",
  compensating: "Compensando",
  compensated: "Compensado",
};

/**
 * Every state, incidents first: the outbox is a triage surface, so the filter
 * opens on the states that need someone (the view defaults to `failed`).
 */
export const MAIL_OUTBOX_STATE_ORDER: readonly MailOutboxStatus[] = [
  "failed",
  "comp_pending",
  "compensating",
  "compensated",
  "pending",
  "queued",
  "processing",
  "sent",
  "obsolete",
];

export function mailOutboxStateLabel(status: MailOutboxStatus): string {
  return MAIL_OUTBOX_STATE_LABEL[status];
}
