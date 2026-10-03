<?php

namespace Tests\Feature;

use App\Models\EmailChangeRequest;
use App\Models\User;
use App\Support\Ids;
use App\Support\SessionManager;
use App\Support\UvhCrypto;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Symfony\Component\Process\Process;
use Tests\TestCase;

final class EmailChangeConcurrencyTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, mail_outbox, audit_events, audit_outbox, operational_metrics RESTART IDENTITY CASCADE');
    }

    public function test_crossed_active_reservations_refuse_without_native_deadlock(): void
    {
        $owners = [];
        $cookies = [];
        foreach ([0, 1] as $slot) {
            $owner = User::factory()->create([
                'email' => 'email-probe-owner-'.$slot.'@example.test', 'password_hash' => Hash::make('tiovivo-cobrizo-astilla-42'),
                'mfa_enabled' => true, 'mfa_secret' => UvhCrypto::encryptAtRest('JBSWY3DPEHPK3PXP'),
                'recovery_codes' => [Ids::sha256Hex('ABCD2345EFGH6789')],
            ]);
            $owners[] = $owner;
            $cookies[] = SessionManager::create($owner->id, Request::create('/'), 1, true);
            // Ensure the step-up performs a real timestamp UPDATE instead of
            // Eloquent eliding a same-second mfa_verified_at assignment.
            DB::table('sessions')->where('id', Ids::sha256Hex($cookies[$slot]))
                ->update(['mfa_verified_at' => now()->subSeconds(10)]);
            EmailChangeRequest::create(['id' => Ids::sha256Hex('old-email-reservation-'.$slot), 'user_id' => $owner->id,
                'new_email' => 'email-probe-reserved-'.$slot.'@example.test', 'security_version' => 1,
                'expires_at' => now()->addHour(), 'created_at' => now()]);
        }
        $before = DB::table('email_change_requests')->orderBy('user_id')->get()->toArray();
        $barrier = sys_get_temp_dir().'/uvh-email-change-'.bin2hex(random_bytes(8));
        mkdir($barrier, 0700);
        $processes = [];
        $nativeCycle = false;
        try {
            foreach ([0, 1] as $slot) {
                $process = new Process([PHP_BINARY, base_path('tests/Support/email-change-probe.php'),
                    '--cookie='.$cookies[$slot], '--target=email-probe-reserved-'.(1 - $slot).'@example.test',
                    '--barrier='.$barrier, '--slot='.$slot,
                ], base_path(), $this->environment());
                $process->setTimeout(30);
                $process->start();
                $processes[] = $process;
            }
            $deadline = microtime(true) + 15;
            while (count(glob($barrier.'/authorized-*')) !== 2 && microtime(true) < $deadline) {
                if (! $processes[0]->isRunning() || ! $processes[1]->isRunning()) {
                    break;
                }
                usleep(10_000);
            }
            $this->assertCount(2, glob($barrier.'/authorized-*'), 'Both real step-ups must finish under their account/session locks. '.json_encode(array_map(static fn (Process $process): string => $process->getOutput(), $processes), JSON_THROW_ON_ERROR));
            file_put_contents($barrier.'/authorize', 'go');
            $deadline = microtime(true) + 15;
            while (count(glob($barrier.'/deleted-*')) !== 2 && microtime(true) < $deadline) {
                if (! $processes[0]->isRunning() && ! $processes[1]->isRunning()) {
                    break;
                }
                usleep(10_000);
            }
            if (count(glob($barrier.'/deleted-*')) === 2) {
                file_put_contents($barrier.'/insert', 'go');
                $deadline = microtime(true) + 10;
                do {
                    DB::select('SELECT pg_stat_clear_snapshot()');
                    $rows = DB::select("SELECT pid, pg_blocking_pids(pid) AS blockers, wait_event_type FROM pg_stat_activity WHERE application_name IN ('uvh-email-change-probe-0', 'uvh-email-change-probe-1') ORDER BY application_name");
                    if (count($rows) === 2 && $rows[0]->wait_event_type === 'Lock' && $rows[1]->wait_event_type === 'Lock'
                        && in_array((string) $rows[1]->pid, explode(',', trim($rows[0]->blockers, '{}')), true)
                        && in_array((string) $rows[0]->pid, explode(',', trim($rows[1]->blockers, '{}')), true)) {
                        $nativeCycle = true;
                    }
                    if ($nativeCycle || (! $processes[0]->isRunning() && ! $processes[1]->isRunning())) {
                        break;
                    }
                    usleep(20_000);
                } while (microtime(true) < $deadline);
            }
            $results = [];
            foreach ($processes as $process) {
                $process->wait();
                $this->assertTrue($process->isSuccessful(), $process->getErrorOutput());
                $lines = array_values(array_filter(explode("\n", trim($process->getOutput()))));
                $results[] = json_decode(end($lines), true, flags: JSON_THROW_ON_ERROR);
            }
            $statuses = array_column($results, 'status');
            sort($statuses);
            // If the regression fires, prove PostgreSQL really observed the
            // cycle, instead of misclassifying a fixture or transport failure.
            if (in_array(500, $statuses, true)) {
                $this->assertTrue($nativeCycle, json_encode($results, JSON_THROW_ON_ERROR));
                $this->assertContains('40P01', array_merge(...array_column($results, 'states')));
            }
            $this->assertSame([409, 409], $statuses, json_encode(['nativeCycle' => $nativeCycle, 'results' => $results], JSON_THROW_ON_ERROR));
            $this->assertFalse($nativeCycle);
            $this->assertEquals($before, DB::table('email_change_requests')->orderBy('user_id')->get()->toArray());
            foreach ($owners as $owner) {
                $this->assertSame([Ids::sha256Hex('ABCD2345EFGH6789')], $owner->refresh()->recovery_codes);
                $this->assertSame(1, $owner->security_version);
            }
            $this->assertDatabaseCount('mail_outbox', 0);
            $this->assertDatabaseCount('notifications', 0);
        } finally {
            foreach ($processes as $process) {
                if ($process->isRunning()) {
                    $process->stop();
                }
            }
            foreach (glob($barrier.'/*') as $file) {
                unlink($file);
            }
            rmdir($barrier);
        }
    }

    private function environment(): array
    {
        $connection = config('database.connections.pgsql');

        return [
            'APP_ENV' => 'testing', 'APP_KEY' => (string) config('app.key'), 'DB_CONNECTION' => 'pgsql',
            'DB_HOST' => (string) $connection['host'], 'DB_PORT' => (string) $connection['port'],
            'DB_DATABASE' => (string) DB::connection()->getDatabaseName(),
            'DB_USERNAME' => (string) $connection['username'], 'DB_PASSWORD' => (string) $connection['password'],
            'QUEUE_CONNECTION' => 'sync', 'MAIL_MAILER' => 'array', 'CACHE_STORE' => 'array',
            'CACHE_LIMITER' => 'array', 'CACHE_LIMITER_SECURITY' => 'array',
            'PUBLIC_HOST' => (string) config('uvh.public_host'), 'APP_HOST' => (string) config('uvh.app_host'),
        ];
    }
}
