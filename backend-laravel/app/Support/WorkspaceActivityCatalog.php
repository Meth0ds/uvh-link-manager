<?php

namespace App\Support;

/** Public projection allowlist, not a generic serializer of the audit trail. */
final class WorkspaceActivityCatalog
{
    // resource type, fixed label, outcome. "pending" means admission, never
    // delivery. Unknown actions and mismatched resource types stay private.
    public const EVENTS = [
        'link.create' => ['link', 'Enlace creado', 'completed'],
        'link.update' => ['link', 'Enlace actualizado', 'completed'],
        'link.state_change' => ['link', 'Estado del enlace cambiado', 'completed'],
        'link.delete' => ['link', 'Enlace enviado a la papelera', 'completed'],
        'link.restore' => ['link', 'Enlace restaurado', 'completed'],
        'domain.create' => ['domain', 'Dominio añadido', 'completed'],
        'domain.disable' => ['domain', 'Dominio desactivado', 'completed'],
        'domain.delete' => ['domain', 'Dominio eliminado', 'completed'],
        'domain.tls_requested' => ['domain', 'Certificado solicitado', 'pending'],
        'domain.activate' => ['domain', 'Dominio activado', 'completed'],
        'domain.verify' => ['domain', 'Comprobación DNS', 'dns'],
        'domain.revalidate' => ['domain', 'Revalidación DNS', 'dns'],
        'domain.verification_failed' => ['domain', 'Comprobación DNS fallida', 'failed'],
        'domain.tls_failed' => ['domain', 'Emisión del certificado fallida', 'failed'],
        'api_token.create' => ['api_token', 'Token API creado', 'completed'],
        'api_token.revoke' => ['api_token', 'Token API revocado', 'completed'],
        'webhook.create' => ['webhook', 'Webhook creado', 'completed'],
        'webhook.update' => ['webhook', 'Webhook actualizado', 'completed'],
        'webhook.delete' => ['webhook', 'Webhook eliminado', 'completed'],
        'webhook.resend' => ['webhook', 'Reenvío de webhook admitido', 'pending'],
        'workspace.create' => ['workspace', 'Workspace creado', 'completed'],
        'workspace.rename' => ['workspace', 'Workspace renombrado', 'completed'],
        'workspace.role_change' => ['workspace', 'Rol de miembro cambiado', 'completed'],
        'workspace.ownership_transfer' => ['workspace', 'Propiedad transferida', 'completed'],
        'workspace.member_remove' => ['workspace', 'Miembro retirado', 'completed'],
        'workspace.leave' => ['workspace', 'Salida del workspace', 'completed'],
        'workspace.invite' => ['workspace', 'Invitación admitida', 'pending'],
        'workspace.invitation_resent' => ['workspace', 'Reenvío de invitación admitido', 'pending'],
        'workspace.invitation_accepted' => ['workspace', 'Invitación aceptada', 'completed'],
        'workspace.invitation_rejected' => ['workspace', 'Invitación rechazada', 'completed'],
        'workspace.invitation_cancelled' => ['workspace', 'Invitación cancelada', 'completed'],
        'workspace.invitation_delivery_failed' => ['workspace', 'Admisión de invitación fallida', 'failed'],
        'admin.link_block' => ['link', 'Enlace bloqueado por moderación', 'completed'],
        'admin.link_unblock' => ['link', 'Bloqueo de moderación retirado', 'completed'],
    ];
}
