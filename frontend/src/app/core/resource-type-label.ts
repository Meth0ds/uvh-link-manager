/**
 * The audit trail's `resource_type` vocabulary, as the backend emits it
 * (`Audit::write`). One owner for the wording: the workspace activity page and
 * the admin audit list read the same trail and must not name it differently —
 * they already drifted once, with the activity list translating and the console
 * printing `api_token` raw.
 */
const RESOURCE_TYPE_LABELS: Record<string, string> = {
  link: "Enlace",
  domain: "Dominio",
  api_token: "Token API",
  webhook: "Webhook",
  workspace: "Workspace",
  user: "Usuario",
  session: "Sesión",
  consent: "Consentimiento",
  privacy_notice: "Aviso de privacidad",
  privacy_right: "Solicitud de privacidad",
  account_recovery: "Recuperación de cuenta",
  account_deletion: "Eliminación de cuenta",
  abuse_report: "Denuncia",
  data_export: "Exportación de datos",
  destination_denylist: "Destino bloqueado",
  mail_outbox: "Correo",
};

/**
 * A `null` type is an event with no subject (a failed login, a heartbeat), which
 * the console has always called "sistema". An unknown type keeps its raw token
 * instead of being hidden: the console is an investigative surface, and a blank
 * cell there is worse than an untranslated word.
 */
export function resourceTypeLabel(value: string | null | undefined): string {
  if (!value) return "Sistema";

  return RESOURCE_TYPE_LABELS[value] ?? value;
}
