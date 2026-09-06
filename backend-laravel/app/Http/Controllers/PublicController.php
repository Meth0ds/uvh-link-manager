<?php

namespace App\Http\Controllers;

use App\Support\HCaptcha;
use App\Support\UrlUtil;
use App\Support\UvhCrypto;
use App\Support\UvhRequest;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;

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
        $pages = ['/', '/help', '/status', '/legal/terminos', '/legal/privacidad', '/legal/denuncias'];
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

        $host = strtolower(rtrim($request->getHost(), '.'));
        $publicHost = strtolower(rtrim((string) config('uvh.public_host'), '.'));
        $publicCaptcha = app()->environment('production')
            && in_array($host, [$publicHost, 'www.'.$publicHost], true);
        $captchaSurface = $publicCaptcha ? 'public' : 'app';
        $captchaSiteKey = $publicCaptcha
            ? config('uvh.hcaptcha.public_site_key')
            : config('uvh.hcaptcha.site_key');

        return response()->json([
            'appUrl' => $appUrl,
            'publicHost' => config('uvh.public_host'),
            'appHost' => config('uvh.app_host'),
            'hcaptcha' => [
                'enabled' => HCaptcha::configured($captchaSurface),
                // Public by design. HCAPTCHA_SECRET is never serialized.
                'siteKey' => HCaptcha::configured($captchaSurface)
                    ? (string) $captchaSiteKey
                    : null,
            ],
        ]);
    }

    public function status(Request $request)
    {
        $configured = trim((string) config('uvh.reputation_provider_url')) !== '';
        $host = strtolower(rtrim($request->getHost(), '.'));
        $publicHost = strtolower(rtrim((string) config('uvh.public_host'), '.'));
        $captchaSurface = app()->environment('production')
            && in_array($host, [$publicHost, 'www.'.$publicHost], true)
                ? 'public'
                : 'app';
        $captchaConfigured = HCaptcha::configured($captchaSurface);

        return response()->json([
            'externalAnalysis' => $configured,
            'provider' => $configured ? 'configured' : null,
            'antiAbuse' => [
                'enabled' => $captchaConfigured,
                'provider' => $captchaConfigured ? 'hcaptcha' : null,
            ],
        ]);
    }

    /**
     * Read a monitor-owned status feed. No local liveness signal is consulted:
     * this process is deliberately unable to pronounce itself healthy.
     */
    public function publicStatus()
    {
        $url = trim((string) config('uvh.public_status.feed_url'));
        if (! $this->safeExternalStatusUrl($url)) {
            return response()->json($this->unknownPublicStatus(), 503);
        }

        try {
            $request = Http::acceptJson()
                ->connectTimeout(max(1, min(5, (int) config('uvh.public_status.connect_timeout_seconds', 2))))
                ->timeout(max(2, min(10, (int) config('uvh.public_status.timeout_seconds', 4))))
                ->withoutRedirecting();
            $bearer = trim((string) config('uvh.public_status.feed_bearer'));
            if ($bearer !== '') {
                $request = $request->withToken($bearer);
            }
            $response = $request->get($url);
            if (! $response->successful()) {
                return response()->json($this->unknownPublicStatus(), 503);
            }
            // Bound the body before decoding it. The monitor is independent
            // infrastructure and therefore remains an untrusted input.
            $contentLength = (int) ($response->header('Content-Length') ?? 0);
            $contentType = strtolower(trim(explode(';', (string) $response->header('Content-Type'))[0]));
            $body = $response->body();
            if (($contentLength > 0 && $contentLength > 131072) || strlen($body) > 131072
                || $contentType !== 'application/json') {
                return response()->json($this->unknownPublicStatus(), 503);
            }
            $snapshot = $this->normalizePublicStatus(json_decode($body, true, 32, JSON_THROW_ON_ERROR));
            if ($snapshot === null) {
                return response()->json($this->unknownPublicStatus(), 503);
            }

            $maxAge = max(30, min(3600, (int) config('uvh.public_status.max_age_seconds', 300)));
            $age = now()->timestamp - strtotime($snapshot['generatedAt']);
            // A future timestamp could artificially extend a healthy result.
            // Permit only a small amount of ordinary clock skew.
            if ($age < -60) {
                return response()->json($this->unknownPublicStatus(), 503);
            }
            $stale = $age > $maxAge;
            $snapshot['stale'] = $stale;
            if ($stale) {
                $snapshot['overall'] = 'unknown';
            }

            return response()->json($snapshot, $stale ? 503 : 200)
                ->header('Cache-Control', 'public, max-age=30, stale-if-error=120');
        } catch (\Throwable $error) {
            report($error);

            return response()->json($this->unknownPublicStatus(), 503);
        }
    }

    private function safeExternalStatusUrl(string $url): bool
    {
        if ($url === '' || filter_var($url, FILTER_VALIDATE_URL) === false) {
            return false;
        }
        $parts = parse_url($url);
        $host = strtolower(rtrim((string) ($parts['host'] ?? ''), '.'));

        // The feed is a configuration value, but rejecting local addressing,
        // embedded credentials and non-TLS ports prevents accidental SSRF
        // during deployment or secret rotation.
        return ($parts['scheme'] ?? null) === 'https' && $host !== ''
            && ! isset($parts['user']) && ! isset($parts['pass']) && ! isset($parts['fragment'])
            && (! isset($parts['port']) || (int) $parts['port'] === 443)
            && filter_var($host, FILTER_VALIDATE_IP) === false
            && $host !== 'localhost' && ! str_ends_with($host, '.localhost')
            && ! str_ends_with($host, '.local') && ! str_ends_with($host, '.internal');
    }

    private function normalizePublicStatus(mixed $input): ?array
    {
        if (! is_array($input) || ! is_string($input['generatedAt'] ?? null)
            || strlen($input['generatedAt']) > 64 || strtotime($input['generatedAt']) === false
            || ! is_array($input['components'] ?? null) || ! is_array($input['incidents'] ?? null)) {
            return null;
        }
        $statuses = ['operational', 'degraded', 'major_outage', 'maintenance'];
        // Fixed public names prevent an external feed from exposing topology.
        $componentLabels = [
            'links' => 'Enlaces y redirecciones',
            'panel' => 'Panel y API',
            'webhooks' => 'Entrega de webhooks',
        ];
        $components = [];
        foreach ($componentLabels as $id => $label) {
            $status = $input['components'][$id] ?? null;
            if (! is_string($status) || ! in_array($status, $statuses, true)) {
                return null;
            }
            $components[] = ['id' => $id, 'label' => $label, 'status' => $status];
        }
        $rank = ['operational' => 0, 'maintenance' => 1, 'degraded' => 2, 'major_outage' => 3];
        $overall = collect($components)->sortByDesc(fn ($item) => $rank[$item['status']])->first()['status'];

        $incidents = [];
        foreach (array_slice($input['incidents'], 0, 20) as $incident) {
            if (! is_array($incident)) {
                return null;
            }
            $id = $incident['id'] ?? null;
            $title = $incident['title'] ?? null;
            $message = $incident['message'] ?? null;
            $status = $incident['status'] ?? null;
            $startedAt = $incident['startedAt'] ?? null;
            $updatedAt = $incident['updatedAt'] ?? null;
            if (! is_string($id) || preg_match('/^[A-Za-z0-9_-]{1,80}$/D', $id) !== 1
                || ! $this->safePublicText($title, 160) || ! $this->safePublicText($message, 1000)
                || ! is_string($status) || ! in_array($status, ['investigating', 'identified', 'monitoring', 'resolved'], true)
                || ! is_string($startedAt) || strlen($startedAt) > 64 || strtotime($startedAt) === false
                || ! is_string($updatedAt) || strlen($updatedAt) > 64 || strtotime($updatedAt) === false) {
                return null;
            }
            $incidents[] = compact('id', 'title', 'message', 'status', 'startedAt', 'updatedAt');
        }

        return [
            'overall' => $overall,
            'generatedAt' => $input['generatedAt'],
            'stale' => false,
            'source' => 'external_monitor',
            'components' => $components,
            'incidents' => $incidents,
        ];
    }

    private function safePublicText(mixed $value, int $maximum): bool
    {
        return is_string($value) && $value !== '' && mb_check_encoding($value, 'UTF-8')
            && mb_strlen($value) <= $maximum && preg_match('/[\x00-\x1F\x7F]/u', $value) !== 1;
    }

    private function unknownPublicStatus(): array
    {
        return [
            'overall' => 'unknown', 'generatedAt' => null, 'stale' => true,
            'source' => 'external_monitor_unavailable', 'components' => [], 'incidents' => [],
        ];
    }

    public function report(Request $request)
    {
        $captcha = HCaptcha::verify($request, UvhRequest::inputString($request, 'captchaToken'), 'public');
        if ($captcha === HCaptcha::UNAVAILABLE) {
            return response()->json(['error' => 'La verificación antiabuso no está disponible. Inténtalo de nuevo en unos instantes.'], 503);
        }
        if ($captcha !== HCaptcha::VALID) {
            return response()->json(['error' => 'Completa de nuevo la verificación antiabuso.'], 422);
        }

        $alias = $request->input('alias');
        $reportedUrl = $request->input('reportedUrl');
        $reason = $request->input('reason', '');
        $details = $request->input('details');
        $email = $request->input('email');

        $reason = is_string($reason) ? trim($reason) : $reason;
        $validText = static fn (string $value): bool => mb_check_encoding($value, 'UTF-8')
            && preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', $value) !== 1;
        if (! is_string($reason) || ! $validText($reason) || mb_strlen($reason) < 3 || mb_strlen($reason) > 200) {
            return response()->json(['error' => 'Datos inválidos'], 422);
        }
        if ($details !== null && (! is_string($details) || ! $validText($details) || mb_strlen($details) > 2000)) {
            return response()->json(['error' => 'Datos inválidos'], 422);
        }
        if ($email !== null && (! is_string($email) || ($email !== '' && (! filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 254)))) {
            return response()->json(['error' => 'Datos inválidos'], 422);
        }
        // Internal numeric IDs are deliberately not accepted on this public
        // endpoint. A reporter must possess the short URL or alias rather than
        // probing the global link-ID sequence.
        if ($request->has('linkId')) {
            return response()->json(['error' => 'Datos inválidos'], 422);
        }
        if ($alias !== null && (! is_string($alias) || strlen($alias) > 64)) {
            return response()->json(['error' => 'Datos inválidos'], 422);
        }
        if ($reportedUrl !== null && (! is_string($reportedUrl) || $reportedUrl === '' || strlen($reportedUrl) > 2048 || preg_match('/[\x00-\x1f\x7f]/', $reportedUrl))) {
            return response()->json(['error' => 'Datos inválidos'], 422);
        }

        $resolvedLinkId = null;
        if (is_string($reportedUrl) && $reportedUrl !== '') {
            $resolvedLinkId = $this->resolveReportedLink($reportedUrl);
            if ($resolvedLinkId === -1) {
                return response()->json(['error' => 'Referencia de enlace inválida'], 422);
            }
        } elseif (is_string($alias) && $alias !== '') {
            $a = UrlUtil::normalizeAlias($alias);
            if (UrlUtil::isValidCustomAlias($a) && ! UrlUtil::isReservedAlias($a)) {
                $resolvedLinkId = DB::table('links')->whereRaw('lower(alias) = ?', [$a])->whereNull('domain_id')->whereNull('deleted_at')->value('id');
            }
        }

        if (! $resolvedLinkId) {
            return response()->json(['error' => 'Enlace no encontrado'], 404);
        }

        $day = now()->format('Y-m-d');
        $ip = (string) ($request->ip() ?? '');
        $reporterHash = $ip !== '' ? UvhCrypto::visitorHash($day, $ip, 'abuse-report') : null;
        $result = DB::transaction(function () use ($resolvedLinkId, $day, $reporterHash, $email, $reason, $details): string {
            $link = DB::table('links')->where('id', $resolvedLinkId)->whereNull('deleted_at')->lockForUpdate()->first();
            if (! $link) {
                return 'not_found';
            }
            if (DB::table('abuse_reports')->where('link_id', $resolvedLinkId)->where('report_day', $day)->count() >= 50) {
                return 'full';
            }
            $inserted = DB::table('abuse_reports')->insertOrIgnore([
                'link_id' => $resolvedLinkId,
                'reporter_email' => is_string($email) && $email !== '' ? strtolower($email) : null,
                'reporter_hash' => $reporterHash,
                'report_day' => $day,
                'reason' => $reason,
                'details' => $details,
                'created_at' => now(),
            ]);

            return $inserted === 1 ? 'created' : 'duplicate';
        });
        if ($result === 'not_found') {
            return response()->json(['error' => 'Enlace no encontrado'], 404);
        }
        if ($result === 'full') {
            return response()->json(['error' => 'Este enlace ya tiene el máximo diario de denuncias'], 429);
        }

        return response()->json(['ok' => true], 201);
    }

    /** Resolve a pasted short URL locally; this method never requests the destination. */
    private function resolveReportedLink(string $reference): ?int
    {
        $reference = trim($reference);
        $domainId = null;
        if (UrlUtil::isValidCustomAlias($reference) && ! UrlUtil::isReservedAlias(strtolower($reference))) {
            $alias = UrlUtil::normalizeAlias($reference);
        } else {
            if (! preg_match('#^https?://#i', $reference) && preg_match('#^[^\s/]+/.+#', $reference)) {
                $reference = 'https://'.$reference;
            }
            $valid = UrlUtil::validateDestination($reference);
            if (! $valid['ok']) {
                return -1;
            }
            $parts = parse_url($reference);
            if (! is_array($parts) || ! isset($parts['host'], $parts['path'])) {
                return -1;
            }
            $host = strtolower(rtrim((string) $parts['host'], '.'));
            $publicHost = strtolower((string) config('uvh.public_host'));
            $segments = array_values(array_filter(explode('/', trim((string) $parts['path'], '/')), fn ($part) => $part !== ''));
            if (($host === $publicHost || $host === 'www.'.$publicHost) && count($segments) === 2 && strtolower($segments[0]) === 'r') {
                $alias = UrlUtil::normalizeAlias(rawurldecode($segments[1]));
            } elseif (count($segments) === 1) {
                $alias = UrlUtil::normalizeAlias(rawurldecode($segments[0]));
            } else {
                return -1;
            }
            if ($host !== $publicHost && $host !== 'www.'.$publicHost) {
                $domainId = DB::table('custom_domains')->whereRaw('lower(domain) = ?', [$host])->value('id');
                if (! $domainId) {
                    return null;
                }
            }
        }

        if (! UrlUtil::isValidCustomAlias($alias) || UrlUtil::isReservedAlias($alias)) {
            return -1;
        }

        $query = DB::table('links')->whereRaw('lower(alias) = ?', [$alias])->whereNull('deleted_at');
        $domainId === null ? $query->whereNull('domain_id') : $query->where('domain_id', $domainId);
        $id = $query->value('id');

        return $id ? (int) $id : null;
    }

    public function create()
    {
        return response()->json(['error' => 'Crea una cuenta para acortar enlaces', 'requiresAuth' => true], 401);
    }
}
