<?php

namespace App\Http\Middleware;

use App\Support\LocalRecoveryGate;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/** Protect the direct backend port too; the public gateway alone cannot freeze writes. */
final class LocalRecoveryMaintenance
{
    public function handle(Request $request, Closure $next): Response
    {
        if (! config('recovery.enabled') || app()->environment('production') || $request->is('api/v1/admin/updates', 'api/v1/admin/updates/*')) {
            return $next($request);
        }
        if (! LocalRecoveryGate::paused()) {
            return $next($request);
        }

        return response()->json(['error' => 'La aplicación está en mantenimiento.', 'reason' => 'local_maintenance'], 503)
            ->header('Cache-Control', 'no-store')->header('Retry-After', '30');
    }
}
