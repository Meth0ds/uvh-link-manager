<?php

namespace App\Support;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;

/**
 * Small first-party CAPTCHA used by registration.
 *
 * The answer never travels to the browser: the challenge token is encrypted
 * with the application secret and the expected answer is kept in the shared
 * cache. Challenges are bound to the issuing IP, expire quickly, allow only a
 * handful of attempts, and are deleted after a successful check.
 */
final class Captcha
{
    private const TTL_SECONDS = 300;

    private const MAX_ATTEMPTS = 5;

    /** @return array{challenge: string, prompt: string, expiresIn: int} */
    public static function issue(Request $request): array
    {
        $left = random_int(12, 48);
        $right = random_int(2, 9);
        $id = Ids::randomToken(18);
        $answer = (string) ($left + $right);

        Cache::put(self::key($id), [
            'answer' => hash('sha256', $answer),
            'ip' => UvhCrypto::hashIp((string) ($request->ip() ?? '')),
            'attempts' => 0,
        ], now()->addSeconds(self::TTL_SECONDS));

        $payload = json_encode([
            'id' => $id,
            'ip' => UvhCrypto::hashIp((string) ($request->ip() ?? '')),
        ], JSON_THROW_ON_ERROR);

        return [
            'challenge' => UvhCrypto::encryptAtRest($payload),
            'prompt' => "¿Cuánto es {$left} + {$right}?",
            'expiresIn' => self::TTL_SECONDS,
        ];
    }

    public static function verify(Request $request, string $token, string $answer): bool
    {
        if ($token === '' || strlen($token) > 2048 || strlen($answer) > 16 || ! preg_match('/^\d{1,4}$/', trim($answer))) {
            return false;
        }

        try {
            $payload = json_decode(UvhCrypto::decryptAtRest($token), true, 4, JSON_THROW_ON_ERROR);
        } catch (\Throwable) {
            return false;
        }

        $id = $payload['id'] ?? null;
        $ip = $payload['ip'] ?? null;
        if (! is_string($id) || ! preg_match('/^[A-Za-z0-9_-]{16,128}$/', $id) || ! is_string($ip)) {
            return false;
        }
        if (! hash_equals($ip, UvhCrypto::hashIp((string) ($request->ip() ?? '')))) {
            return false;
        }

        $state = Cache::get(self::key($id));
        if (! is_array($state) || ! is_string($state['answer'] ?? null)) {
            return false;
        }

        $attempts = (int) ($state['attempts'] ?? 0);
        if ($attempts >= self::MAX_ATTEMPTS) {
            return false;
        }

        $normalized = trim($answer);
        if (! hash_equals($state['answer'], hash('sha256', $normalized))) {
            // A bounded failure counter prevents brute-forcing even if the
            // route limiter is bypassed through multiple concurrent requests.
            $state['attempts'] = $attempts + 1;
            Cache::put(self::key($id), $state, now()->addSeconds(self::TTL_SECONDS));

            return false;
        }

        Cache::forget(self::key($id));

        return true;
    }

    private static function key(string $id): string
    {
        return 'uvh:captcha:'.Ids::sha256Hex($id);
    }
}
