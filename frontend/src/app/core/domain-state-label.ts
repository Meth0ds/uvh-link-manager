import type { DomainState } from "./models";

/**
 * How a domain state is written in the panel: the domains list, the admin panel
 * and the single-domain diagnostic page all read this map.
 *
 * The wording is the diagnostic one, because that is the page where the label
 * has to carry meaning: it names the step in progress ("Comprobando DNS",
 * "Preparando HTTPS") and the owner's next move ("Requiere atención") instead of
 * classifying the domain. The list and the admin badge are shorter contexts, but
 * they read the same sentence the diagnostic page shows for the same state, so a
 * state can never mean one thing in a row and another in its own page.
 */
export const DOMAIN_STATE_LABEL: Record<DomainState, string> = {
  pending: "Pendiente de verificación",
  verifying: "Comprobando DNS",
  verified: "DNS verificado",
  provisioning: "Preparando HTTPS",
  active: "Activo",
  error: "Requiere atención",
  disabled: "Desactivado",
};

export function domainStateLabel(state: DomainState): string {
  return DOMAIN_STATE_LABEL[state];
}

/** Every state, in the order the panel's filters offer them. */
export const DOMAIN_STATE_ORDER: readonly DomainState[] = [
  "pending",
  "verifying",
  "verified",
  "provisioning",
  "active",
  "error",
  "disabled",
];
