<?php

namespace Tests\Feature;

use App\Models\CustomDomain;
use App\Models\Link;
use App\Models\User;
use App\Models\Workspace;
use App\Support\Ids;
use App\Support\SessionManager;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use PHPUnit\Framework\Attributes\DataProvider;
use Symfony\Component\Process\Process;
use Tests\TestCase;

final class DomainRemovalTest extends TestCase
{
    private User $owner;

    private Workspace $workspace;

    private CustomDomain $source;

    private CustomDomain $target;

    private string $session;

    protected function setUp(): void
    {
        parent::setUp(); // The shared guard refuses databases without the _test suffix.
        DB::statement('TRUNCATE users, workspaces, custom_domains, links, idempotency_keys, audit_events RESTART IDENTITY CASCADE');
        Queue::fake();
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', 'domain-removal-csrf')->withHeader('X-CSRF-Token', 'domain-removal-csrf');
        $this->owner = User::factory()->create(['email_verified_at' => now()]);
        $this->workspace = $this->owner->ownedWorkspaces()->create(['name' => 'Removal', 'slug' => 'removal-'.Ids::randomToken(8)]);
        $this->workspace->memberships()->create(['user_id' => $this->owner->id, 'role' => 'owner']);
        $this->workspace->quota()->create(['links_limit' => 100]);
        $this->source = $this->domain('source.example.test');
        $this->target = $this->domain('target.example.test');
        $this->session = SessionManager::create($this->owner->id, Request::create('/'), (int) $this->owner->security_version, true);
        $this->withCookie((string) config('uvh.session_cookie'), $this->session)->withHeader('X-Workspace-Id', (string) $this->workspace->id);
    }

    public function test_impact_counts_live_trashed_and_blocked_links_without_challenges(): void
    {
        $this->link('live');
        $this->link('trash', true);
        $blocked = $this->link('blocked', true);
        $blocked->update(['state_before_delete' => 'blocked']);
        $this->source->update(['is_default' => true]);
        $response = $this->getJson($this->path('deletion-preview'))->assertOk()->assertJson([
            'domainId' => $this->source->id, 'liveLinks' => 1, 'trashedLinks' => 2,
            'blockedLinks' => 1, 'totalLinks' => 3, 'canDelete' => false, 'isDefault' => true,
        ]);
        $this->assertArrayNotHasKey('verificationToken', $response->json());
    }

    public function test_preview_is_read_only_and_reassignment_preserves_trash_and_configuration(): void
    {
        $live = $this->link('live');
        $trash = $this->link('trash', true);
        $before = $trash->getAttributes();
        $preview = $this->postJson($this->path('reassignment-preview'), $this->selection([$live, $trash]))
            ->assertOk()->assertJsonPath('canApply', true)->json();
        $this->assertSame((int) $this->source->id, (int) $live->fresh()->domain_id);
        $this->assertSame('https://source.example.test/live', $preview['links'][0]['oldUrl']);
        $this->assertSame('https://target.example.test/live', $preview['links'][0]['newUrl']);
        $this->postJson($this->path('reassign'), $this->execution([$live, $trash]), ['Idempotency-Key' => 'domain-move-0001'])
            ->assertOk()->assertJsonPath('applied', 2);
        $after = Link::withTrashed()->findOrFail($trash->id)->getAttributes();
        foreach ($before as $key => $value) {
            if (! in_array($key, ['domain_id', 'version', 'updated_at'], true)) {
                $this->assertSame($value, $after[$key], $key.' must be preserved');
            }
        }
        $this->assertSame((int) $this->target->id, (int) $after['domain_id']);
        $this->assertSame(2, (int) $after['version']);
        $this->assertSame(2, DB::table('link_versions')->count());
        $this->getJson($this->path('deletion-preview'))->assertJsonPath('canDelete', true);
        $this->assertDatabaseHas('custom_domains', ['id' => $this->source->id]);
    }

    public function test_lost_response_retry_replays_without_changing_versions_or_history_twice(): void
    {
        $link = $this->link('once');
        $body = $this->execution([$link]);
        $headers = ['Idempotency-Key' => 'domain-move-once'];
        $first = $this->postJson($this->path('reassign'), $body, $headers)->assertOk()->json();
        $this->postJson($this->path('reassign'), $body, $headers)->assertOk()->assertHeader('Idempotent-Replay', 'true')->assertExactJson($first);
        $this->assertSame(2, (int) $link->fresh()->version);
        $this->assertSame(1, DB::table('link_versions')->count());
        $body['targetDomainId'] = null;
        $this->postJson($this->path('reassign'), $body, $headers)->assertStatus(409);
    }

