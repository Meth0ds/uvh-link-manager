<?php

namespace App\Http\Controllers\Concerns;

use App\Support\HCaptcha;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Shared authentication input policy and CAPTCHA HTTP responses. */
trait ValidatesAuthInput
{
    private function captchaError(Request $request, string $token): ?JsonResponse
    {
        $result = HCaptcha::verifyAuthentication($request, $token);
        if ($result === HCaptcha::VALID) {
            return null;
        }
        if ($result === HCaptcha::UNAVAILABLE) {
            return response()->json([
                'error' => 'La verificación antiabuso no está disponible. Espera un momento y vuelve a intentarlo.',
            ], 503);
        }

        // Deliberately generic: do not expose whether a passcode was expired,
        // malformed or already redeemed.
        return response()->json([
            'error' => 'Completa de nuevo la verificación antiabuso.',
        ], 422);
    }

    private function validEmail(string $email): bool
    {
        return $email !== '' && strlen($email) <= 254 && filter_var($email, FILTER_VALIDATE_EMAIL) !== false;
    }

    private function validPassword(string $password): bool
    {
        return strlen($password) >= 10 && strlen($password) <= 72;
    }

    private function validName(string $name): bool
    {
        if (! mb_check_encoding($name, 'UTF-8')) {
            return false;
        }
        $len = mb_strlen($name);

        return $len >= 2 && $len <= 80 && ! preg_match('/[\x00-\x1f\x7f]/', $name);
    }
}
