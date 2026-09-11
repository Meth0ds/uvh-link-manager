<?php

namespace App\Support;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\RequestException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Server-side hCaptcha verification.
 *
 * The browser only receives the public sitekey. The account secret and the
 * call to siteverify remain on the API, and tokens are never written to logs.
 */
final class HCaptcha
{
    public const VALID = 'valid';

    public const INVALID = 'invalid';

    public const UNAVAILABLE = 'unavailable';

    /** A browser failure marker, NOT a credential or a valid provider token. */
    public const DEVELOPMENT_FAILURE_TOKEN = 'uvh-local-captcha-unavailable';

    private const VERIFY_URL = 'https://api.hcaptcha.com/siteverify';

    private const MAX_TOKEN_BYTES = 8192;

    /** Official hCaptcha test credentials return this synthetic host. */
    private const TEST_SITE_KEY = '10000000-ffff-ffff-ffff-000000000001';

    private const TEST_RESPONSE_HOSTNAME = 'dummy-key-pass';

    public static function configured(string $surface = 'app'): bool
    {
        [$siteKey, $secret] = self::credentials($surface);

        return $siteKey !== '' && $secret !== '';
    }

    public static function developmentFallbackAllowed(Request $request): bool
    {
        // Do not infer development from a request header, frontend build, or
        // merely "not production" (staging/testing must still fail closed).
        $loopbackHosts = ['localhost', '127.0.0.1', '::1', '[::1]'];

        return app()->environment('local')
            && config('app.debug') === true
            && config('uvh.hcaptcha.dev_fallback') === true
            && in_array(strtolower($request->getHost()), $loopbackHosts, true)
            && in_array(strtolower((string) config('uvh.app_host')), $loopbackHosts, true);
    }

    /**
     * Authentication alone may use the explicit local escape hatch. Public
     * reports continue using verify(), with no fallback on any environment.
     * A remote verifier rejection remains INVALID, even in local development.
     *
     * @return self::VALID|self::INVALID|self::UNAVAILABLE
     */
    public static function verifyAuthentication(Request $request, string $token): string
    {
        $allowed = self::developmentFallbackAllowed($request);
        if (hash_equals(self::DEVELOPMENT_FAILURE_TOKEN, $token)) {
            if (! $allowed) {
                return self::result(self::INVALID);
            }
            Log::warning('Local authentication hCaptcha fallback used', ['reason' => 'browser_unavailable']);

            return self::VALID;
        }

        $result = self::verify($request, $token);
        if ($allowed && $result === self::UNAVAILABLE) {
            // No credentials, token, IP or email in this development notice.
            // The provider outage metric is retained, never counted as solved.
            Log::warning('Local authentication hCaptcha fallback used', ['reason' => 'provider_unavailable']);

            return self::VALID;
        }

        return $result;
    }

