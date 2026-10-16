<?php

namespace App\Http\Controllers;

use App\Models\Link;
use App\Support\QrAttribution;
use App\Support\RedirectService;
use App\Support\SignedToken;
use App\Support\UrlUtil;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

final class NativeAppLinkController
{
    public function resolve(Request $request): JsonResponse
    {
        abort_unless(config('app_links.native'), 404);
        if (app()->environment('production') && ! $request->isSecure()) {
            return $this->unavailable(404);
        }
        if (! $request->isJson() || strlen($request->getContent()) > 8192 || array_diff(array_keys($request->all()), ['launchUrl', 'profileId', 'attemptId', 'challenge', 'password', 'grant'])) {
            return $this->unavailable(422);
        }
        // No panel cookies, workspace headers or ambient unlock credentials are
        // read. Browsers must be same-origin; native clients send no Origin.
        $origin = $request->header('Origin');
        if ($origin !== null && $origin !== $request->getSchemeAndHttpHost()) {
            return $this->unavailable(403);
        }
        $url = $request->input('launchUrl');
        $profile = $request->input('profileId');
        $attempt = $request->input('attemptId');
        if (! is_string($url) || strlen($url) > 2048 || ! is_string($profile) || ! Str::isUuid($profile) || ! is_string($attempt) || ! Str::isUuid($attempt)) {
            return $this->unavailable(422);
        }
        $parts = parse_url($url);
        if (! is_array($parts) || ($parts['scheme'] ?? '') !== 'https' || isset($parts['user']) || isset($parts['port']) || isset($parts['fragment']) || ! preg_match('~^/a/([A-Za-z0-9_-]{1,64})$~D', $parts['path'] ?? '', $m)) {
            return $this->unavailable(422);
        }
        $targetHost = RedirectService::canonicalHost((string) ($parts['host'] ?? ''));
        $requestHost = RedirectService::canonicalHost($request->getHost());
        $central = $requestHost === RedirectService::canonicalHost((string) config('uvh.public_host'));
        if (! $central && $requestHost !== $targetHost) {
            return $this->unavailable(422);
        }
        $domainId = RedirectService::resolveDomainId($targetHost);
        if (! is_int($domainId) || $domainId <= 0) {
            return $this->unavailable(404);
        }
        parse_str($parts['query'] ?? '', $query);
        if (array_diff(array_keys($query), ['qr', 'handoff']) || (isset($query['qr']) && (! is_string($query['qr']) || QrAttribution::token($query['qr']) === null))) {
            return $this->unavailable(422);
        }
        $profile = strtolower($profile);
        $alias = UrlUtil::normalizeAlias($m[1]);
        $host = $targetHost;
        $challengeClaims = ['purpose' => 'native-challenge', 'context' => hash('sha256', json_encode([$host, $alias, $profile, $attempt, $request->ip()], JSON_THROW_ON_ERROR))];
        $challenge = $request->input('challenge');
        $decoded = is_string($challenge) ? SignedToken::verify($challenge, fn ($v) => json_decode($v, true)) : null;
        if ($decoded !== $challengeClaims) {
            return response()->json(['kind' => 'challenge_required', 'challenge' => SignedToken::sign(json_encode($challengeClaims, JSON_THROW_ON_ERROR), 300_000)], 202)->header('Cache-Control', 'no-store');
        }
        $ctx = app(RedirectController::class)->context($request, $alias);
        unset($ctx['unlock_token']);
        $ctx['host'] = $targetHost;
        $ctx['native_profile'] = $profile;
        $ctx['native_protocol'] = true;
        $ctx['app_attempt_id'] = $attempt;
        $ctx['qr_public_id'] = $query['qr'] ?? null;
        $grant = $request->input('grant');
        if ($grant !== null && (! is_string($grant) || strlen($grant) > 4096)) {
            return $this->unavailable(422);
        }
        $ctx['app_grant'] = $grant;
        $password = $request->input('password');
        if ($password !== null) {
            if (! is_string($password) || $password === '' || strlen($password) > 72) {
                return $this->unavailable(422);
            }
            $domain = RedirectService::resolveDomainId($host);
            $link = is_int($domain) && $domain > 0 ? Link::where('domain_id', $domain)->whereRaw('lower(alias) = ?', [$alias])->first() : null;
            if (! $link || ! $link->password_hash || ! Hash::check($password, $link->password_hash)) {
                return response()->json(['kind' => 'password_required'], 401)->header('Cache-Control', 'no-store');
            }
            $ctx['unlock_token'] = SignedToken::sign(json_encode(['alias' => $alias, 'host' => $host, 'link' => $link->id, 'password_version' => (int) $link->password_version], JSON_THROW_ON_ERROR), 300_000);
        }
        $outcome = RedirectService::resolve($ctx);
        if ($outcome['kind'] === 'password_required') {
            return response()->json(['kind' => 'password_required'], 401)->header('Cache-Control', 'no-store');
        }
        if (! in_array($outcome['kind'], ['app_opening', 'redirect'], true)) {
            return $this->unavailable($outcome['kind'] === 'gone' ? 410 : 404);
        }
        $result = ['kind' => 'web', 'webUrl' => $outcome['location'], 'grant' => $outcome['grant'] ?? null];
        if (($outcome['app']['kind'] ?? null) === 'native') {
            $result = ['kind' => 'content', 'route' => $outcome['app']['route'], 'profileId' => $outcome['app']['profileId'], 'webUrl' => $outcome['location'], 'grant' => $outcome['grant']];
        }

        return response()->json($result)->header('Cache-Control', 'no-store')->header('X-Robots-Tag', 'noindex, nofollow');
    }

    private function unavailable(int $status): JsonResponse
    {
        return response()->json(['kind' => 'unavailable'], $status)->header('Cache-Control', 'no-store');
    }
}
