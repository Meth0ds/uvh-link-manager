import type { PrivacyRightMessage, PrivacyRightStatus, PrivacyRightType } from "./models";

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

export const PRIVACY_RIGHT_GUIDANCE: Record<PrivacyRightType, string> = {
  access: "Consulta qué datos personales trata UVH sobre ti, para qué y con quién se comparten. La descarga automática de datos es una opción adicional.",
  rectification: "Indica qué dato es inexacto o incompleto y qué corrección solicitas. Para cambiar tu nombre puedes usar también los ajustes de perfil.",
  erasure: "Solicita la supresión de tus datos e indica su alcance. Algunos pueden conservarse cuando exista una obligación o fundamento legal; la respuesta debe explicarlo.",
  objection: "Identifica el tratamiento al que te opones y las circunstancias de tu situación. La solicitud se valora según la base jurídica y el tratamiento concreto.",
  restriction: "Explica qué tratamiento quieres limitar y por qué, por ejemplo mientras se comprueba la exactitud de un dato o se valora una oposición.",
  portability: "Solicita los datos que hayas facilitado cuando se traten de forma automatizada sobre la base del consentimiento o de un contrato, en un formato estructurado y reutilizable.",
};

export function privacyRightMessageAuthor(role: PrivacyRightMessage["authorRole"], own = false): string {
  return role === "admin" ? "Equipo de privacidad" : role === "system" ? "Actualización del sistema" : own ? "Tú" : "Titular de la cuenta";
}

export function privacyRightNextStep(status: PrivacyRightStatus): string {
  return ({
    submitted: "El equipo debe revisar tu solicitud y responder dentro del plazo indicado.",
    in_progress: "Tu solicitud está en revisión. La respuesta se incorporará a este expediente.",
    waiting_user: "Lee la petición del equipo y aporta la información necesaria. Este estado no suspende automáticamente el plazo indicado.",
    completed: "El equipo ha registrado una resolución. Revisa su contenido para conocer las medidas aplicadas y su alcance.",
    rejected: "Revisa la respuesta motivada y las vías de reclamación. El cierre del expediente no impide ejercerlas.",
    cancelled: "Has cancelado esta solicitud. Si necesitas ejercer de nuevo el derecho, puedes registrar otra.",
  })[status];
}
