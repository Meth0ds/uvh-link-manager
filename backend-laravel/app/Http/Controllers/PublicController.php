<?php

namespace App\Http\Controllers;

use App\Support\UrlUtil;
use App\Support\UvhRequest;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class PublicController
{
    public function health()
    {
        DB::select('SELECT 1');

        return response()->json(['ok' => true, 'service' => 'uvh-api', 'time' => now()->toIso8601String()]);
    }

    public function robots()
    {
        return response("User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /app/\n\nSitemap: https://".config('uvh.public_host')."/sitemap.xml\n", 200)
            ->header('Content-Type', 'text/plain');
    }

    public function sitemap()
    {
        $pages = ['/', '/legal/terminos', '/legal/privacidad', '/legal/denuncias'];
        $urls = implode("\n", array_map(
            fn ($p) => '  <url><loc>https://'.config('uvh.public_host').$p.'</loc></url>',
            $pages,
        ));

        return response(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n{$urls}\n</urlset>",
            200,
        )->header('Content-Type', 'application/xml');
    }

    public function csrf(Request $request)
    {
        return response()->json(['csrfToken' => $request->attributes->get(UvhRequest::CSRF_TOKEN)]);
    }

    public function config(Request $request)
    {
        $appUrl = app()->environment('production')
            ? (string) config('app.url')
            : $request->getScheme().'://'.$request->getHttpHost();

        return response()->json([
            'appUrl' => $appUrl,
            'publicHost' => config('uvh.public_host'),
            'appHost' => config('uvh.app_host'),
        ]);
    }

    public function status()
    {
        $configured = (bool) env('REPUTATION_PROVIDER_URL');

        return response()->json([
            'externalAnalysis' => $configured,
            'provider' => $configured ? 'configured' : null,
        ]);
    }

    public function report(Request $request)
    {
        $alias = $request->input('alias');
        $linkId = $request->input('linkId');
        $reason = $request->input('reason', '');
        $details = $request->input('details');
        $email = $request->input('email');

        if (! is_string($reason) || $reason === '' || mb_strlen($reason) < 3 || mb_strlen($reason) > 200) {
            return response()->json(['error' => 'Datos inválidos'], 422);
        }
        if ($details !== null && (! is_string($details) || mb_strlen($details) > 2000)) {
            return response()->json(['error' => 'Datos inválidos'], 422);
        }
        if ($email !== null && (! is_string($email) || ($email !== '' && (! filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 254)))) {
            return response()->json(['error' => 'Datos inválidos'], 422);
        }
        if ($linkId !== null && (! is_int($linkId) || $linkId < 1)) {
            return response()->json(['error' => 'Datos inválidos'], 422);
        }
        if ($alias !== null && (! is_string($alias) || strlen($alias) > 64)) {
            return response()->json(['error' => 'Datos inválidos'], 422);
        }

        $resolvedLinkId = $linkId !== null ? (int) $linkId : null;
        if (! $resolvedLinkId && is_string($alias) && $alias !== '') {
            $a = UrlUtil::normalizeAlias($alias);
            $resolvedLinkId = DB::table('links')->where('alias', $a)->whereNull('domain_id')->whereNull('deleted_at')->value('id');
        }

        if (! $resolvedLinkId) {
            return response()->json(['error' => 'Enlace no encontrado'], 404);
        }

        $exists = DB::table('links')->where('id', $resolvedLinkId)->whereNull('deleted_at')->exists();
        if (! $exists) {
            return response()->json(['error' => 'Enlace no encontrado'], 404);
        }

        DB::table('abuse_reports')->insert([
            'link_id' => $resolvedLinkId,
            'reporter_email' => is_string($email) && $email !== '' ? strtolower($email) : null,
            'reason' => $reason,
            'details' => $details,
            'created_at' => now(),
        ]);

        return response()->json(['ok' => true], 201);
    }

    public function create()
    {
        return response()->json(['error' => 'Crea una cuenta para acortar enlaces', 'requiresAuth' => true], 401);
    }
}
