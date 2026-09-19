<?php

namespace App\Http\Controllers;

use App\Support\IsoDate;
use App\Support\PendingHandoff;
use App\Support\UvhRequest;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;

/**
 * Public endpoints for the server-side handoff park.
 *
 * The panel used to keep an invitation bearer in `localStorage` for seven days
 * and a prepared-link bearer for one. It now hands the bearer over once, gets
 * an HttpOnly cookie back, and from then on only asks whether one is parked.
 * Nothing here reads the database: parking is signing a cookie, and the check
 * is verifying it, so the surface stays cheap and cannot answer questions about
 * which invitations exist.
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
        return response()->json([
            'invitation' => [
                'pending' => PendingHandoff::pending($request, PendingHandoff::INVITATION),
                'expiresAt' => PendingHandoff::expiresAt($request, PendingHandoff::INVITATION),
            ],
            'linkIntent' => [
                'pending' => PendingHandoff::pending($request, PendingHandoff::INTENT),
                'expiresAt' => PendingHandoff::expiresAt($request, PendingHandoff::INTENT),
            ],
        ]);
    }

    public function forget(Request $request, string $kind): JsonResponse
    {
        if (! PendingHandoff::exists($kind)) {
            return $this->unknownKind();
        }

        return PendingHandoff::clearOn(response()->json(['pending' => false]), $kind);
    }

    private function unknownKind(): JsonResponse
    {
        return response()->json(['error' => 'Handoff desconocido'], 404);
    }
}
