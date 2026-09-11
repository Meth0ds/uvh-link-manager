<?php

namespace App\Http\Controllers;

use App\Models\ApiToken;
use App\Models\User;
use App\Models\UvhSession;
use App\Support\Audit;
use App\Support\Ids;
use App\Support\IsoDate;
use App\Support\MailAdmissionException;
use App\Support\MfaStepUp;
use App\Support\UvhMail;
use App\Support\UvhRequest;
use App\Support\WorkspaceAccess;
use App\Support\WorkspaceLimits;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class TokenController
{
    private const SCOPES = ['links:read', 'links:write', 'analytics:read', 'domains:read', 'domains:write'];

    private const MAX_ACTIVE_TOKENS = WorkspaceLimits::ACTIVE_TOKENS;

    public function index(Request $request)
    {
        $workspaceId = UvhRequest::workspaceId($request);
        $total = ApiToken::where('workspace_id', $workspaceId)->count();
        $query = ApiToken::where('workspace_id', $workspaceId)->orderByDesc('created_at');
        $tokens = $query->limit(100)->get()->map(fn ($t) => $this->dto($t));

        return response()->json(['tokens' => $tokens, 'truncated' => $total > 100]);
    }

    public function store(Request $request)
    {
        $workspaceId = UvhRequest::workspaceId($request);
        $user = UvhRequest::user($request);

        $name = trim(UvhRequest::inputString($request, 'name'));
        $rawScopes = $request->input('scopes', []);
        $scopes = is_array($rawScopes) ? array_values($rawScopes) : [];
        $expiresAt = $request->input('expiresAt');
        $password = UvhRequest::inputString($request, 'password');
        $factorCode = trim(UvhRequest::inputString($request, 'factorCode'));

        if (! mb_check_encoding($name, 'UTF-8') || mb_strlen($name) < 2 || mb_strlen($name) > 80 || preg_match('/[\x00-\x1f\x7f]/', $name)
            || ! is_array($rawScopes)
            || count($scopes) < 1 || count($scopes) > count(self::SCOPES)
            || count(array_filter($scopes, 'is_string')) !== count($scopes)
            || count(array_unique($scopes)) !== count($scopes)
            || count(array_diff($scopes, self::SCOPES)) > 0
            || $password === '' || strlen($password) > 72 || strlen($factorCode) > 24) {
            return response()->json(['error' => 'Datos inválidos'], 422);
        }
        if ($expiresAt !== null && ! is_string($expiresAt)) {
            return response()->json(['error' => 'Datos inválidos'], 422);
        }
        $plain = 'uvh_'.Ids::randomToken(32);
        $sessionId = UvhRequest::sessionId($request);
        $expiresAtValue = null;
        if (is_string($expiresAt) && $expiresAt !== '') {
            $expiresAtValue = IsoDate::parse($expiresAt);
            if ($expiresAtValue === null) {
                return response()->json(['error' => 'Datos inválidos'], 422);
            }
            if ($expiresAtValue->isPast() || $expiresAtValue->gt(now()->addYear())) {
                return response()->json(['error' => 'La caducidad debe estar entre ahora y un año'], 422);
            }
        }
        try {
            $result = DB::transaction(function () use ($workspaceId, $name, $plain, $scopes, $expiresAtValue, $user, $sessionId, $password, $factorCode): array {
                // Keep the global lock order user -> session -> workspace. Account
                // deletion holds the user row before revoking workspace resources;
                // reversing this order here could deadlock both operations.
                $lockedUser = User::where('id', $user->id)->whereNull('deleted_at')->lockForUpdate()->first();
                $session = UvhSession::where('id', $sessionId)->where('user_id', $user->id)
                    ->whereNull('revoked_at')->lockForUpdate()->first();
                if (! $lockedUser || ! $lockedUser->email_verified_at || ! $session
                    || (int) $session->security_version !== (int) $lockedUser->security_version) {
                    return ['status' => 'stale'];
                }
                // Serialise issuance per workspace so a burst cannot bypass the
                // active-token cap.
                if (! WorkspaceAccess::getMembershipLocked(
                    $user->id,
                    $workspaceId,
                    'editor',
                    expectedSecurityVersion: (int) $user->security_version,
                )) {
                    return ['status' => 'forbidden'];
                }
                $active = ApiToken::where('workspace_id', $workspaceId)->whereNull('revoked_at')
                    ->where(fn ($q) => $q->whereNull('expires_at')->orWhere('expires_at', '>', now()))
                    ->count();
                if ($active >= self::MAX_ACTIVE_TOKENS) {
                    return ['status' => 'limit'];
                }
                $stepUp = MfaStepUp::verify($lockedUser, $session, $password, $factorCode);
                if ($stepUp['status'] !== 'ok') {
                    return ['status' => $stepUp['status']];
                }
                if (isset($stepUp['recovery_codes'])) {
                    $lockedUser->update(['recovery_codes' => $stepUp['recovery_codes'], 'updated_at' => now()]);
                }

                $token = ApiToken::create([
                    'workspace_id' => $workspaceId,
                    'name' => $name,
                    'token_hash' => Ids::sha256Hex($plain),
                    'scopes' => array_values($scopes),
                    'expires_at' => $expiresAtValue,
                    'created_by' => $user->id,
                ]);
                // Admit the warning with the credential and persisted recovery-code
                // consumption. Never return a usable plain token without its notice.
                if (! UvhMail::apiTokenCreated($lockedUser->email, $token->name)) {
                    throw new MailAdmissionException('API token notice outbox admission failed');
                }

                return ['status' => 'created', 'factor' => $stepUp['factor'], 'token' => $token];
            });
        } catch (MailAdmissionException) {
            Audit::write($user->id, 'auth.email_delivery_failed', 'workspace', $workspaceId, ['kind' => 'api_token_created']);

            return response()->json(['error' => 'No se pudo guardar el aviso de seguridad. No se creó el token API. Inténtalo de nuevo más tarde'], 503);
        }
        if ($result['status'] === 'forbidden') {
            return response()->json(['error' => 'Tu acceso al workspace cambió. Recarga antes de continuar.'], 403);
        }
        if ($result['status'] === 'stale') {
            return response()->json(['error' => 'La sesión cambió. Vuelve a iniciar sesión'], 409);
        }
        if ($result['status'] === 'password') {
            return response()->json(['error' => 'Contraseña incorrecta'], 403);
        }
        if ($result['status'] === 'factor') {
            return response()->json(['error' => 'El código de autenticación o recuperación es incorrecto'], 403);
        }
        if ($result['status'] !== 'created') {
            return response()->json(['error' => 'Límite de tokens activos alcanzado'], 429);
        }
        /** @var ApiToken $token */
        $token = $result['token'];

        Audit::write($user->id, 'api_token.create', 'api_token', $token->id, [
            'scopes' => $scopes,
            'factor' => $result['factor'],
        ], UvhRequest::ip($request), workspaceId: $workspaceId);

        return response()->json(['token' => $this->dto($token->refresh()), 'plainToken' => $plain], 201);
    }

    public function destroy(Request $request, int $id)
    {
        $workspaceId = UvhRequest::workspaceId($request);
        $user = UvhRequest::user($request);

        $result = DB::transaction(function () use ($workspaceId, $user, $id): string {
            if (! WorkspaceAccess::getMembershipLocked(
                $user->id,
                $workspaceId,
                'editor',
                expectedSecurityVersion: (int) $user->security_version,
            )) {
                return 'forbidden';
            }
            $token = ApiToken::where('id', $id)->where('workspace_id', $workspaceId)->lockForUpdate()->first();
            if (! $token) {
                return 'not_found';
            }
            $token->update(['revoked_at' => now()]);

            return 'revoked';
        });
        if ($result === 'forbidden') {
            return response()->json(['error' => 'Tu acceso al workspace cambió. Recarga antes de continuar.'], 403);
        }
        if ($result === 'not_found') {
            return response()->json(['error' => 'Token no encontrado'], 404);
        }
        Audit::write($user->id, 'api_token.revoke', 'api_token', $id, null, UvhRequest::ip($request), workspaceId: $workspaceId);

        return response()->json(['ok' => true]);
    }

    private function dto(ApiToken $t): array
    {
        return [
            'id' => $t->id,
            'name' => $t->name,
            'scopes' => is_array($t->scopes) ? array_values($t->scopes) : [],
            'lastUsedAt' => $this->iso($t->last_used_at),
            'expiresAt' => $this->iso($t->expires_at),
            'revokedAt' => $this->iso($t->revoked_at),
            'createdAt' => $this->iso($t->created_at),
        ];
    }

    private function iso(mixed $value): ?string
    {
        return \App\Support\IsoDate::format($value);
    }
}
