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
  pending: $localize`:@@ui.de1c2d344762f9:Pendiente de verificación`,
  verifying: $localize`:@@ui.c00f0f560899d7:Comprobando DNS`,
  verified: $localize`:@@ui.75155f8e5b8627:DNS verificado`,
  provisioning: $localize`:@@ui.dbd22407d65c08:Preparando HTTPS`,
  active: $localize`:@@ui.723858144bd548:Activo`,
  error: $localize`:@@ui.5d265f2433957c:Requiere atención`,
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
