<?php

namespace App\Http\Middleware;

use App\Support\OperationalMetrics;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

final class RecordOperationalResponse
{
    public function handle(Request $request, Closure $next): Response
    {
        $startedAt = hrtime(true);
        try {
            $response = $next($request);
        } catch (\Throwable $error) {
            OperationalMetrics::increment('http.server_error');
            throw $error;
        }

        if ($response->getStatusCode() >= 500) {
            OperationalMetrics::increment('http.server_error');
        }
        if ($response->getStatusCode() === 429) {
            // Keep cardinality bounded: the private metrics endpoint exposes
            // aggregate pressure only, never route, IP, account or token.
            OperationalMetrics::increment('http.too_many_requests');
        }
        if ((hrtime(true) - $startedAt) >= 2_000_000_000) {
            OperationalMetrics::increment('http.slow_request');
        }

        return $response;
    }
}
