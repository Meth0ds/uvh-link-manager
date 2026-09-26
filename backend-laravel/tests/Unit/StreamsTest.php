<?php

namespace Tests\Unit;

use App\Support\Streams;
use PHPUnit\Framework\TestCase;

/**
 * Escrituras streaming fail-closed: un sink que acepta a trozos recibe el
 * buffer entero por reintentos, y un sink que se corta o rechaza provoca
 * excepción —nunca una escritura a medias tomada por buena—.
 */
final class StreamsTest extends TestCase
{
    protected function tearDown(): void
    {
        foreach (['uvh-partial', 'uvh-stalled', 'uvh-unflushable'] as $scheme) {
            if (in_array($scheme, stream_get_wrappers(), true)) {
                stream_wrapper_unregister($scheme);
            }
        }
        parent::tearDown();
    }

    public function test_write_all_retries_until_the_whole_buffer_reaches_a_piecewise_sink(): void
    {
        stream_wrapper_register('uvh-partial', PiecewiseWriteStream::class);
        $stream = fopen('uvh-partial://sink', 'wb');
        $this->assertIsResource($stream);

        $payload = 'un documento de exportación largo que el sink acepta a trozos de tres bytes';
        Streams::writeAll($stream, $payload);
        fclose($stream);

        $this->assertSame($payload, PiecewiseWriteStream::$written, 'every byte must reach the sink');
        $this->assertGreaterThan(1, PiecewiseWriteStream::$calls, 'a partial write must be retried, not assumed complete');
    }

    public function test_write_all_refuses_a_sink_that_stops_accepting_mid_write(): void
    {
        stream_wrapper_register('uvh-stalled', StalledWriteStream::class);
        $stream = fopen('uvh-stalled://sink', 'wb');
        $this->assertIsResource($stream);

        try {
            Streams::writeAll($stream, 'abcdefghijkl');
            $this->fail('a truncated write must fail closed');
        } catch (\RuntimeException) {
            $this->addToAssertionCount(1);
        } finally {
            fclose($stream);
        }

        $this->assertSame(StalledWriteStream::ACCEPTS, strlen(StalledWriteStream::$written), 'only the accepted prefix was ever written');
    }

    public function test_write_all_refuses_a_sink_that_fails_immediately(): void
    {
        stream_wrapper_register('uvh-stalled', StalledWriteStream::class);
        $stream = fopen('uvh-stalled://sink?fail=now', 'wb');
        $this->assertIsResource($stream);

        try {
            Streams::writeAll($stream, 'abc');
            $this->fail('a sink that writes zero bytes must fail closed');
        } catch (\RuntimeException) {
            $this->addToAssertionCount(1);
        } finally {
            fclose($stream);
        }
    }

    public function test_flush_refuses_a_sink_that_cannot_flush(): void
    {
        stream_wrapper_register('uvh-unflushable', UnflushableWriteStream::class);
        $stream = fopen('uvh-unflushable://sink', 'wb');
        $this->assertIsResource($stream);

        try {
            $this->expectException(\RuntimeException::class);
            Streams::flush($stream);
        } finally {
            fclose($stream);
        }
    }
}

/**
 * Sink que acepta como mucho tres bytes por llamada (escritura parcial).
 *
 * @internal
 */
final class PiecewiseWriteStream
{
    public static string $written = '';

    public static int $calls = 0;

    /** @var mixed */
    public $context;

    public function stream_open(string $path, string $mode, int $options, ?string &$openedPath): bool
    {
        self::$written = '';
        self::$calls = 0;

        return true;
    }

    public function stream_write(string $data): int
    {
        self::$calls++;
        $take = substr($data, 0, 3);
        self::$written .= $take;

        return strlen($take);
    }

    public function stream_flush(): bool
    {
        return true;
    }

    public function stream_close(): void {}

    public function stream_eof(): bool
    {
        return true;
    }

    /** @return array<int|string, int> */
    public function stream_stat(): array
    {
        return [];
    }
}

/**
 * Sink que acepta unos bytes y después se corta (disco lleno, I/O parcial).
 *
 * @internal
 */
final class StalledWriteStream
{
    public const ACCEPTS = 4;

    public static string $written = '';

    /** @var mixed */
    public $context;

    private bool $failNow = false;

    public function stream_open(string $path, string $mode, int $options, ?string &$openedPath): bool
    {
        self::$written = '';
        $this->failNow = str_contains($path, 'fail=now');

        return true;
    }

    public function stream_write(string $data): int
    {
        if ($this->failNow || strlen(self::$written) >= self::ACCEPTS) {
            return 0;
        }
        $take = substr($data, 0, self::ACCEPTS - strlen(self::$written));
        self::$written .= $take;

        return strlen($take);
    }

    public function stream_flush(): bool
    {
        return true;
    }

    public function stream_close(): void {}

    public function stream_eof(): bool
    {
        return true;
    }

    /** @return array<int|string, int> */
    public function stream_stat(): array
    {
        return [];
    }
}

/**
 * Sink cuyo flush falla: publicar sin volcar el buffer no es publicar.
 *
 * @internal
 */
final class UnflushableWriteStream
{
    /** @var mixed */
    public $context;

    public function stream_open(string $path, string $mode, int $options, ?string &$openedPath): bool
    {
        return true;
    }

    public function stream_write(string $data): int
    {
        return strlen($data);
    }

    public function stream_flush(): bool
    {
        return false;
    }

    public function stream_close(): void {}

    public function stream_eof(): bool
    {
        return true;
    }

    /** @return array<int|string, int> */
    public function stream_stat(): array
    {
        return [];
    }
}