    /** @return self::VALID|self::INVALID|self::UNAVAILABLE */
    public static function verify(Request $request, string $token, string $surface = 'app'): string
    {
        $token = trim($token);
        if ($token === '' || strlen($token) > self::MAX_TOKEN_BYTES || preg_match('/[\x00-\x1f\x7f]/', $token)) {
            return self::result(self::INVALID);
        }

        [$siteKey, $secret] = self::credentials($surface);
        if ($secret === '' || $siteKey === '') {
            self::logUnavailable('missing_configuration');

            return self::result(self::UNAVAILABLE);
        }

        $payload = [
            'secret' => $secret,
            'response' => $token,
            // Sending the expected sitekey prevents a token solved for a
            // different, easier sitekey from being redeemed here.
            'sitekey' => $siteKey,
        ];
        $ip = (string) ($request->ip() ?? '');
        if (filter_var($ip, FILTER_VALIDATE_IP) !== false) {
            $payload['remoteip'] = $ip;
        }

        try {
            // A verification token is single-use. Automatic retries after an
            // ambiguous network failure could turn a valid token into an
            // already-seen response, so this request is deliberately not
            // retried.
            $response = Http::asForm()
                ->acceptJson()
                ->connectTimeout((int) config('uvh.hcaptcha.connect_timeout_seconds', 2))
                ->timeout((int) config('uvh.hcaptcha.timeout_seconds', 5))
                ->post(self::verificationUrl(), $payload);
        } catch (ConnectionException|RequestException $e) {
            self::logUnavailable('transport_error', $e);

            return self::result(self::UNAVAILABLE);
        } catch (\Throwable $e) {
            self::logUnavailable('unexpected_transport_error', $e);

            return self::result(self::UNAVAILABLE);
        }

        if (! $response->successful()) {
            self::logUnavailable('upstream_http_'.$response->status());

            return self::result(self::UNAVAILABLE);
        }

        $body = $response->json();
        if (! is_array($body) || ! array_key_exists('success', $body)) {
            self::logUnavailable('invalid_upstream_response');

            return self::result(self::UNAVAILABLE);
        }
        if ($body['success'] === true) {
            $hostname = is_string($body['hostname'] ?? null)
                ? strtolower(rtrim(trim($body['hostname']), '.'))
                : '';
            if ($hostname === '') {
                self::logUnavailable('missing_response_hostname');

                return self::result(self::UNAVAILABLE);
            }

            // In production the host guard has already established a trusted
            // application host. Binding the provider result to that exact host
            // prevents a token solved for the same public sitekey elsewhere
            // from being redeemed on the authentication origin.
            $expected = app()->environment('production')
                ? strtolower(rtrim($request->getHost(), '.'))
                : strtolower(rtrim((string) config(
                    $surface === 'public' ? 'uvh.public_host' : 'uvh.app_host'
                ), '.'));
            if ($expected === '' || ! self::hostnameMatches($expected, $hostname, $siteKey)) {
                return self::result(self::INVALID);
            }

            return self::result(self::VALID);
        }

        $codes = is_array($body['error-codes'] ?? null)
            ? array_values(array_filter($body['error-codes'], 'is_string'))
            : [];
        $configurationErrors = ['missing-input-secret', 'invalid-input-secret', 'sitekey-secret-mismatch'];
        if (array_intersect($configurationErrors, $codes) !== []) {
            self::logUnavailable('provider_configuration_rejected', null, $codes);

            return self::result(self::UNAVAILABLE);
        }

        return self::result(self::INVALID);
    }

    private static function hostnameMatches(string $expected, string $actual, string $siteKey): bool
    {
        if (hash_equals($expected, $actual)) {
            return true;
        }

        // hCaptcha does not bind its official pass-through test key to the
        // browser hostname: siteverify deliberately returns "dummy-key-pass".
        // Permit that documented sentinel only outside production and only
        // for the exact official test sitekey. Real keys keep strict origin
        // binding, and production can never enter this exception.
        return ! app()->environment('production')
            && hash_equals(self::TEST_SITE_KEY, $siteKey)
            && hash_equals(self::TEST_RESPONSE_HOSTNAME, $actual);
    }

    private static function verificationUrl(): string
    {
        $url = trim((string) config('uvh.hcaptcha.verify_url', self::VERIFY_URL));
        $parts = parse_url($url);
        $valid = is_array($parts)
            && in_array($parts['scheme'] ?? null, ['http', 'https'], true)
            && is_string($parts['host'] ?? null)
            && $parts['host'] !== ''
            && ($parts['path'] ?? '') === '/siteverify'
            && ! isset($parts['user'])
            && ! isset($parts['pass'])
            && ! isset($parts['query'])
            && ! isset($parts['fragment']);
        $official = hash_equals(self::VERIFY_URL, $url);

        // Overrides exist solely for the isolated E2E verifier. Every other
        // environment is immutable so a compromised variable cannot redirect
        // credentials or CAPTCHA responses to an attacker-controlled service.
        if (! $valid || (! $official && ! app()->environment('testing'))) {
            throw new \RuntimeException('Invalid hCaptcha verification endpoint');
        }

        return $url;
    }

    /** @return self::VALID|self::INVALID|self::UNAVAILABLE */
    private static function result(string $result): string
    {
        OperationalMetrics::increment('hcaptcha.'.$result);

        return $result;
    }

    /** @return array{0: string, 1: string} */
    private static function credentials(string $surface): array
    {
        if ($surface === 'public') {
            return [
                trim((string) config('uvh.hcaptcha.public_site_key')),
                trim((string) config('uvh.hcaptcha.public_secret')),
            ];
        }

        return [
            trim((string) config('uvh.hcaptcha.site_key')),
            trim((string) config('uvh.hcaptcha.secret')),
        ];
    }

    /** @param list<string> $codes */
    private static function logUnavailable(string $reason, ?\Throwable $error = null, array $codes = []): void
    {
        Log::warning('hCaptcha verification unavailable', array_filter([
            'reason' => $reason,
            'provider_codes' => $codes === [] ? null : $codes,
            'exception' => $error ? $error::class : null,
        ]));
    }
}
