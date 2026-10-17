<?php

namespace App\Http\Middleware;

use App\Support\Language;
use App\Support\ResponseLanguage;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

final class RequestLanguage
{
    public function handle(Request $request, Closure $next): Response
    {
        $previous = app()->getLocale();
        // Existing integration clients keep Spanish unless they explicitly negotiate.
        $language = $request->is('api/*')
            ? Language::negotiate($request->header('Accept-Language'))
            : Language::fromRequest($request, Language::isFirstPartyHost($request->getHost()));
        if (! config('uvh.localisation_enabled')) {
            $language = 'es';
        }
        app()->setLocale(Language::locale($language));
        try {
            return ResponseLanguage::apply($next($request), $language);
        } finally {
            app()->setLocale($previous);
        }
    }
}