    public function test_stale_version_rejects_the_entire_selection(): void
    {
        $a = $this->link('alpha');
        $b = $this->link('bravo');
        $body = $this->execution([$a, $b]);
        $b->update(['version' => 2, 'destination' => 'https://example.org/changed']);
        $this->postJson($this->path('reassign'), $body, ['Idempotency-Key' => 'stale-domain-move'])->assertStatus(409);
        $this->assertSame((int) $this->source->id, (int) $a->fresh()->domain_id);
        $this->assertSame(0, DB::table('link_versions')->count());
    }

    public function test_collisions_ignore_case_and_include_trash_without_disclosing_the_holder(): void
    {
        $link = $this->link('Promo', true);
        $this->link('promo', false, $this->target);
        $preview = $this->postJson($this->path('reassignment-preview'), $this->selection([$link]))
            ->assertOk()->assertJsonPath('canApply', false)->assertJsonPath('links.0.conflict', 'alias_conflict');
        $this->assertArrayNotHasKey('destination', $preview->json('links.0'));
        $this->postJson($this->path('reassign'), $this->execution([$link]), ['Idempotency-Key' => 'collision-domain'])->assertStatus(409);
    }

    public function test_platform_conflicts_are_checked_across_workspaces(): void
    {
        $link = $this->link('global-alias');
        $other = $this->owner->ownedWorkspaces()->create(['name' => 'Other', 'slug' => 'other']);
        DB::table('links')->insert(['workspace_id' => $other->id, 'created_by' => $this->owner->id, 'alias' => 'GLOBAL-ALIAS', 'destination' => 'https://example.org/private', 'state' => 'active', 'version' => 1, 'created_at' => now(), 'updated_at' => now()]);
        $body = $this->selection([$link]);
        $body['targetDomainId'] = null;
        $this->postJson($this->path('reassignment-preview'), $body)->assertOk()->assertJsonPath('links.0.conflict', 'alias_conflict');
    }

    public function test_blocked_trash_cannot_be_reassigned(): void
    {
        $link = $this->link('blocked', true);
        $link->update(['state_before_delete' => 'blocked']);
        $this->postJson($this->path('reassignment-preview'), $this->selection([$link]))->assertOk()->assertJsonPath('links.0.conflict', 'blocked');
        $this->postJson($this->path('reassign'), $this->execution([$link]), ['Idempotency-Key' => 'blocked-domain-move'])->assertStatus(409);
    }

    public function test_removed_or_rehomed_links_require_a_new_review(): void
    {
        $link = $this->link('moved');
        $body = $this->execution([$link]);
        $link->update(['domain_id' => $this->target->id, 'version' => 2]);
        $this->postJson($this->path('reassign'), $body, ['Idempotency-Key' => 'moved-domain-move'])->assertStatus(409);
        $link->delete();
        $link->forceDelete();
        $this->postJson($this->path('reassign'), $body, ['Idempotency-Key' => 'purged-domain-move'])->assertStatus(409);
    }

    public function test_restoring_a_trashed_link_invalidates_its_review(): void
    {
        $link = $this->link('restored', true);
        $body = $this->execution([$link]);
        $this->postJson('/api/v1/links/'.$link->id.'/restore')->assertOk();
        $this->postJson($this->path('reassign'), $body, ['Idempotency-Key' => 'restored-domain-move'])->assertStatus(409);
    }

    public function test_unavailable_or_foreign_target_and_missing_selection_are_rejected(): void
    {
        $link = $this->link('fine');
        $body = $this->selection([$link]);
        $this->target->update(['edge_eligible' => false]);
        $this->postJson($this->path('reassignment-preview'), $body)->assertStatus(409);
        $this->postJson($this->path('reassign'), $this->execution([$link]), ['Idempotency-Key' => 'offline-target-move'])->assertStatus(409);
        $body['targetDomainId'] = 999999;
        $this->postJson($this->path('reassignment-preview'), $body)->assertStatus(404);
        $body['targetDomainId'] = $this->source->id;
        $this->postJson($this->path('reassignment-preview'), $body)->assertStatus(422);
        $body['targetDomainId'] = null;
        $body['linkIds'] = [999999];
        $this->postJson($this->path('reassignment-preview'), $body)->assertStatus(409);
    }

