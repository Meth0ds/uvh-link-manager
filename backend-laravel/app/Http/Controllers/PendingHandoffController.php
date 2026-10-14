<?php

namespace App\Http\Controllers;

use App\Support\Ids;
use App\Support\IsoDate;
use App\Support\PendingHandoff;
use App\Support\RegistrationLinkHandoff;
use App\Support\UvhRequest;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Public endpoints for the server-side handoff park.
 *
 * The panel used to keep an invitation bearer in `localStorage` for seven days
 * and a prepared-link bearer for one. It now hands the bearer over once, gets
 * an HttpOnly cookie back, and from then on only asks whether one is parked.
 * Anonymous parking only signs a cookie and never reveals invitation state.
 * Authenticated reads can restore the hero associated with their own registration.
 */
class PendingHandoffController
{
    public function park(Request $request, string $kind): JsonResponse
    {
        if (! PendingHandoff::exists($kind)) {
            return $this->unknownKind();
        }

        $bearer = trim(UvhRequest::inputString($request, 'token'));
        if (! PendingHandoff::accepts($bearer)) {
            return response()->json(['error' => 'Token inválido'], 422);
        }

        $deadline = PendingHandoff::deadline($kind, UvhRequest::inputString($request, 'expiresAt'));
        if ($deadline === null) {
            return response()->json(['error' => 'La credencial ya ha caducado'], 422);
        }

        return response()->json([
            'pending' => true,
            'expiresAt' => IsoDate::format(Carbon::createFromTimestamp($deadline)),
        ], 201)->withCookie(PendingHandoff::cookie($kind, $bearer, $deadline));
    }

    /**
     * Which handoffs this browser has parked.
     *
     * A boolean and a deadline per kind, never the bearer: the panel needs to
     * decide whether to offer a flow, not to hold the credential.
     */
    public function show(Request $request): JsonResponse
    {
        $user = UvhRequest::user($request);
        $restored = ! PendingHandoff::pending($request, PendingHandoff::INTENT) && $user !== null
            ? RegistrationLinkHandoff::forUser($user) : null;
        $response = response()->json([
            'invitation' => [
                'pending' => PendingHandoff::pending($request, PendingHandoff::INVITATION),
                'expiresAt' => PendingHandoff::expiresAt($request, PendingHandoff::INVITATION),
            ],
            'linkIntent' => [
                'pending' => $restored !== null || PendingHandoff::pending($request, PendingHandoff::INTENT),
                'expiresAt' => $restored !== null ? IsoDate::format(Carbon::createFromTimestamp($restored['expiresAt'])) : PendingHandoff::expiresAt($request, PendingHandoff::INTENT),
            ],
        ]);
        if ($restored !== null) {
            $response->headers->setCookie(PendingHandoff::cookie(PendingHandoff::INTENT, $restored['token'], $restored['expiresAt']));
        }

        return $response;
    }

    public function forget(Request $request, string $kind): JsonResponse
    {
        if (! PendingHandoff::exists($kind)) {
            return $this->unknownKind();
        }

        $user = UvhRequest::user($request);
        if ($kind === PendingHandoff::INTENT && $user !== null) {
            $bearer = PendingHandoff::bearer($request, $kind);
            DB::table('registration_link_handoffs')->where('user_id', $user->id)
                ->when($bearer !== null, fn ($query) => $query->where('intent_hash', Ids::sha256Hex($bearer)))
                ->delete();
        }

        return PendingHandoff::clearOn(response()->json(['pending' => false]), $kind);
    }

    private function unknownKind(): JsonResponse
    {
        return response()->json(['error' => 'Handoff desconocido'], 404);
    }
}
