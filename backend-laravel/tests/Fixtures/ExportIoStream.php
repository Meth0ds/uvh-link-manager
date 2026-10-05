<?php

namespace Tests\Fixtures;

/** Seekable temp-volume fault fixture; failures are distinct from legitimate EOF. */
final class ExportIoStream
{
    public static string $initialContents = '';

    public static ?int $readFailureAfter = null;

    public static bool $denyRewind = false;

    public static array $opened = [];

    public mixed $context;

    private string $contents = '';

    private int $offset = 0;

    public function stream_open(string $path, string $mode, int $options, ?string &$openedPath): bool
    {
        $this->contents = self::$initialContents;

        return true;
    }

    public function stream_read(int $count): string|false
    {
        $failureAt = self::$readFailureAfter === -1
            ? ((strpos($this->contents, "\n") ?: 0) + 1)
            : self::$readFailureAfter;
        if ($failureAt !== null && $this->offset >= $failureAt) {
            return false;
        }
        $length = min($count, 7);
        if ($failureAt !== null) {
            $length = min($length, $failureAt - $this->offset);
        }
        $value = substr($this->contents, $this->offset, $length);
        $this->offset += strlen($value);

        return $value;
    }

    public function stream_write(string $data): int
    {
        $this->contents = substr_replace($this->contents, $data, $this->offset, strlen($data));
        $this->offset += strlen($data);

        return strlen($data);
    }

    public function stream_seek(int $offset, int $whence): bool
    {
        if (self::$denyRewind || $whence !== SEEK_SET || $offset < 0) {
            return false;
        }
        $this->offset = $offset;

        return true;
    }

    public function stream_tell(): int
    {
        return $this->offset;
    }

    public function stream_eof(): bool
    {
        return self::$readFailureAfter === null && $this->offset >= strlen($this->contents);
    }

    public function stream_stat(): array
    {
        return [];
    }
}