    public function test_input_limits_are_strict(): void
    {
        foreach ([[], range(1, 101), [1, 1], ['1'], [0]] as $ids) {
            $this->postJson($this->path('reassignment-preview'), ['linkIds' => $ids, 'targetDomainId' => null])->assertStatus(422);
        }
        $link = $this->link('valid');
        $this->postJson($this->path('reassignment-preview'), ['linkIds' => [$link->id]])->assertStatus(422);
        $this->postJson($this->path('reassign'), $this->execution([$link]))->assertStatus(422);
    }

    public function test_permissions_and_revoked_sessions_are_rechecked_even_on_replay(): void
    {
        $link = $this->link('permissions');
        $body = $this->execution([$link]);
        $headers = ['Idempotency-Key' => 'permission-domain'];
        $this->postJson($this->path('reassign'), $body, $headers)->assertOk();
        foreach (['editor', 'viewer'] as $role) {
            $this->workspace->memberships()->update(['role' => $role]);
            $this->getJson($this->path('deletion-preview'))->assertStatus(403);
            $this->postJson($this->path('reassign'), $body, $headers)->assertStatus(403);
        }
        $this->workspace->memberships()->update(['role' => 'owner']);
        DB::table('sessions')->where('id', Ids::sha256Hex($this->session))->update(['revoked_at' => now()]);
        $this->postJson($this->path('reassign'), $body, $headers)->assertStatus(401);
    }

    public function test_delete_remains_separate_and_rechecks_new_live_and_trashed_links(): void
    {
        $this->getJson($this->path('deletion-preview'))->assertOk()->assertJsonPath('canDelete', true);
        $link = $this->link('late');
        $this->deleteJson($this->path())->assertStatus(409);
        $link->update(['deleted_at' => now(), 'state' => 'deleted', 'state_before_delete' => 'active']);
        $this->deleteJson($this->path())->assertStatus(409);
        $this->postJson($this->path('reassign'), $this->execution([$link]), ['Idempotency-Key' => 'trash-domain-move'])->assertOk();
        $this->deleteJson($this->path())->assertOk();
        $this->assertDatabaseMissing('custom_domains', ['id' => $this->source->id]);
        $this->assertDatabaseHas('audit_events', ['action' => 'domain.delete', 'resource_id' => $this->source->id]);
    }

    public function test_a_pending_domain_can_be_deleted_and_trash_filter_is_scoped(): void
    {
        $this->link('source-trash', true);
        $this->link('target-trash', true, $this->target);
        $this->getJson('/api/v1/links/trash?domainId='.$this->source->id)->assertOk()->assertJsonPath('total', 1)->assertJsonPath('links.0.link.domainId', $this->source->id);
        $this->getJson('/api/v1/links/trash?domainId=invalid')->assertStatus(422);
        $idle = $this->domain('typo.example.test');
        $idle->update(['edge_eligible' => false, 'tls_status' => 'pending', 'tls_ready_at' => null, 'ownership_status' => 'pending', 'routing_status' => 'unknown']);
        $this->deleteJson('/api/v1/domains/'.$idle->id)->assertOk();
    }

    public static function races(): array
    {
        return ['editing' => ['edit'], 'restoring' => ['restore'], 'purging' => ['purge'], 'attaching during deletion' => ['attach'], 'creating during deletion' => ['create'], 'duplicate confirmation' => ['duplicate']];
    }

