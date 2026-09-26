<?php

namespace App\Support;

/**
 * El catálogo cerrado del centro de notificaciones. Un kind que no está aquí
 * no existe: `NotificationInbox::record()` lo rechaza en vez de inventar una
 * fila que ninguna pantalla sabría mostrar ni preferencia alguna gobernar.
 *
 * Cada kind declara:
 *  - `category`: `mandatory` —seguridad o contrato; nunca configurable— u
 *    `operational` —configurable: Inmediato / Resumen diario / Solo UVH /
 *    Desactivado—. Un usuario no puede desactivar los avisos críticos de
 *    credenciales, MFA, email, exportación o eliminación de cuenta.
 *  - `workspace`: si el evento nace ligado a un workspace.
 *  - `route`: ruta interna del panel donde se resuelve el asunto, o null.
 *  - `title`: etiqueta corta en español con la que la bandeja presenta el
 *    aviso. El texto dinámico (nombre de workspace, alias) viaja aparte en
 *    `subject`, capturado en el momento del evento.
 *
 * La superficie de tipos del frontend (`notification-kinds.ts`) es un espejo
 * declarado de este catálogo: añadir un kind es tocar ambos lados a la vez,
 * igual que las etapas de exportación.
 */
final class NotificationKinds
{
    public const CATEGORY_MANDATORY = 'mandatory';

    public const CATEGORY_OPERATIONAL = 'operational';

    // Obligatorios: seguridad de la cuenta o respuesta a una solicitud propia.
    public const PASSWORD_CHANGED = 'password_changed';

    public const SESSIONS_REVOKED_OTHERS = 'sessions_revoked_others';

    public const SESSIONS_REVOKED_ALL = 'sessions_revoked_all';

    public const MFA_ENABLED = 'mfa_enabled';

    public const MFA_RECONFIGURED = 'mfa_reconfigured';

    public const MFA_RECOVERY_CODES_REGENERATED = 'mfa_recovery_codes_regenerated';

    public const MFA_DISABLED = 'mfa_disabled';

    public const EMAIL_CHANGE_REQUESTED = 'email_change_requested';

    public const EMAIL_CHANGED = 'email_changed';

    public const DATA_EXPORT_READY = 'data_export_ready';

    public const ACCOUNT_DELETION_SCHEDULED = 'account_deletion_scheduled';

    public const ACCOUNT_DELETION_CANCELLED = 'account_deletion_cancelled';

    public const PRIVACY_REQUEST_RECEIVED = 'privacy_request_received';

    public const PRIVACY_REQUEST_UPDATED = 'privacy_request_updated';

    // Operativos: actividad de producto, configurables por el usuario.
    public const API_TOKEN_CREATED = 'api_token_created';

    public const WORKSPACE_OWNERSHIP_TRANSFER = 'workspace_ownership_transfer';

    public const WORKSPACE_DELETED = 'workspace_deleted';

    public const ACCOUNT_RECOVERY_REJECTED = 'account_recovery_rejected';

