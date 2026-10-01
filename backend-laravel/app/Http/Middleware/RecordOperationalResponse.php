<?php

namespace App\Http\Middleware;

use App\Support\HttpLatency;
use App\Support\OperationalMetrics;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpFoundation\StreamedResponse;

final class RecordOperationalResponse
{
    public function handle(Request $request, Closure $next): Response
    {
        $startedAt = hrtime(true);
        try {
            $response = $next($request);
        } catch (\Throwable $error) {
            OperationalMetrics::increment('http.server_error');
            HttpLatency::observe('prepare', hrtime(true) - $startedAt);
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

        HttpLatency::observe('prepare', hrtime(true) - $startedAt);
        if ($response instanceof StreamedResponse && $response->getCallback() !== null) {
            $callback = $response->getCallback();
            $response->setCallback(static function () use ($callback): void {
                $started = hrtime(true);
                try {
                    $callback();
                    OperationalMetrics::increment('http.stream_completed');
                } catch (\Throwable $error) {
                    OperationalMetrics::increment('http.stream_failed');
                    throw $error;
                } finally {
                    HttpLatency::observe('stream', hrtime(true) - $started);
                }
            });
        }

        return $response;
    }
}
