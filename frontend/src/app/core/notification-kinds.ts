/**
 * Espejo declarado del catálogo del centro de notificaciones
 * (`App\Support\NotificationKinds` en el backend): los mismos kinds, la misma
 * separación entre obligatorios (nunca configurables) y operativos, y la
 * etiqueta con la que la bandeja presenta cada aviso.
 *
 * El contrato es cerrado por los dos lados: el backend rechaza registrar un
 * kind fuera del catálogo y el decoder rechaza leerlo. Añadir un kind es tocar
 * ambos lados a la vez, igual que las etapas de exportación.
 */
export const NOTIFICATION_KINDS = {
  password_changed: { category: "mandatory", icon: "password", label: "Cambiaste tu contraseña" },
  sessions_revoked_others: { category: "mandatory", icon: "logout", label: "Cerraste las demás sesiones de tu cuenta" },
  sessions_revoked_all: { category: "mandatory", icon: "logout", label: "Cerraste todas las sesiones de tu cuenta" },
  mfa_enabled: { category: "mandatory", icon: "verified_user", label: "Activaste la verificación en dos pasos" },
  mfa_reconfigured: { category: "mandatory", icon: "verified_user", label: "Reconfiguraste la verificación en dos pasos" },
  mfa_recovery_codes_regenerated: { category: "mandatory", icon: "lock_reset", label: "Regeneraste tus códigos de recuperación" },
  mfa_disabled: { category: "mandatory", icon: "no_encrypted_mail", label: "Desactivaste la verificación en dos pasos" },
  email_change_requested: { category: "mandatory", icon: "mail", label: "Solicitaste cambiar tu email" },
  email_changed: { category: "mandatory", icon: "mail", label: "Tu email ha cambiado" },
  data_export_ready: { category: "mandatory", icon: "download", label: "Tu descarga de datos está lista" },
  account_deletion_scheduled: { category: "mandatory", icon: "dangerous", label: "Tu eliminación de cuenta está programada" },
  account_deletion_cancelled: { category: "mandatory", icon: "dangerous", label: "Cancelaste la eliminación de tu cuenta" },
  privacy_request_received: { category: "mandatory", icon: "gavel", label: "Registramos tu solicitud de privacidad" },
  privacy_request_updated: { category: "mandatory", icon: "gavel", label: "Tu solicitud de privacidad cambió de estado" },

  api_token_created: { category: "operational", icon: "key", label: "Se creó un token de API" },
  workspace_ownership_transfer: { category: "operational", icon: "groups", label: "Cambió la propiedad del workspace" },
  workspace_deleted: { category: "operational", icon: "workspaces", label: "Se eliminó un workspace" },
  account_recovery_rejected: { category: "operational", icon: "lock_reset", label: "Se rechazó una recuperación de cuenta" },
} as const;

export type NotificationKind = keyof typeof NOTIFICATION_KINDS;

export type NotificationCategory = (typeof NOTIFICATION_KINDS)[NotificationKind]["category"];

export const NOTIFICATION_DELIVERIES = ["immediate", "daily_digest", "in_app_only", "disabled"] as const;

export type NotificationDelivery = (typeof NOTIFICATION_DELIVERIES)[number];

/** Las cuatro entregas del producto, con la etiqueta que ve el usuario. */
export const NOTIFICATION_DELIVERY_LABELS: Record<NotificationDelivery, string> = {
  immediate: "Inmediato",
  daily_digest: "Resumen diario",
  in_app_only: "Solo UVH",
  disabled: "Desactivado",
};

export function isNotificationKind(value: string): value is NotificationKind {
  return Object.prototype.hasOwnProperty.call(NOTIFICATION_KINDS, value);
}