    #[DataProvider('races')]
    public function test_real_concurrent_requests_preserve_domain_and_link_invariants(string $race): void
    {
        $trash = in_array($race, ['restore', 'purge'], true);
        $link = $this->link('racing', $trash, in_array($race, ['attach', 'create'], true) ? $this->target : null);
        $reassign = ['method' => 'POST', 'path' => $this->path('reassign'), 'body' => $this->execution([$link]), 'key' => 'concurrent-domain-batch'];
        $other = match ($race) {
            'edit' => ['method' => 'PATCH', 'path' => '/api/v1/links/'.$link->id, 'body' => ['version' => 1, 'destination' => 'https://example.org/edited']],
            'restore' => ['method' => 'POST', 'path' => '/api/v1/links/'.$link->id.'/restore', 'body' => []],
            'purge' => ['method' => 'POST', 'path' => '/api/v1/links/'.$link->id.'/purge', 'body' => ['password' => 'correct horse battery staple', 'confirmation' => 'ELIMINAR racing']],
            'attach' => ['method' => 'PATCH', 'path' => '/api/v1/links/'.$link->id, 'body' => ['version' => 1, 'domainId' => $this->source->id]],
            'create' => ['method' => 'POST', 'path' => '/api/v1/links', 'body' => ['alias' => 'created-during-delete', 'domainId' => $this->source->id, 'destination' => 'https://example.org/new']],
            default => $reassign,
        };
        if (in_array($race, ['attach', 'create'], true)) {
            $reassign = ['method' => 'DELETE', 'path' => $this->path(), 'body' => []];
        }
        $results = $this->concurrent([$reassign, $other]);
        $this->assertLessThan($results[0]['end'], $results[1]['start'], 'The requests must actually overlap');
        foreach ($results as $result) {
            $this->assertContains($result['status'], [200, 201, 403, 404, 409], json_encode($results));
        }
        $fresh = Link::withTrashed()->find($link->id);
        if ($race === 'create') {
            $created = Link::where('alias', 'created-during-delete')->first();
            if ($results[1]['status'] === 201) {
                $this->assertSame(409, $results[0]['status']);
                $this->assertSame((int) $this->source->id, (int) $created->domain_id);
            } else {
                $this->assertSame(200, $results[0]['status']);
                $this->assertNull($created);
            }
        } elseif ($race === 'attach') {
            $this->assertNotNull($fresh->domain_id, 'Deletion must never silently detach a concurrently assigned link');
            if ((int) $fresh->domain_id === (int) $this->source->id) {
                $this->assertDatabaseHas('custom_domains', ['id' => $this->source->id]);
                $this->assertSame(409, $results[0]['status']);
            } else {
                $this->assertSame(200, $results[0]['status']);
                $this->assertSame(403, $results[1]['status']);
            }
        } elseif ($race === 'duplicate') {
            $this->assertSame([200, 200], array_column($results, 'status'));
            $this->assertSame(2, (int) $fresh->version);
            $this->assertSame(1, DB::table('link_versions')->count());
        } elseif ($race === 'purge') {
            $this->assertSame(200, $results[1]['status']);
            $this->assertNull($fresh);
        } elseif ($race === 'restore') {
            $this->assertSame(200, $results[1]['status']);
            $this->assertNull($fresh->deleted_at);
            $this->assertContains((int) $fresh->domain_id, [(int) $this->source->id, (int) $this->target->id]);
        } else {
            $this->assertContains(200, array_column($results, 'status'));
            $this->assertSame(2, (int) $fresh->version);
        }
    }

    public function test_foreign_resources_are_not_exposed_and_admin_is_supported(): void
    {
        $foreign = $this->owner->ownedWorkspaces()->create(['name' => 'Foreign', 'slug' => 'foreign']);
        $this->source->update(['workspace_id' => $foreign->id]);
        $this->getJson($this->path('deletion-preview'))->assertStatus(404);
        $this->postJson($this->path('reassignment-preview'), ['linkIds' => [123], 'targetDomainId' => null])->assertStatus(404);
        $this->source->update(['workspace_id' => $this->workspace->id]);
        $this->workspace->memberships()->update(['role' => 'admin']);
        $this->getJson($this->path('deletion-preview'))->assertOk();
    }

    public function test_audit_admission_failure_rolls_back_both_moves_and_deletion(): void
    {
        $this->withoutExceptionHandling();
        $fail = false;
        DB::connection()->beforeExecuting(function (string $query) use (&$fail): void {
            if ($fail && str_contains($query, 'insert into "audit_outbox"')) {
                throw new \RuntimeException('Simulated audit admission failure');
            }
        });
        try {
            $fail = true;
            try {
                $this->deleteJson($this->path());
                $this->fail('Deletion must fail if its durable audit cannot be admitted');
            } catch (\RuntimeException $error) {
                $this->assertStringContainsString('Simulated audit', $error->getMessage());
            }
            $fail = false;
            $this->assertDatabaseHas('custom_domains', ['id' => $this->source->id]);
            $link = $this->link('rollback');
            $fail = true;
            try {
                $this->postJson($this->path('reassign'), $this->execution([$link]), ['Idempotency-Key' => 'audit-failure-move']);
                $this->fail('Reassignment must roll back on audit admission failure');
            } catch (\RuntimeException $error) {
                $this->assertStringContainsString('Simulated audit', $error->getMessage());
            }
            $fail = false;
            $this->assertSame((int) $this->source->id, (int) $link->fresh()->domain_id);
            $this->assertSame(1, (int) $link->fresh()->version);
            $this->assertSame(0, DB::table('link_versions')->count());
        } finally {
            $fail = false;
        }
    }

