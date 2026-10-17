/**
 * The audit trail's `resource_type` vocabulary, as the backend emits it
 * (`Audit::write`). One owner for the wording: the workspace activity page and
 * the admin audit list read the same trail and must not name it differently —
 * they already drifted once, with the activity list translating and the console
 * printing `api_token` raw.
 */
const RESOURCE_TYPE_LABELS: Record<string, string> = {
  link: $localize`:@@ui.08dab6446d0e6f:Enlace`,
  domain: $localize`:@@ui.5199d835a3f9ed:Dominio`,
  api_token: $localize`:@@ui.a28c3d95dd910b:Token API`,
  webhook: "Webhook",
  workspace: "Workspace",
  user: "Usuario",
  session: $localize`:@@ui.88efb201a001c2:Sesión`,
  consent: "Consentimiento",
  privacy_notice: $localize`:@@ui.7550ecc73e8880:Aviso de privacidad`,
  privacy_right: $localize`:@@ui.d934390aa7a798:Solicitud de privacidad`,
  account_recovery: $localize`:@@ui.0f25869fbe81d5:Recuperación de cuenta`,
  account_deletion: $localize`:@@ui.4f643aae9ff03e:Eliminación de cuenta`,
  abuse_report: "Denuncia",
  data_export: $localize`:@@ui.e5c1f8189ac771:Exportación de datos`,
  destination_denylist: $localize`:@@ui.ab6d72badf00a3:Destino bloqueado`,
  mail_outbox: $localize`:@@ui.0b61df381e1b1d:Correo`,
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
