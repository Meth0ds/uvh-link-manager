<?php

namespace Tests\Fixtures;

/** Only armed inside isolated PHPUnit child processes. */
final class ExportFragmentFault
{
    public static bool $enabled = false;

    public static int $ordinal = 0;

    public static int $selected = 1;

    public static string $fault = 'normal';

    public static array $opened = [];

    public static function open(string $path, string $mode): mixed
    {
        if (! self::$enabled || $path !== 'php://temp/maxmemory:2097152' || $mode !== 'r+b') {
            return \fopen($path, $mode);
        }
        self::$ordinal++;
        if (self::$ordinal === self::$selected) {
            if (self::$fault === 'allocation-error') {
                throw new \RuntimeException('Fixture: temporary volume opening failed');
            }
            if (self::$fault === 'allocation-false') {
                return false;
            }
            $resource = \fopen('uvh-export-fragment://selected', 'r+b');
        } else {
            $resource = \fopen($path, $mode);
        }
        self::$opened[] = $resource;

        return $resource;
    }
}
