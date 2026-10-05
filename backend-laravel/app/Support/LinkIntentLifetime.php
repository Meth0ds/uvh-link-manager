<?php

namespace App\Support;

/** Shared lifetime for cached handoffs and their admission counters. */
final class LinkIntentLifetime
{
    public static function hours(): int
    {
        return max(1, (int) config('uvh.intent_ttl_hours'));
    }
}