    /** @var array<string, array{category: string, workspace: bool, route: ?string, title: string}> */
    private const CATALOG = [
        self::PASSWORD_CHANGED => ['category' => self::CATEGORY_MANDATORY, 'workspace' => false, 'route' => '/app/settings/security', 'title' => 'Cambiaste tu contraseña'],
        self::SESSIONS_REVOKED_OTHERS => ['category' => self::CATEGORY_MANDATORY, 'workspace' => false, 'route' => '/app/security', 'title' => 'Cerraste las demás sesiones de tu cuenta'],
        self::SESSIONS_REVOKED_ALL => ['category' => self::CATEGORY_MANDATORY, 'workspace' => false, 'route' => '/app/security', 'title' => 'Cerraste todas las sesiones de tu cuenta'],
        self::MFA_ENABLED => ['category' => self::CATEGORY_MANDATORY, 'workspace' => false, 'route' => '/app/settings/security', 'title' => 'Activaste la verificación en dos pasos'],
        self::MFA_RECONFIGURED => ['category' => self::CATEGORY_MANDATORY, 'workspace' => false, 'route' => '/app/settings/security', 'title' => 'Reconfiguraste la verificación en dos pasos'],
        self::MFA_RECOVERY_CODES_REGENERATED => ['category' => self::CATEGORY_MANDATORY, 'workspace' => false, 'route' => '/app/settings/security', 'title' => 'Regeneraste tus códigos de recuperación'],
        self::MFA_DISABLED => ['category' => self::CATEGORY_MANDATORY, 'workspace' => false, 'route' => '/app/settings/security', 'title' => 'Desactivaste la verificación en dos pasos'],
        self::EMAIL_CHANGE_REQUESTED => ['category' => self::CATEGORY_MANDATORY, 'workspace' => false, 'route' => '/app/settings/profile', 'title' => 'Solicitaste cambiar tu email'],
        self::EMAIL_CHANGED => ['category' => self::CATEGORY_MANDATORY, 'workspace' => false, 'route' => '/app/settings/profile', 'title' => 'Tu email ha cambiado'],
        self::DATA_EXPORT_READY => ['category' => self::CATEGORY_MANDATORY, 'workspace' => false, 'route' => '/app/settings/privacy', 'title' => 'Tu descarga de datos está lista'],
        self::ACCOUNT_DELETION_SCHEDULED => ['category' => self::CATEGORY_MANDATORY, 'workspace' => false, 'route' => '/app/settings/danger', 'title' => 'Tu eliminación de cuenta está programada'],
        self::ACCOUNT_DELETION_CANCELLED => ['category' => self::CATEGORY_MANDATORY, 'workspace' => false, 'route' => '/app/settings/danger', 'title' => 'Cancelaste la eliminación de tu cuenta'],
        self::PRIVACY_REQUEST_RECEIVED => ['category' => self::CATEGORY_MANDATORY, 'workspace' => false, 'route' => '/app/settings/privacy', 'title' => 'Registramos tu solicitud de privacidad'],
        self::PRIVACY_REQUEST_UPDATED => ['category' => self::CATEGORY_MANDATORY, 'workspace' => false, 'route' => '/app/settings/privacy', 'title' => 'Tu solicitud de privacidad cambió de estado'],

        self::API_TOKEN_CREATED => ['category' => self::CATEGORY_OPERATIONAL, 'workspace' => true, 'route' => '/app/tokens', 'title' => 'Se creó un token de API'],
        self::WORKSPACE_OWNERSHIP_TRANSFER => ['category' => self::CATEGORY_OPERATIONAL, 'workspace' => true, 'route' => '/app/team', 'title' => 'Cambió la propiedad del workspace'],
        self::WORKSPACE_DELETED => ['category' => self::CATEGORY_OPERATIONAL, 'workspace' => true, 'route' => null, 'title' => 'Se eliminó un workspace'],
        self::ACCOUNT_RECOVERY_REJECTED => ['category' => self::CATEGORY_OPERATIONAL, 'workspace' => false, 'route' => '/app/settings/security', 'title' => 'Se rechazó una recuperación de cuenta'],
    ];

    /** @return array<string, array{category: string, workspace: bool, route: ?string, title: string}> */
    public static function all(): array
    {
        return self::CATALOG;
    }

    public static function exists(string $kind): bool
    {
        return isset(self::CATALOG[$kind]);
    }

    public static function category(string $kind): ?string
    {
        return self::CATALOG[$kind]['category'] ?? null;
    }

    public static function isMandatory(string $kind): bool
    {
        return self::category($kind) === self::CATEGORY_MANDATORY;
    }

    public static function isWorkspaceScoped(string $kind): bool
    {
        return (bool) (self::CATALOG[$kind]['workspace'] ?? false);
    }

    public static function route(string $kind): ?string
    {
        return self::CATALOG[$kind]['route'] ?? null;
    }

    public static function title(string $kind): ?string
    {
        return self::CATALOG[$kind]['title'] ?? null;
    }
}
