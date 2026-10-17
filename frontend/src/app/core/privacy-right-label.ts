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
  access: $localize`:@@ui.bf904abc16526a:Acceso`,
  rectification: $localize`:@@ui.a4087000d1c446:Rectificación`,
  erasure: $localize`:@@ui.c0d17cac29eba1:Supresión`,
  objection: $localize`:@@ui.fed2b79f0a3091:Oposición`,
  restriction: $localize`:@@ui.373cfa6f54d5ab:Limitación del tratamiento`,
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
  in_progress: $localize`:@@ui.a193059ef75192:En revisión`,
  waiting_user: $localize`:@@ui.1a29582725a618:Requiere respuesta`,
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
  access: $localize`:@@ui.51a47e95de6deb:Consulta qué datos personales trata UVH sobre ti, para qué y con quién se comparten. La descarga automática de datos es una opción adicional.`,
  rectification: $localize`:@@ui.953a0fc73baf21:Indica qué dato es inexacto o incompleto y qué corrección solicitas. Para cambiar tu nombre puedes usar también los ajustes de perfil.`,
  erasure: $localize`:@@ui.f3d9f046a9a069:Solicita la supresión de tus datos e indica su alcance. Algunos pueden conservarse cuando exista una obligación o fundamento legal; la respuesta debe explicarlo.`,
  objection: $localize`:@@ui.180624155e1cc5:Identifica el tratamiento al que te opones y las circunstancias de tu situación. La solicitud se valora según la base jurídica y el tratamiento concreto.`,
  restriction: $localize`:@@ui.87c8ff01cfb8d5:Explica qué tratamiento quieres limitar y por qué, por ejemplo mientras se comprueba la exactitud de un dato o se valora una oposición.`,
  portability: $localize`:@@ui.ab16adea01b3b7:Solicita los datos que hayas facilitado cuando se traten de forma automatizada sobre la base del consentimiento o de un contrato, en un formato estructurado y reutilizable.`,
};

export function privacyRightMessageAuthor(role: PrivacyRightMessage["authorRole"], own = false): string {
  return role === "admin" ? $localize`:@@ui.a98544978a79d2:Equipo de privacidad` : role === "system" ? $localize`:@@ui.25f851b4bbc80b:Actualización del sistema` : own ? $localize`:@@ui.b02c02324c13fb:Tú` : $localize`:@@ui.cb031867280258:Titular de la cuenta`;
}

export function privacyRightNextStep(status: PrivacyRightStatus): string {
  return ({
    submitted: $localize`:@@ui.88e2cf93896e76:El equipo debe revisar tu solicitud y responder dentro del plazo indicado.`,
    in_progress: $localize`:@@ui.bfbf77ec9ed822:Tu solicitud está en revisión. La respuesta se incorporará a este expediente.`,
    waiting_user: $localize`:@@ui.ab4a44205ecd71:Lee la petición del equipo y aporta la información necesaria. Este estado no suspende automáticamente el plazo indicado.`,
    completed: $localize`:@@ui.34848bb05577fd:El equipo ha registrado una resolución. Revisa su contenido para conocer las medidas aplicadas y su alcance.`,
    rejected: $localize`:@@ui.723802641c48e7:Revisa la respuesta motivada y las vías de reclamación. El cierre del expediente no impide ejercerlas.`,
    cancelled: $localize`:@@ui.cb03378634a15a:Has cancelado esta solicitud. Si necesitas ejercer de nuevo el derecho, puedes registrar otra.`,
  })[status];
}