    /** @param list<array<string, mixed>> $operations @return list<array<string, mixed>> */
    private function concurrent(array $operations): array
    {
        $cfg = config('database.connections.pgsql');
        $environment = ['APP_ENV' => 'testing', 'APP_KEY' => (string) config('app.key'), 'DB_CONNECTION' => 'pgsql',
            'DB_HOST' => (string) $cfg['host'], 'DB_PORT' => (string) $cfg['port'],
            'DB_DATABASE' => DB::connection()->getDatabaseName(), 'DB_USERNAME' => (string) $cfg['username'], 'DB_PASSWORD' => (string) $cfg['password'],
            'CACHE_STORE' => 'array', 'QUEUE_CONNECTION' => 'sync', 'MAIL_MAILER' => 'array'];
        $processes = [];
        $prefix = 'uvh-domain-race-'.bin2hex(random_bytes(4));
        DB::beginTransaction();
        try {
            DB::table('workspaces')->where('id', $this->workspace->id)->lockForUpdate()->first();
            foreach ($operations as $i => $operation) {
                $process = new Process([PHP_BINARY, base_path('tests/Support/domain-management-probe.php')], base_path(), $environment);
                $process->setInput(json_encode([...$operation, 'workspace' => $this->workspace->id, 'session' => $this->session, 'name' => $prefix.'-'.$i], JSON_THROW_ON_ERROR));
                $process->setTimeout(20);
                $process->start();
                $processes[] = $process;
            }
            $deadline = microtime(true) + 10;
            do {
                DB::select('SELECT pg_stat_clear_snapshot()');
                $waiting = DB::selectOne("SELECT count(*) AS n FROM pg_stat_activity WHERE application_name LIKE ? AND wait_event_type = 'Lock'", [$prefix.'%']);
                if ((int) $waiting->n === 2) {
                    break;
                }
                usleep(10000);
            } while (microtime(true) < $deadline);
            $this->assertSame(2, (int) $waiting->n, 'Both real requests must be waiting on locks before the barrier opens');
        } finally {
            DB::commit();
        }
        $results = [];
        try {
            foreach ($processes as $process) {
                $process->wait();
                $this->assertTrue($process->isSuccessful(), 'Concurrency probe failed: '.$process->getErrorOutput());
                $results[] = json_decode(trim($process->getOutput()), true, 32, JSON_THROW_ON_ERROR);
            }
        } finally {
            foreach ($processes as $process) {
                if ($process->isRunning()) {
                    $process->stop();
                }
            }
        }

        return $results;
    }

    private function domain(string $host): CustomDomain
    {
        return CustomDomain::create(['workspace_id' => $this->workspace->id, 'domain' => $host, 'verification_token' => 'uvh-verify=DomainRemoval1234', 'verification_scheme' => 2, 'desired_state' => 'enabled', 'ownership_status' => 'verified', 'routing_status' => 'healthy', 'tls_status' => 'ready', 'edge_eligible' => true, 'verified_at' => now(), 'ownership_verified_at' => now(), 'routing_verified_at' => now(), 'tls_ready_at' => now()]);
    }

    private function link(string $alias, bool $trash = false, ?CustomDomain $domain = null): Link
    {
        $id = Link::insertGetId(['workspace_id' => $this->workspace->id, 'created_by' => $this->owner->id, 'domain_id' => ($domain ?? $this->source)->id, 'alias' => $alias, 'destination' => 'https://example.org/'.$alias, 'state' => $trash ? 'deleted' : 'active', 'state_before_delete' => $trash ? 'paused' : null, 'deleted_at' => $trash ? now()->subDays(3) : null, 'click_count' => 12, 'version' => 1, 'created_at' => now(), 'updated_at' => now()]);

        return Link::withTrashed()->findOrFail($id);
    }

    private function path(string $suffix = ''): string
    {
        return '/api/v1/domains/'.$this->source->id.($suffix === '' ? '' : '/'.$suffix);
    }

    /** @param list<Link> $links @return array<string, mixed> */
    private function selection(array $links): array
    {
        return ['linkIds' => array_map(fn ($link) => (int) $link->id, $links), 'targetDomainId' => (int) $this->target->id];
    }

    /** @param list<Link> $links @return array<string, mixed> */
    private function execution(array $links): array
    {
        return [...$this->selection($links), 'expectedVersions' => array_map(fn ($link) => ['id' => (int) $link->id, 'version' => (int) $link->version], $links)];
    }
}
