<?php

namespace Tests\Feature;

use App\Jobs\DnsStub;
use App\Jobs\DnsViews;
use App\Jobs\VerifyDomainDnsJob;
use App\Models\CustomDomain;
use App\Models\User;
use App\Models\Workspace;
use App\Support\DomainClaims;
use App\Support\Ids;
use App\Support\SessionManager;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use PDO;
use Tests\TestCase;

/**
 * The canonical lock order for hostname state: workspace auth → the
 * hostname's claim lock → domain rows (own first, then foreign rows in id
 * order).
 *
 * The order matters because a takeover used to be a reproducible deadlock: one
 * verification holding its own domain row while waiting for the claim, another
 * holding the claim while demoting that very row. Every transaction that
 * touches both a claim and domain rows of a hostname now takes the hostname's
 * advisory lock first, which serializes them; these contracts pin both the
 * order and the lock itself. Regression contracts: run only with the isolated
 * *_test DB guard.
 */
final class DomainClaimLockOrderTest extends TestCase
{
    private const TOKEN = 'uvh-verify=LockOrder1234abcd';

    protected function setUp(): void
    {
        parent::setUp(); // Refuses non-*_test databases before fixture writes.
        require_once dirname(__DIR__).'/Support/dns-stub.php';
        DnsStub::reset();
        DnsViews::reset();
        DB::statement('TRUNCATE users, sessions, workspaces, memberships, quotas, links, custom_domains, custom_domain_claims, domain_events, notifications, notification_preferences, mail_outbox, audit_events, operational_metrics RESTART IDENTITY CASCADE');
        config(['uvh.custom_domains.cname_target' => 'edge.example.test']);
        $this->disableCookieEncryption();
        $this->withCredentials();
        Queue::fake();
    }

    protected function tearDown(): void
    {
        DnsStub::reset();
        DnsViews::reset();
        parent::tearDown();
    }

    public function test_verification_takes_the_hostname_lock_before_any_domain_row_lock(): void
    {
        $host = 'lock-'.strtolower(Ids::randomToken(6)).'.example.test';
        [$user, $workspace] = $this->workspace();
        $row = $this->row((int) $workspace->id, $host);
        DnsStub::txt('_uvh-verification.'.$host, self::TOKEN);
        DnsStub::cname($host, 'edge.example.test');

        $statements = [];
        DB::listen(function ($query) use (&$statements): void {
            $statements[] = $query->sql;
        });
        $this->verify((int) $row->id, (int) $workspace->id, $user, $host);

        [$lockIndex, $rowIndex] = $this->orderOf($statements);
        $this->assertNotFalse($lockIndex, 'la verificación debe tomar el advisory lock del hostname');
        $this->assertNotFalse($rowIndex, 'la verificación debe bloquear su fila de dominio');
        $this->assertLessThan($rowIndex, $lockIndex, 'el lock del hostname va antes que cualquier fila de dominio');
    }

    public function test_domain_deletion_takes_the_hostname_lock_before_the_row_lock(): void
    {
        $host = 'drop-'.strtolower(Ids::randomToken(6)).'.example.test';
        [$user, $workspace] = $this->workspace();
        $row = $this->row((int) $workspace->id, $host);
        $this->withCookie('uvh_session', SessionManager::create($user->id, Request::create('/'), (int) $user->security_version, true));
        $this->withCookie('uvh_csrf', 'lock-order-csrf')->withHeader('X-CSRF-Token', 'lock-order-csrf');
        $this->withHeader('X-Workspace-Id', (string) $workspace->id);

        $statements = [];
        DB::listen(function ($query) use (&$statements): void {
            $statements[] = $query->sql;
        });
        $this->deleteJson('/api/v1/domains/'.$row->id)->assertOk();

        [$lockIndex, $rowIndex] = $this->orderOf($statements);
        $this->assertNotFalse($lockIndex, 'el borrado debe tomar el advisory lock del hostname');
        $this->assertNotFalse($rowIndex, 'el borrado debe bloquear la fila de dominio');
        $this->assertLessThan($rowIndex, $lockIndex, 'el lock del hostname va antes que la fila, también al borrar');
    }

