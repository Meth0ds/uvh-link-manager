import type { WebhookDelivery } from "./models";

/**
 * Whether a webhook receives events.
 *
 * Written once because the webhook list and its inspector both show it: the list
 * printed it as a hand-written pair in the template and the inspector inflected
 * it for its own sentence, so the two could disagree.
 */
export const WEBHOOK_STATE_LABEL: Record<"active" | "paused", string> = {
  active: "Activo",
  paused: "Pausado",
};

/**
 * Where one delivery attempt stands.
 *
 * The webhook list and the inspector documented this map twice, word for word.
 */
export const WEBHOOK_DELIVERY_LABEL: Record<WebhookDelivery["status"], string> = {
  pending: "En cola",
  processing: "Enviando",
  success: "Entregada",
  failed: "Fallida",
};

/**
 * The icon the inspector pairs with each delivery state.
 *
 * It lives here for the same reason the label does: it is presentation vocabulary
 * of the same state, and two surfaces drawing the same state differently would be
 * the same defect in another medium.
 */
export const WEBHOOK_DELIVERY_ICON: Record<WebhookDelivery["status"], string> = {
  pending: "schedule",
  processing: "sync",
  success: "check",
  failed: "error_outline",
};

export function webhookStateLabel(active: boolean): string {
  return active ? WEBHOOK_STATE_LABEL.active : WEBHOOK_STATE_LABEL.paused;
}

export function webhookDeliveryLabel(status: WebhookDelivery["status"]): string {
  return WEBHOOK_DELIVERY_LABEL[status];
}

export function webhookDeliveryIcon(status: WebhookDelivery["status"]): string {
  return WEBHOOK_DELIVERY_ICON[status];
}
