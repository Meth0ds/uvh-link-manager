<?php

namespace App\Http\Controllers\Concerns;

/** Shared normalization for user-supplied MFA recovery codes. */
trait NormalizesRecoveryCodes
{
    private function normalizeRecoveryCode(string $code): string
    {
        return strtoupper((string) preg_replace('/[\s-]+/', '', trim($code)));
    }
}
