<?php

namespace Tests\Fixtures;

/** A readable prefix followed by an I/O failure, never a legitimate EOF. */
final class FailedReadStream
{
    public static string $prefix = '';

    public static bool $stall = false;

    public mixed $context;

    private int $offset = 0;

    public function stream_open(string $path, string $mode, int $options, ?string &$openedPath): bool
    {
        return true;
    }

    public function stream_read(int $count): string|false
    {
        if ($this->offset >= strlen(self::$prefix)) {
            return self::$stall ? '' : false;
        }
        $read = substr(self::$prefix, $this->offset, min($count, 7));
        $this->offset += strlen($read);

        return $read;
    }

    public function stream_eof(): bool
    {
        return false;
    }

    /** @return array<int|string, int> */
    public function stream_stat(): array
    {
        return [];
    }
}
