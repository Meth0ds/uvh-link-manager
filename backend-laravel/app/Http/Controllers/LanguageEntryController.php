<?php

namespace App\Http\Controllers;

use App\Support\Language;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

final class LanguageEntryController
{
    public function root(Request $request): Response
    {
        $host = strtolower($request->getHost());
        $firstParty = in_array($host, [config('uvh.public_host'), 'www.'.config('uvh.public_host'), config('uvh.app_host'), 'www.'.config('uvh.app_host')], true);
        $local = app()->environment('local') && in_array($host, ['localhost', '127.0.0.1'], true);
        if (config('uvh.localisation_enabled') && ($firstParty || $local)) {
            return response('', 302, ['Location' => '/'.Language::fromRequest($request).'/', 'Cache-Control' => 'no-store, private', 'Vary' => 'Accept-Language, Cookie']);
        }

        return app(RedirectController::class)->root($request);
    }
}
