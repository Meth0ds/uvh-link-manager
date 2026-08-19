<?php

namespace App\Http\Controllers;

use App\Models\ApiToken;
use App\Support\Audit;
use App\Support\Ids;
use App\Support\UvhRequest;
use Illuminate\Http\Request;

class TokenController
{
    private const SCOPES = ['links:read', 'links:write', 'analytics:read', 'domains:read', 'domains:write'];

    public function index(Request $request)
    {
        $workspaceId = UvhRequest::workspaceId($request);
        $tokens = ApiToken::where('workspace_id', $workspaceId)->orderByDesc('created_at')->get()->map(fn ($t) => $this->dto($t));

        return response()->json(['tokens' => $tokens]);
    }

    public function store(Request $request)
    {
        $workspaceId = UvhRequest::workspaceId($request);
        $user = UvhRequest::user($request);

        $name = trim((string) $request->input('name', ''));
        $scopes = (array) $request->input('scopes', []);
        $expiresAt = $request->input('expiresAt');

        if (mb_strlen($name) < 2 || mb_strlen($name) > 80
            || count($scopes) < 1
            || count(array_diff($scopes, self::SCOPES)) > 0) {
            return response()->json(['error' => 'Datos inválidos'], 422);
        }

        $plain = 'uvh_'.Ids::randomToken(32);
        $expiresAtValue = null;
        if (is_string($expiresAt) && $expiresAt !== '') {
            try {
                $expiresAtValue = \Illuminate\Support\Carbon::parse($expiresAt);
            } catch (\Throwable) {
                return response()->json(['error' => 'Datos inválidos'], 422);
            }
        }
        $token = ApiToken::create([
            'workspace_id' => $workspaceId,
            'name' => $name,
            'token_hash' => Ids::sha256Hex($plain),
            'scopes' => array_values($scopes),
            'expires_at' => $expiresAtValue,
            'created_by' => $user->id,
        ]);

        Audit::write($user->id, 'api_token.create', 'api_token', $token->id, ['scopes' => $scopes], UvhRequest::ip($request));

        return response()->json(['token' => $this->dto($token->refresh()), 'plainToken' => $plain], 201);
    }

    public function destroy(Request $request, int $id)
    {
        $workspaceId = UvhRequest::workspaceId($request);
        $user = UvhRequest::user($request);

        $token = ApiToken::where('id', $id)->where('workspace_id', $workspaceId)->first();
        if (! $token) {
            return response()->json(['error' => 'Token no encontrado'], 404);
        }

        $token->update(['revoked_at' => now()]);
        Audit::write($user->id, 'api_token.revoke', 'api_token', $id, null, UvhRequest::ip($request));

        return response()->json(['ok' => true]);
    }

    private function dto(ApiToken $t): array
    {
        return [
            'id' => $t->id,
            'name' => $t->name,
            'scopes' => $t->scopes ?? [],
            'lastUsedAt' => $this->iso($t->last_used_at),
            'expiresAt' => $this->iso($t->expires_at),
            'revokedAt' => $this->iso($t->revoked_at),
            'createdAt' => $this->iso($t->created_at),
        ];
    }

    private function iso(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }

        return $value instanceof \DateTimeInterface
            ? $value->format('Y-m-d\TH:i:s.v\Z')
            : (string) $value;
    }
}
