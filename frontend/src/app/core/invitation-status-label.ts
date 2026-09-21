import type { Invitation } from "./models";

/**
 * Where an invitation stands.
 *
 * The team page is the only surface that prints it, and it printed the raw token
 * inside a Spanish sentence ("Invitado como Miembro · pending"). The wording is
 * feminine because it agrees with the noun the row is about: the invitation.
 */
export const INVITATION_STATUS_LABEL: Record<Invitation["status"], string> = {
  pending: "Pendiente de aceptar",
  accepted: "Aceptada",
  rejected: "Rechazada",
  cancelled: "Cancelada",
  expired: "Caducada",
};

export function invitationStatusLabel(status: Invitation["status"]): string {
  return INVITATION_STATUS_LABEL[status];
}