    public function test_the_hostname_lock_is_a_real_cross_session_advisory_lock(): void
    {
        $host = 'contend-'.strtolower(Ids::randomToken(6)).'.example.test';
        $other = 'free-'.strtolower(Ids::randomToken(6)).'.example.test';

        // The key is derived from the normalized hostname only.
        $this->assertSame(
            DomainClaims::hostnameLockKey($host),
            DomainClaims::hostnameLockKey(strtoupper($host)),
        );
        $this->assertNotSame(
            DomainClaims::hostnameLockKey($host),
            DomainClaims::hostnameLockKey($other),
        );

        $peer = $this->peerConnection();
        DB::transaction(function () use ($peer, $host, $other): void {
            DomainClaims::lockHostname($host);
            $try = static fn (int $key): bool => (bool) $peer
                ->query('SELECT pg_try_advisory_xact_lock('.$key.')')
                ->fetchColumn();
            // A second session cannot take the same hostname's lock...
            $this->assertFalse($try(DomainClaims::hostnameLockKey($host)));
            // ...but a different hostname is independent.
            $this->assertTrue($try(DomainClaims::hostnameLockKey($other)));
        });
        // Transaction-scoped: once the transaction ends, the lock is free.
        DB::transaction(function () use ($peer, $host): void {
            $this->assertTrue((bool) $peer
                ->query('SELECT pg_try_advisory_xact_lock('.DomainClaims::hostnameLockKey($host).')')
                ->fetchColumn());
        });
    }

    /**
     * @param  list<string>  $statements
     * @return array{0: int|false, 1: int|false}
     */
    private function orderOf(array $statements): array
    {
        $lockIndex = false;
        $rowIndex = false;
        foreach ($statements as $index => $sql) {
            $lower = strtolower($sql);
            if ($lockIndex === false && str_contains($lower, 'pg_advisory_xact_lock')) {
                $lockIndex = $index;
            }
            if ($rowIndex === false && str_contains($lower, 'from "custom_domains"') && str_contains($lower, 'for update')) {
                $rowIndex = $index;
            }
        }

        return [$lockIndex, $rowIndex];
    }

    private function peerConnection(): PDO
    {
        $cfg = config('database.connections.pgsql');
        $pdo = new PDO(
            'pgsql:host='.$cfg['host'].';port='.$cfg['port'].';dbname='.$cfg['database'],
            (string) $cfg['username'],
            (string) $cfg['password'],
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION],
        );

        return $pdo;
    }

    /** @return array{User, Workspace} */
    private function workspace(): array
    {
        $user = User::factory()->create(['email_verified_at' => now()]);
        $workspace = $user->ownedWorkspaces()->create([
            'name' => 'Locks', 'slug' => 'locks-'.strtolower(Ids::randomToken(8)),
        ]);
        $workspace->memberships()->create(['user_id' => $user->id, 'role' => 'owner']);
        $workspace->quota()->create(['links_limit' => 100]);

        return [$user, $workspace];
    }

    private function row(int $workspaceId, string $host): CustomDomain
    {
        return CustomDomain::create([
            'workspace_id' => $workspaceId,
            'domain' => $host,
            'verification_token' => self::TOKEN,
            'verification_version' => 1,
            'verification_scheme' => 2,
            'desired_state' => 'enabled',
            'ownership_status' => 'pending',
            'routing_status' => 'failed',
            'tls_status' => 'pending',
        ]);
    }

    private function verify(int $domainId, int $workspaceId, User $user, string $host): void
    {
        (new VerifyDomainDnsJob(
            domainId: $domainId,
            workspaceId: $workspaceId,
            requestedBy: (int) $user->id,
            actorSecurityVersion: (int) $user->security_version,
            apiTokenId: null,
            domain: $host,
            verificationToken: self::TOKEN,
            verificationScheme: 2,
            verificationVersion: 1,
            dedupeKey: 'lock-order-'.$domainId,
            dedupeOwner: 'lock-owner-'.$domainId,
        ))->handle();
    }
}
