<?php

namespace App\Support;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

final class RecoveryAuthorization
{
    /** Transactional role/session revalidation and fresh proof; no passwords leave Laravel. */
    public function authorize(Request $request, string $action): ?JsonResponse
    {
        $password = UvhRequest::inputString($request, 'password');
        $factor = UvhRequest::inputString($request, 'factorCode');
        if ($password === '' || strlen($password) > 72 || strlen($factor) > 24) {
            return response()->json(['error' => 'Introduce contraseña y segundo factor.'], 422);
        }
        $result = DB::transaction(function () use ($request, $password, $factor, $action): string {
            $context = SecurityContext::lock(UvhRequest::user($request), UvhRequest::sessionId($request), true);
            if ($context === null || ! $context->user->is_admin || ! $context->user->mfa_enabled || $context->user->email_verified_at === null) {
                return 'stale';
            }
            $proof = MfaStepUp::verify($context->user, $context->session, $password, $factor, true, 'local-recovery');
            if ($proof['status'] !== 'ok') {
                return $proof['status'];
            }
            if (isset($proof['recovery_codes'])) {
                $context->user->update(['recovery_codes' => $proof['recovery_codes'], 'updated_at' => $proof['verified_at']]);
            }
            Audit::write($context->user->id, 'admin.recovery.authorized', 'session', UvhRequest::sessionId($request), ['action' => $action], UvhRequest::ip($request));

            return 'ok';
        });

        return $result === 'ok' ? null : response()->json(['error' => 'No se pudo verificar la autorización. Reautentícate y vuelve a intentarlo.', 'reason' => 'recovery_step_up_required'], $result === 'locked' ? 429 : 403);
    }
}
