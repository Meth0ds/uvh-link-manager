<?php

namespace App\Http\Controllers;

use App\Models\EmailToken;
use App\Support\Auth\CompromisedAccessRevocation;
use App\Support\Auth\CredentialChangeResponse;
use App\Support\Ids;
use App\Support\LinkIntentRegistry;
use App\Support\PrivateArtifactCleanup;
use App\Support\UvhRequest;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Mailbox-authorized emergency revocation; never grants account access. */
final class SecurityIncidentController
{
    /**
     * Consume the explicit one-use incident bearer. Email possession can stop
     * access, but cannot authenticate, change identity or disable MFA.
     */
    public function revokeCompromisedAccess(Request $request): JsonResponse
    {
        $token = UvhRequest::inputString($request, 'token');
        if (preg_match('/^[A-Za-z0-9_-]{43}$/D', $token) !== 1) {
            return response()->json(['error' => __('messages.error_1fcded71c0ec74')], 400);
        }

        $tokenHash = Ids::sha256Hex($token);
        $snapshot = EmailToken::where('id', $tokenHash)
            ->where('kind', 'security_revoke')->whereNull('used_at')->first(['id', 'user_id']);
        $result = $snapshot ? CompromisedAccessRevocation::admit($snapshot, $tokenHash) : null;

        if (! $result) {
            return response()->json(['error' => __('messages.error_1fcded71c0ec74')], 400);
        }
        foreach ($result['artifacts'] as $artifact) {
            PrivateArtifactCleanup::afterCommit($artifact['id'], $artifact['path']);
        }
        LinkIntentRegistry::afterCommit($result['user_id']);

        return CredentialChangeResponse::forUser($request, $result['user_id'], [
            'message' => __('messages.error_4c90f20b5ab8b4'),
        ]);
    }
}
