<?php

namespace App\Support;

use Illuminate\Support\Facades\Log;

/** Opaque correlation only; never carry account IDs, tokens, URLs or cookies. */
final class RequestTrace
{
    /** @var list<string> */
    private static array $stack = [];

    public static function push(?string $id = null): string
    {
        $id = is_string($id) && preg_match('/^[a-f0-9]{32}$/D', $id) === 1 ? $id : bin2hex(random_bytes(16));
        self::$stack[] = $id;
        Log::withContext(['correlation_id' => $id]);

        return $id;
    }

    public static function current(): ?string
    {
        return self::$stack === [] ? null : self::$stack[array_key_last(self::$stack)];
    }

    public static function pop(): void
    {
        array_pop(self::$stack);
        Log::withoutContext(['correlation_id']);
        if (self::current() !== null) {
            Log::withContext(['correlation_id' => self::current()]);
        }
    }
}
