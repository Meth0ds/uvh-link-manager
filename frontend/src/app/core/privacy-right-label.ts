import type { PrivacyRightStatus, PrivacyRightType } from "./models";

/**
 * The kinds of request a data subject can file.
 *
 * Read by the form where the right is exercised, the status card that follows it
 * and the admin review queue. The wording of `restriction` is the one the request
 * form needs ("limitación del tratamiento" is the term the right is named by), and
 * it is what the other two surfaces print as well.
 */
export const PRIVACY_RIGHT_TYPE_LABEL: Record<PrivacyRightType, string> = {
  access: "Acceso",
  rectification: "Rectificación",
  erasure: "Supresión",
  objection: "Oposición",
  restriction: "Limitación del tratamiento",
  portability: "Portabilidad",
};

/**
 * Where a request stands.
 *
 * The owner reads it in settings and the platform admin reads it in the review
 * queue, so the wording has to work from both seats. It used to be written twice:
 * `waiting_user` was "Requiere respuesta" for the owner and "Espera al usuario"
 * for the admin, the same case described as two different situations.
 */
export const PRIVACY_RIGHT_STATUS_LABEL: Record<PrivacyRightStatus, string> = {
  submitted: "Registrada",
  in_progress: "En revisión",
  waiting_user: "Requiere respuesta",
  completed: "Resuelta",
  rejected: "Cerrada",
  cancelled: "Cancelada",
};

/** Every kind of right, in the order the form and the admin filter offer them. */
export const PRIVACY_RIGHT_TYPE_ORDER: readonly PrivacyRightType[] = [
  "access",
  "rectification",
  "erasure",
  "objection",
  "restriction",
  "portability",
];

/** Every status, in the order the admin filter offers them. */
export const PRIVACY_RIGHT_STATUS_ORDER: readonly PrivacyRightStatus[] = [
  "submitted",
  "in_progress",
  "waiting_user",
  "completed",
  "rejected",
  "cancelled",
];

const ACTIVE_STATUSES: readonly PrivacyRightStatus[] = ["submitted", "in_progress", "waiting_user"];

export function privacyRightTypeLabel(type: PrivacyRightType): string {
  return PRIVACY_RIGHT_TYPE_LABEL[type];
}

export function privacyRightStatusLabel(status: PrivacyRightStatus): string {
  return PRIVACY_RIGHT_STATUS_LABEL[status];
}

/** The statuses that still expect work, from either side of the request. */
export function privacyRightIsActive(status: PrivacyRightStatus): boolean {
  return (ACTIVE_STATUSES as readonly string[]).includes(status);
}
