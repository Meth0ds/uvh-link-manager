<?php

namespace Tests\Feature;

use App\Jobs\DeliverMailOutboxJob;
use App\Support\MailOutboxDispatcher;
use App\Support\UvhCrypto;
use App\Support\UvhMail;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use PHPUnit\Framework\Attributes\DataProvider;
use Symfony\Component\Process\Process;
use Tests\TestCase;

final class MailOutboxDispatcherTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE mail_outbox RESTART IDENTITY');
        Carbon::setTestNow(Carbon::parse('2026-10-10T02:00:00Z'));
        Queue::fake();
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function row(string $status = 'pending', int $delay = 0): int
    {
        return (int) DB::table('mail_outbox')->insertGetId([
            'idempotency_key' => hash('sha256', random_bytes(16)),
            'encrypted_envelope' => UvhCrypto::encryptAtRest(str_repeat('Synthetic fixture only', 1000)),
            'kind' => 'fixture', 'status' => $status, 'available_at' => now()->addSeconds($delay),
            'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    public static function readiness(): array
    {
        return ['past' => [-1], 'exact boundary' => [0]];
    }

    #[DataProvider('readiness')]
    public function test_ready_row_is_published_once_without_modifying_its_envelope(int $delay): void
    {
        $id = $this->row(delay: $delay);
        $before = DB::table('mail_outbox')->where('id', $id)->first();
        $this->assertTrue(MailOutboxDispatcher::enqueue($id));
        $this->assertTrue(MailOutboxDispatcher::enqueue($id));
        Queue::assertPushed(DeliverMailOutboxJob::class, fn ($job) => $job->outboxId === $id && $job->queue === 'mail');
        Queue::assertPushed(DeliverMailOutboxJob::class, 1);
        $after = DB::table('mail_outbox')->where('id', $id)->first();
        $this->assertSame('queued', $after->status);
        $this->assertSame($before->encrypted_envelope, $after->encrypted_envelope);
        $this->assertSame($before->available_at, $after->available_at);
        $this->assertSame($before->attempts, $after->attempts);
        $this->assertSame(now()->toIso8601String(), Carbon::parse($after->queued_at)->toIso8601String());
    }

    public static function ineligible(): array
    {
        $cases = ['future pending' => ['pending', 1]];
        foreach (['queued', 'processing', 'sent', 'failed', 'obsolete', 'comp_pending', 'compensating', 'compensated'] as $state) {
            $cases[$state] = [$state, 0];
        }

        return $cases;
    }

    #[DataProvider('ineligible')]
    public function test_ineligible_row_is_untouched_and_not_dispatched(string $state, int $delay): void
    {
        $id = $this->row($state, $delay);
        $before = DB::table('mail_outbox')->where('id', $id)->first();
        $this->assertTrue(MailOutboxDispatcher::enqueue($id));
        Queue::assertNothingPushed();
        $this->assertEquals($before, DB::table('mail_outbox')->where('id', $id)->first());
    }

    public function test_missing_row_does_not_dispatch_or_insert(): void
    {
        $this->assertTrue(MailOutboxDispatcher::enqueue(999));
        Queue::assertNothingPushed();
        $this->assertDatabaseCount('mail_outbox', 0);
    }

    public function test_claim_projects_only_id_and_keeps_eligibility_and_row_lock(): void
    {
        $id = $this->row();
        $claims = [];
        DB::listen(static function (QueryExecuted $event) use (&$claims): void {
            if (str_starts_with($event->sql, 'select ') && str_contains($event->sql, '"mail_outbox"')) {
                $claims[] = ['sql' => $event->sql, 'bindings' => $event->connection->prepareBindings($event->bindings)];
            }
        });
        $this->assertTrue(MailOutboxDispatcher::enqueue($id));
        $this->assertSame([[
            'sql' => 'select "id" from "mail_outbox" where "id" = ? and "status" = ? and "available_at" <= ? limit 1 for update',
            'bindings' => [$id, 'pending', now()->format('Y-m-d H:i:s')],
        ]], $claims);
    }

    public function test_database_failure_rolls_back_the_claim_without_dispatch(): void
    {
        $id = $this->row();
        $before = DB::table('mail_outbox')->where('id', $id)->first();
        $armed = true;
        DB::listen(static function (QueryExecuted $event) use (&$armed): void {
            if ($armed && str_starts_with($event->sql, 'update "mail_outbox"')) {
                $armed = false;
                throw new \RuntimeException('Fixture: failure after claim update');
            }
        });
        $this->assertFalse(MailOutboxDispatcher::enqueue($id));
        Queue::assertNothingPushed();
        $this->assertEquals($before, DB::table('mail_outbox')->where('id', $id)->first());
    }

    public static function dispatchFailures(): array
    {
        return ['still queued' => [false], 'worker claimed before queue failure' => [true]];
    }

    #[DataProvider('dispatchFailures')]
    public function test_queue_failure_compensates_only_the_still_queued_row(bool $workerClaimed): void
    {
        $id = $this->row();
        $before = DB::table('mail_outbox')->where('id', $id)->first();
        Bus::shouldReceive('dispatch')->once()->withArgs(fn ($job) => $job instanceof DeliverMailOutboxJob && $job->outboxId === $id)
            ->andReturnUsing(static function () use ($id, $workerClaimed): never {
                if ($workerClaimed) {
                    DB::table('mail_outbox')->where('id', $id)->update(['status' => 'processing', 'lock_token' => 'owned-worker']);
                }
                throw new \RuntimeException('Fixture: queue unavailable');
            });
        $this->assertFalse(MailOutboxDispatcher::enqueue($id));
        $after = DB::table('mail_outbox')->where('id', $id)->first();
        $this->assertSame($workerClaimed ? 'processing' : 'pending', $after->status);
        $this->assertSame($workerClaimed ? 'owned-worker' : null, $after->lock_token);
        $this->assertSame($workerClaimed ? null : 'queue_unavailable', $after->last_error);
        $this->assertSame($workerClaimed ? now()->toIso8601String() : null, $after->queued_at === null ? null : Carbon::parse($after->queued_at)->toIso8601String());
        $this->assertSame($before->encrypted_envelope, $after->encrypted_envelope);
    }

    public function test_mail_is_published_only_after_commit_and_rollback_publishes_nothing(): void
    {
        DB::transaction(static function (): void {
            self::assertTrue(UvhMail::verification('fixture@example.test', 'https://app.uvh.test/auth/verify-email#token=fixture', hash('sha256', 'committed')));
            Queue::assertNothingPushed();
        });
        Queue::assertPushed(DeliverMailOutboxJob::class, 1);
        try {
            DB::transaction(static function (): void {
                self::assertTrue(UvhMail::verification('fixture@example.test', 'https://app.uvh.test/auth/verify-email#token=fixture', hash('sha256', 'rolled-back')));
                Queue::assertPushed(DeliverMailOutboxJob::class, 1);
                throw new \RuntimeException('Fixture: parent transaction rolls back');
            });
        } catch (\RuntimeException $error) {
            $this->assertSame('Fixture: parent transaction rolls back', $error->getMessage());
        }
        Queue::assertPushed(DeliverMailOutboxJob::class, 1);
        $this->assertDatabaseCount('mail_outbox', 1);
    }

    public static function competitors(): array
    {
        return ['first commits' => [false], 'first rolls back' => [true]];
    }

    #[DataProvider('competitors')]
    public function test_real_competing_claims_publish_exactly_one_job(bool $firstFails): void
    {
        $id = $this->row();
        $nonce = bin2hex(random_bytes(8));
        $directory = storage_path('framework/testing/mail-claim-'.$nonce);
        mkdir($directory, 0700, true);
        $name = 'uvh-mail-claim-'.$nonce;
        $base = [PHP_BINARY, base_path('tests/Support/mail-outbox-claim-probe.php'), '--id='.$id, '--clock='.now()->toIso8601String()];
        $firstArgs = [...$base, '--name='.$name.'-1', '--barrier='.$directory];
        if ($firstFails) {
            $firstArgs[] = '--fail-claim';
        }
        $first = new Process($firstArgs, base_path(), ['APP_ENV' => 'testing'], timeout: 20);
        $second = new Process([...$base, '--name='.$name.'-2'], base_path(), ['APP_ENV' => 'testing'], timeout: 20);
        try {
            $first->start();
            $deadline = microtime(true) + 5;
            while (! is_file($directory.'/ready') && microtime(true) < $deadline && $first->isRunning()) {
                usleep(10000);
            }
            $this->assertFileExists($directory.'/ready', $first->getErrorOutput());
            $second->start();
            $waiting = false;
            $deadline = microtime(true) + 5;
            while (microtime(true) < $deadline && $second->isRunning()) {
                $waiting = DB::table('pg_stat_activity')->where('datname', DB::connection()->getDatabaseName())
                    ->where('application_name', $name.'-2')->where('wait_event_type', 'Lock')->exists();
                if ($waiting) {
                    break;
                }
                usleep(10000);
            }
            $this->assertTrue($first->isRunning(), $first->getErrorOutput());
            $this->assertTrue($waiting, 'Second process must actually wait for the first row lock');
            file_put_contents($directory.'/release', 'release');
            $first->wait();
            $second->wait();
            $this->assertTrue($first->isSuccessful(), $first->getErrorOutput());
            $this->assertTrue($second->isSuccessful(), $second->getErrorOutput());
            $a = json_decode($first->getOutput(), true, flags: JSON_THROW_ON_ERROR);
            $b = json_decode($second->getOutput(), true, flags: JSON_THROW_ON_ERROR);
            $this->assertSame(! $firstFails, $a['accepted']);
            $this->assertTrue($b['accepted']);
            $this->assertSame($firstFails ? 0 : 1, $a['jobs']);
            $this->assertSame($firstFails ? 1 : 0, $b['jobs']);
            $this->assertDatabaseHas('mail_outbox', ['id' => $id, 'status' => 'queued']);
        } finally {
            file_put_contents($directory.'/release', 'release');
            if ($first->isRunning()) {
                $first->stop(0);
            }
            if ($second->isStarted() && $second->isRunning()) {
                $second->stop(0);
            }
            foreach (['ready', 'release'] as $file) {
                if (is_file($directory.'/'.$file)) {
                    unlink($directory.'/'.$file);
                }
            }
            rmdir($directory);
        }
    }
}
