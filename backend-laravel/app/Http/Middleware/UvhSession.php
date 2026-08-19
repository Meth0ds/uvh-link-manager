<?php

namespace App\Http\Middleware;

use App\Support\SessionManager;
use App\Support\UvhRequest;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class UvhSession
{
    public function handle(Request $request, Closure $next): Response
    {
        $session = SessionManager::hydrate($request);
        if ($session !== null) {
            $request->attributes->set(UvhRequest::USER, $session['user']);
            $request->attributes->set(UvhRequest::SESSION_ID, $session['session_id']);
        }

        return $next($request);
    }
}
