<?php

namespace Tests\Feature;

use App\Models\Link;
use App\Models\User;
use App\Support\Ids;
use App\Support\SessionManager;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Symfony\Component\Process\Process;
use Tests\TestCase;

final class LinkDuplicateConcurrencyTest extends TestCase
{
    public function test_concurrent_retries_create_exactly_one_copy_and_receipt(): void
    {
        $results = $this->duplicates(true);
        $this->assertSame([201, 201], array_column($results, 'status'));
        $this->assertSame($results[0]['id'], $results[1]['id']);
        $this->assertSame(2, Link::count());
        $this->assertSame(1, DB::table('link_duplicate_receipts')->count());
        $this->assertSame(1, DB::table('audit_events')->where('action', 'link.duplicate')->count());
    }

    public function test_parallel_different_copies_cannot_exceed_the_workspace_quota(): void
    {
        $results = $this->duplicates(false);
        $statuses = array_column($results, 'status');
        sort($statuses);
        $this->assertSame([201, 429], $statuses);
        $this->assertSame(2, Link::count());
        $this->assertSame(1, DB::table('link_duplicate_receipts')->count());
    }

    private function duplicates(bool $sameRequest): array
    {
        DB::statement('TRUNCATE users, sessions, workspaces, memberships, audit_events RESTART IDENTITY CASCADE');
        $user = User::factory()->create(['email_verified_at' => now()]);
        $workspace = $user->ownedWorkspaces()->create(['name' => 'Concurrent', 'slug' => Ids::randomToken(12)]);
        $workspace->memberships()->create(['user_id' => $user->id, 'role' => 'owner']);
        $link = Link::create(['workspace_id' => $workspace->id, 'created_by' => $user->id,
            'alias' => 'source', 'destination' => 'https://example.org', 'state' => 'active']);
        DB::table('quotas')->insert(['workspace_id' => $workspace->id, 'links_limit' => 2]);
        $cookie = SessionManager::create($user->id, Request::create('/'), (int) $user->security_version, true);
        $barrier = sys_get_temp_dir().'/uvh-duplicate-'.bin2hex(random_bytes(8));
        mkdir($barrier, 0700);
        $connection = config('database.connections.pgsql');
        $environment = ['APP_ENV' => 'testing', 'DB_CONNECTION' => 'pgsql', 'DB_HOST' => $connection['host'],
            'DB_PORT' => (string) $connection['port'], 'DB_DATABASE' => $connection['database'],
            'DB_USERNAME' => $connection['username'], 'DB_PASSWORD' => $connection['password'],
            'DB_SSLMODE' => $connection['sslmode'], 'PUBLIC_HOST' => config('uvh.public_host'),
            'APP_HOST' => config('uvh.app_host'), 'CACHE_STORE' => 'array', 'QUEUE_CONNECTION' => 'sync'];
        $processes = [];
        $key = (string) Str::uuid();
        try {
            foreach ([0, 1] as $slot) {
                $process = new Process([PHP_BINARY, base_path('tests/Support/link-duplicate-probe.php'),
                    '--cookie='.$cookie, '--workspace='.$workspace->id, '--source='.$link->id,
                    '--key='.($sameRequest ? $key : (string) Str::uuid()), '--alias='.($sameRequest ? 'copy' : 'copy-'.$slot),
                    '--barrier='.$barrier, '--slot='.$slot,
                ], base_path(), $environment);
                $process->setTimeout(20);
                $process->start();
                $processes[] = $process;
            }
            $deadline = microtime(true) + 10;
            while (count(glob($barrier.'/ready-*')) < 2 && microtime(true) < $deadline) {
                usleep(1000);
            }
            $this->assertCount(2, glob($barrier.'/ready-*'), 'Both HTTP probes must be ready before release.');
            file_put_contents($barrier.'/go', 'go');
            $results = [];
            foreach ($processes as $process) {
                $this->assertSame(0, $process->wait(), $process->getErrorOutput());
                $results[] = json_decode(trim($process->getOutput()), true, 8, JSON_THROW_ON_ERROR);
            }

            return $results;
        } finally {
            foreach ($processes as $process) {
                $process->stop(0);
            }
            foreach (glob($barrier.'/*') as $file) {
                unlink($file);
            }
            rmdir($barrier);
        }
    }
}
