<?php

namespace App\Http\Controllers;

use App\Support\Audit;
use App\Support\Auth\AccountQueries;
use App\Support\Auth\AccountReadContext;
use App\Support\Auth\SessionRevocationAdmission;
use App\Support\MailAdmissionException;
use App\Support\SessionManager;
use App\Support\UvhRequest;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class AccountSessionsController
{
    public function sessions(Request $request): JsonResponse
    {
        $context = AccountReadContext::resolve(UvhRequest::user($request), UvhRequest::sessionId($request));
        if ($context === null) {
            return response()->json(['error' => 'No autenticado'], 401);
        }

        return response()->json(AccountQueries::sessions($context));
    }

    /**
     * Account-scoped security posture without credential or network details.
     * Activity uses an explicit action allowlist and omits metadata/IP hashes.
     */
    public function securityCenter(Request $request): JsonResponse
    {
        $context = AccountReadContext::resolve(UvhRequest::user($request), UvhRequest::sessionId($request));
        if ($context === null) {
            return response()->json(['error' => 'No autenticado'], 401);
        }

        return response()->json(AccountQueries::securityCenter($context));
    }

    public function revokeSession(Request $request, string $id): JsonResponse
    {
        if (! preg_match('/^[a-f0-9]{64}$/D', $id)) {
            return response()->json(['error' => 'Sesión no encontrada'], 404);
        }
        $user = UvhRequest::user($request);
        $currentId = UvhRequest::sessionId($request);
        $current = $id === $currentId;
        try {
            $found = SessionRevocationAdmission::revoke($user, $currentId, $id);
        } catch (MailAdmissionException) {
            return response()->json(['error' => 'No se pudo guardar el aviso de seguridad. No se revocó la sesión. Inténtalo de nuevo.'], 503);
        }
        if (! $found) {
            return response()->json(['error' => 'Sesión no encontrada'], 404);
        }

        $response = response()->json(['ok' => true, 'current' => $current]);

        return $current ? $response->withCookie(SessionManager::clearCookie()) : $response;
    }

    /**
     * Cierre masivo conservando la sesión que llama: revoca todas las demás
     * sesiones sin cerrar de la cuenta. No toca credenciales ni exige step-up,
     * igual que la revocación individual, y es idempotente. El contador es de
     * filas cerradas ahora, incluidas las que expiraron sin cerrarse antes.
     */
    public function revokeOtherSessions(Request $request): JsonResponse
    {
        $user = UvhRequest::user($request);
        $currentId = UvhRequest::sessionId($request);
        try {
            // El aviso de seguridad se admite en la misma transacción que el
            // cierre, como en el cambio de contraseña: sin aviso entregable no
            // se cierra nada, y una repetición sin filas que cerrar no manda
            // otro correo.
            $revoked = SessionRevocationAdmission::others($user, $currentId);
        } catch (MailAdmissionException) {
            Audit::write($user->id, 'auth.email_delivery_failed', 'user', $user->id, ['kind' => 'sessions_revoked_others']);

            return response()->json(['error' => 'No se pudo guardar el aviso de seguridad. No se cerró ninguna sesión. Inténtalo de nuevo más tarde'], 503);
        }
        if ($revoked < 0) {
            return response()->json(['error' => 'La sesión cambió. Vuelve a iniciar sesión antes de cerrar accesos.'], 409);
        }

        return response()->json(['ok' => true, 'revoked' => $revoked]);
    }

    /**
     * Cierre total: revoca todas las sesiones de la cuenta, incluida la actual,
     * y limpia la cookie para que este navegador no vuelva a presentar la fila
     * muerta. La cuenta queda fuera en todos los dispositivos.
     */
    public function revokeAllSessions(Request $request): JsonResponse
    {
        $user = UvhRequest::user($request);
        $currentId = UvhRequest::sessionId($request);
        try {
            $revoked = SessionRevocationAdmission::all($user, $currentId);
        } catch (MailAdmissionException) {
            Audit::write($user->id, 'auth.email_delivery_failed', 'user', $user->id, ['kind' => 'sessions_revoked_all']);

            return response()->json(['error' => 'No se pudo guardar el aviso de seguridad. No se cerró ninguna sesión. Inténtalo de nuevo más tarde'], 503);
        }
        if ($revoked < 0) {
            return response()->json(['error' => 'La sesión cambió. Vuelve a iniciar sesión antes de cerrar accesos.'], 409);
        }

        return response()->json(['ok' => true, 'revoked' => $revoked])->withCookie(SessionManager::clearCookie());
    }
}
