<?php

namespace App\Support;

use Throwable;

final class LocalRecoveryGate
{
    public static function paused(): bool
    {
        if (! config('recovery.enabled') || app()->environment('production')) {
            return false;
        }
        try {
            return (app(LocalRecoveryBridge::class)->read('maintenance.json')['maintenance'] ?? true) !== false;
        } catch (Throwable) {
            return true;
        }
    }
}
