<?php

namespace App\Http\Middleware;

use App\Support\RequestTrace;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpFoundation\StreamedResponse;

final class CorrelateRequest
{
    public function handle(Request $request, Closure $next): Response
    {
        // This is an internal FastCGI value overwritten by nginx, not an HTTP header.
        $id = RequestTrace::push($request->server('UVH_REQUEST_ID'));
        try {
            $response = $next($request);
            if ($response instanceof StreamedResponse && $response->getCallback() !== null) {
                $callback = $response->getCallback();
                $response->setCallback(static function () use ($callback, $id): void {
                    RequestTrace::push($id);
                    try {
                        $callback();
                    } finally {
                        RequestTrace::pop();
                    }
                });
            }
            $response->headers->set('X-Request-ID', $id);

            return $response;
        } finally {
            RequestTrace::pop();
        }
    }
}
