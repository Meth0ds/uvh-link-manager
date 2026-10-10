<?php

namespace Tests\Feature;

use App\Support\RequestTrace;
use Illuminate\Contracts\Http\Kernel;
use Illuminate\Http\Request;
use Illuminate\Log\Events\MessageLogged;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Route;
use Monolog\Handler\NullHandler;
use PHPUnit\Framework\Attributes\DataProvider;
use Symfony\Component\HttpFoundation\Response;
use Tests\TestCase;

final class RequestCorrelationTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        // The assertions include info events even when the launcher filters
        // them from its normal channel. Keep the fixture logger test-owned.
        config(['logging.channels.correlation-fixture' => [
            'driver' => 'monolog',
            'handler' => NullHandler::class,
            'level' => 'debug',
        ]]);
        Log::setDefaultDriver('correlation-fixture');
    }

    public static function exceptionSources(): array
    {
        return [['route'], ['global middleware']];
    }

    #[DataProvider('exceptionSources')]
    public function test_report_and_error_response_keep_the_trace_without_leaking_it_to_the_next_request(string $source): void
    {
        $logs = [];
        Log::listen(static function (MessageLogged $event) use (&$logs): void {
            $logs[] = ['level' => $event->level, 'context' => $event->context, 'trace' => RequestTrace::current()];
        });
        if ($source === 'global middleware') {
            app(Kernel::class)->pushMiddleware(ThrowingCorrelationFixture::class);
        }
        Route::get('/__correlation/error', static function (): never {
            throw new \RuntimeException('Fixture: route failure');
        });
        Route::get('/__correlation/ok', static function () {
            Log::info('Fixture: next request');

            return response()->json(['ok' => true]);
        });
        $first = str_repeat('a', 32);
        $this->withServerVariables(['UVH_REQUEST_ID' => $first]);
        $this->getJson('/__correlation/error')->assertServerError()->assertHeader('X-Request-ID', $first);
        $errors = array_values(array_filter($logs, static fn (array $log): bool => $log['level'] === 'error'));
        $this->assertCount(1, $errors);
        $this->assertSame($first, $errors[0]['context']['correlation_id'] ?? null);
        $this->assertSame($first, $errors[0]['trace']);
        $this->assertNull(RequestTrace::current());
        $second = str_repeat('b', 32);
        $this->withServerVariables(['UVH_REQUEST_ID' => $second]);
        $this->getJson('/__correlation/ok')->assertOk()->assertHeader('X-Request-ID', $second);
        $this->assertSame($second, $logs[array_key_last($logs)]['context']['correlation_id'] ?? null);
        $this->assertSame($second, $logs[array_key_last($logs)]['trace']);
        $this->assertNull(RequestTrace::current());
        Log::info('Fixture: outside request');
        $this->assertArrayNotHasKey('correlation_id', $logs[array_key_last($logs)]['context']);
    }

    public function test_stream_callback_restores_its_trace_and_then_cleans_it(): void
    {
        $trace = null;
        Route::get('/__correlation/stream', static function () use (&$trace) {
            return response()->stream(static function () use (&$trace): void {
                $trace = RequestTrace::current();
                echo 'fixture-stream';
            });
        });
        $id = str_repeat('c', 32);
        $response = $this->withServerVariables(['UVH_REQUEST_ID' => $id])->get('/__correlation/stream');
        $response->assertOk()->assertHeader('X-Request-ID', $id);
        $this->assertNull(RequestTrace::current());
        $this->assertSame('fixture-stream', $response->streamedContent());
        $this->assertSame($id, $trace);
        $this->assertNull(RequestTrace::current());
    }

    public function test_client_header_cannot_choose_the_trace_identifier(): void
    {
        Route::get('/__correlation/header', static fn () => response()->json(['ok' => true]));
        $spoofed = str_repeat('d', 32);
        $response = $this->withHeader('X-Request-ID', $spoofed)->getJson('/__correlation/header')->assertOk();
        $id = $response->headers->get('X-Request-ID');
        $this->assertMatchesRegularExpression('/^[a-f0-9]{32}$/D', $id);
        $this->assertNotSame($spoofed, $id);
        $this->assertNull(RequestTrace::current());
    }
}

final class ThrowingCorrelationFixture
{
    public function handle(Request $request, \Closure $next): Response
    {
        if ($request->path() === '__correlation/error') {
            throw new \RuntimeException('Fixture: middleware failure');
        }

        return $next($request);
    }
}
