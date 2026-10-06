<?php

namespace Tests\Feature;

use App\Console\Commands\UvhHousekeeping;
use App\Models\ApiToken;
use App\Models\Link;
use App\Models\User;
use App\Support\Csv;
use App\Support\Ids;
use App\Support\IsoDate;
use App\Support\ReleaseReadiness;
use App\Support\SessionManager;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Schema;
use PHPUnit\Framework\Attributes\DataProvider;
use ReflectionMethod;
use Tests\TestCase;

final class LinkLifecycleInstantTest extends TestCase
{
    private const BEARER = 'link-lifecycle-fixture-bearer';

    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, workspaces, audit_events, audit_outbox, operational_metrics RESTART IDENTITY CASCADE');
        config(['cache.default' => 'array']);
        $this->travelTo(Carbon::parse('2026-10-06T12:00:00Z'));
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', 'lifecycle-csrf')->withHeader('X-CSRF-Token', 'lifecycle-csrf');
        Queue::fake();
    }

    public static function dateShapes(): array
    {
        return [
            'positive offset' => ['2030-01-10T14:00:00.123456+02:00', '2030-01-11T14:00:00.123456+02:00'],
            'negative offset' => ['2030-01-10T05:00:00.987654-07:00', '2030-01-11T05:00:00.987654-07:00'],
            'UTC fraction' => ['2030-01-10T12:00:00.123456Z', '2030-01-11T12:00:00.123456Z'],
            'UTC integer' => ['2030-01-10T12:00:00Z', '2030-01-11T12:00:00Z'],
            'calendar date' => ['2030-01-10', '2030-01-11'],
            'unbounded' => [null, null],
        ];
    }

    public static function nativeDates(): array
    {
        $cases = [];
        foreach (['browser', 'bearer'] as $client) {
            foreach (['create', 'update'] as $operation) {
                foreach (self::dateShapes() as $name => [$scheduled, $expires]) {
                    $cases[$client.' '.$operation.' '.$name] = [$client, $operation, $scheduled, $expires];
                }
            }
        }

        return $cases;
    }

    public static function derivationDeadlines(): array
    {
        $cases = [];
        foreach (['browser', 'bearer'] as $client) {
            foreach (['create', 'update'] as $operation) {
                foreach ([-1, 0, 1] as $seconds) {
                    $cases[$client.' '.$operation.' '.$seconds] = [$client, $operation, $seconds];
                }
            }
        }

        return $cases;
    }

    public static function stateDeadlines(): array
    {
        $cases = [];
        foreach (['single', 'bulk'] as $mode) {
            foreach ([-1, 0, 1] as $seconds) {
                $cases[$mode.' '.$seconds] = [$mode, $seconds];
            }
        }

        return $cases;
    }

    public static function redirectDeadlines(): array
    {
        $cases = [];
        foreach (['plain', 'single-use', 'limited'] as $limit) {
            foreach (['initial', 'locked'] as $stage) {
                foreach ([-1, 0, 1] as $seconds) {
                    $cases[$limit.' '.$stage.' '.$seconds] = [$limit, $stage, $seconds];
                }
            }
        }

        return $cases;
    }

    public static function housekeepingDeadlines(): array
    {
        $cases = [];
        foreach (['active', 'scheduled'] as $state) {
            foreach ([-1, 0, 1] as $seconds) {
                $cases[$state.' '.$seconds] = [$state, $seconds];
            }
        }

        return $cases;
    }

    public static function clients(): array
    {
        return [['browser'], ['bearer']];
    }

    public static function protectedStates(): array
    {
        $cases = [];
        foreach (['browser', 'bearer'] as $client) {
            foreach (['paused', 'archived', 'blocked'] as $state) {
                $cases[$client.' '.$state] = [$client, $state];
            }
        }

        return $cases;
    }

    public static function invalidPairs(): array
    {
        $cases = [];
        foreach (['browser', 'bearer'] as $client) {
            foreach (['equal', 'reversed', 'invalid'] as $kind) {
                $cases[$client.' '.$kind] = [$client, $kind];
            }
        }

        return $cases;
    }

    public static function seconds(): array
    {
        return [[-1], [0], [1]];
    }

    public static function impreciseColumns(): array
    {
        return [['scheduled_at'], ['expires_at'], ['both']];
    }

    public static function fractionalLifecycle(): array
    {
        $cases = [];
        foreach (['activation', 'expiry'] as $kind) {
            foreach ([-1, 0, 1] as $microseconds) {
                $cases[$kind.' '.$microseconds] = [$kind, $microseconds];
            }
        }

        return $cases;
    }

    public static function delayedCreation(): array
    {
        return [['browser', 'activation'], ['browser', 'expiry'], ['bearer', 'activation'], ['bearer', 'expiry']];
    }

    public static function fractionalDowngrades(): array
    {
        return [['scheduled_at', 'active'], ['expires_at', 'active'], ['scheduled_at', 'historical'], ['expires_at', 'historical']];
    }

    #[DataProvider('nativeDates')]
    public function test_native_writes_preserve_the_requested_instant_and_json_contract(string $client, string $operation, ?string $scheduled, ?string $expires): void
    {
        $this->fixture($client);
        $link = $operation === 'update' ? $this->link() : null;
        $body = ['destination' => 'https://example.org/native', 'scheduledAt' => $scheduled, 'expiresAt' => $expires];
        $base = $client === 'bearer' ? '/api/v1/public/links' : '/api/v1/links';
        $response = $operation === 'create'
            ? $this->postJson($base, $body)
            : $this->patchJson($base.'/'.$link->id, $body + ['version' => 1]);
        $response->assertStatus($operation === 'create' ? 201 : 200);
        $stored = Link::findOrFail($response->json('link.id'));
        $this->assertInstant($scheduled, $stored->scheduled_at);
        $this->assertInstant($expires, $stored->expires_at);
        $response->assertJsonPath('link.scheduledAt', IsoDate::format($scheduled))
            ->assertJsonPath('link.expiresAt', IsoDate::format($expires));
        $this->assertSame($operation === 'create' ? 1 : 2, (int) $stored->version);
        $this->assertDatabaseHas('audit_events', ['action' => $operation === 'create' ? 'link.create' : 'link.update', 'resource_id' => (string) $stored->id]);
    }

    #[DataProvider('derivationDeadlines')]
    public function test_native_write_derives_expired_at_the_deadline(string $client, string $operation, int $seconds): void
    {
        $this->fixture($client);
        $link = $operation === 'update' ? $this->link() : null;
        $body = ['destination' => 'https://example.org/deadline', 'expiresAt' => now()->addSeconds($seconds)->toIso8601String()];
        $base = $client === 'bearer' ? '/api/v1/public/links' : '/api/v1/links';
        $response = $operation === 'create'
            ? $this->postJson($base, $body)
            : $this->patchJson($base.'/'.$link->id, $body + ['version' => 1]);
        $response->assertStatus($operation === 'create' ? 201 : 200)
            ->assertJsonPath('link.state', $seconds <= 0 ? 'expired' : 'active');
    }

    #[DataProvider('stateDeadlines')]
    public function test_activation_refuses_an_expired_deadline_without_business_changes(string $mode, int $seconds): void
    {
        $this->fixture();
        $link = $this->link(['state' => 'paused', 'expires_at' => now()->addSeconds($seconds)]);
        $before = $this->businessState();
        $response = $mode === 'single'
            ? $this->postJson('/api/v1/links/'.$link->id.'/state', ['state' => 'active'])
            : $this->withHeader('Idempotency-Key', 'lifecycle-activate')->postJson('/api/v1/links/bulk', ['action' => 'activate', 'linkIds' => [$link->id]]);
        $response->assertStatus($seconds <= 0 ? 409 : 200);
        if ($seconds <= 0) {
            $this->assertSame($before, $this->businessState());
        } else {
            $this->assertSame('active', $link->fresh()->state);
        }
    }

    #[DataProvider('stateDeadlines')]
    public function test_restore_derives_expired_at_the_deadline(string $mode, int $seconds): void
    {
        $this->fixture();
        $link = $this->link(['state' => 'deleted', 'state_before_delete' => 'active', 'deleted_at' => now(), 'expires_at' => now()->addSeconds($seconds)]);
        $response = $mode === 'single'
            ? $this->postJson('/api/v1/links/'.$link->id.'/restore')
            : $this->withHeader('Idempotency-Key', 'lifecycle-restore')->postJson('/api/v1/links/bulk', ['action' => 'restore', 'linkIds' => [$link->id]]);
        $response->assertOk();
        $stored = Link::findOrFail($link->id);
        $this->assertSame($seconds <= 0 ? 'expired' : 'active', $stored->state);
        $this->assertNull($stored->deleted_at);
    }

    #[DataProvider('redirectDeadlines')]
    public function test_redirect_refuses_deadlines_before_counting_or_spending_limits(string $limit, string $stage, int $seconds): void
    {
        $this->fixture();
        $instant = now()->addSeconds($stage === 'locked' ? 10 : 0);
        $link = $this->link(['expires_at' => $instant->copy()->addSeconds($seconds), 'single_use' => $limit === 'single-use', 'max_clicks' => $limit === 'limited' ? 2 : null]);
        $fired = false;
        if ($stage === 'locked') {
            DB::listen(function (QueryExecuted $event) use (&$fired, $instant): void {
                if (! $fired && str_starts_with($event->sql, 'select * from "links"') && (str_contains($event->sql, 'for share') || str_contains($event->sql, 'for update'))) {
                    $fired = true;
                    $this->travelTo($instant);
                }
            });
        }
        $response = $this->call('GET', 'http://'.config('uvh.public_host').'/'.$link->alias);
        $response->assertStatus($seconds <= 0 ? 404 : 302);
        if ($stage === 'locked') {
            $this->assertTrue($fired, 'Clock must cross the deadline after the snapshot, inside the locked decision');
        }
        $this->assertSame($seconds <= 0 ? 0 : 1, (int) $link->fresh()->click_count);
        $this->assertSame($seconds > 0 && $limit === 'single-use', $link->fresh()->used_at !== null);
        if ($seconds <= 0) {
            $this->assertDatabaseCount('webhook_deliveries', 0);
            Queue::assertNothingPushed();
        }
    }

    #[DataProvider('housekeepingDeadlines')]
    public function test_due_transition_uses_the_same_expiry_boundary(string $state, int $seconds): void
    {
        $this->fixture();
        $link = $this->link(['state' => $state, 'scheduled_at' => $state === 'scheduled' ? now()->subSecond() : null, 'expires_at' => now()->addSeconds($seconds)]);
        $this->transitionDueLinks();
        $this->assertSame($seconds <= 0 ? 'expired' : 'active', $link->fresh()->state);
        $this->assertSame($state === 'active' && $seconds > 0 ? 1 : 2, (int) $link->fresh()->version);
    }

    #[DataProvider('dateShapes')]
    public function test_csv_import_preserves_instants_and_replay(?string $scheduled, ?string $expires): void
    {
        $this->fixture();
        $csv = Csv::line(['alias', 'destination', 'scheduled_at', 'expires_at'])."\n".Csv::line(['lifecycle-csv', 'https://example.org/csv', $scheduled ?? '', $expires ?? ''])."\n";
        $body = ['csv' => $csv, 'dryRun' => false];
        $this->withHeader('Idempotency-Key', 'lifecycle-csv-import')->postJson('/api/v1/links/import', $body)->assertOk()->assertJsonPath('created', 1);
        $stored = Link::where('alias', 'lifecycle-csv')->firstOrFail();
        $this->assertInstant($scheduled === '' ? null : $scheduled, $stored->scheduled_at);
        $this->assertInstant($expires === '' ? null : $expires, $stored->expires_at);
        $this->postJson('/api/v1/links/import', $body)->assertOk()->assertHeader('Idempotent-Replay', 'true');
        $this->assertDatabaseCount('links', 1);
    }

    #[DataProvider('clients')]
    public function test_patch_omitting_dates_preserves_the_full_stored_instant(string $client): void
    {
        $this->fixture($client);
        $this->withPreciseSchema(function () use ($client): void {
            // A restored precise schema must not be damaged by an unrelated
            // edit. Guarded *_test-only DDL rolls back with this transaction.
            $scheduled = '2030-01-10T12:00:00.123456Z';
            $expires = '2030-01-11T12:00:00.987654Z';
            $link = $this->link();
            DB::table('links')->where('id', $link->id)->update(['scheduled_at' => $scheduled, 'expires_at' => $expires]);
            $base = $client === 'bearer' ? '/api/v1/public/links' : '/api/v1/links';
            $this->patchJson($base.'/'.$link->id, ['version' => 1, 'notes' => 'Unrelated edit'])->assertOk();
            $this->assertInstant($scheduled, $link->fresh()->scheduled_at);
            $this->assertInstant($expires, $link->fresh()->expires_at);
        });
    }

    public function test_csv_export_import_keeps_full_precision(): void
    {
        $this->fixture();
        $this->withPreciseSchema(function (): void {
            $scheduled = '2030-01-10T12:00:00.123456Z';
            $expires = '2030-01-11T12:00:00.987654Z';
            $link = $this->link();
            DB::table('links')->where('id', $link->id)->update(['scheduled_at' => $scheduled, 'expires_at' => $expires]);
            $response = $this->getJson('/api/v1/links/export.csv')->assertOk();
            $parsed = Csv::parse((string) $response->getContent(), 500);
            $this->assertTrue($parsed['ok']);
            $cells = array_combine($parsed['header'], $parsed['rows'][0]);
            $this->assertInstant($scheduled, IsoDate::parse($cells['scheduled_at']));
            $this->assertInstant($expires, IsoDate::parse($cells['expires_at']));
            // Release the public alias to import exactly the emitted CSV.
            $link->forceDelete();
            $this->withHeader('Idempotency-Key', 'lifecycle-export-roundtrip')->postJson('/api/v1/links/import', ['csv' => $response->getContent(), 'dryRun' => false])->assertOk()->assertJsonPath('created', 1);
            $stored = Link::where('alias', $link->alias)->firstOrFail();
            $this->assertInstant($scheduled, $stored->scheduled_at);
            $this->assertInstant($expires, $stored->expires_at);
        });
    }

    #[DataProvider('protectedStates')]
    public function test_date_edit_preserves_operator_and_moderation_states(string $client, string $state): void
    {
        $this->fixture($client);
        $link = $this->link(['state' => $state]);
        $base = $client === 'bearer' ? '/api/v1/public/links' : '/api/v1/links';
        $this->patchJson($base.'/'.$link->id, ['version' => 1, 'expiresAt' => now()->toIso8601String()])->assertOk()->assertJsonPath('link.state', $state);
    }

    #[DataProvider('invalidPairs')]
    public function test_invalid_pair_is_rejected_without_success_side_effects(string $client, string $kind): void
    {
        $this->fixture($client);
        $before = $this->businessState();
        $base = $client === 'bearer' ? '/api/v1/public/links' : '/api/v1/links';
        $scheduled = '2030-01-10T12:00:00Z';
        $expires = match ($kind) {
            'equal' => $scheduled,
            'reversed' => '2030-01-10T11:00:00Z',
            'invalid' => '2030-02-30T12:00:00Z',
        };
        $this->postJson($base, ['destination' => 'https://example.org/invalid', 'scheduledAt' => $scheduled, 'expiresAt' => $expires])->assertUnprocessable();
        $this->assertSame($before, $this->businessState());
        Queue::assertNothingPushed();
    }

    #[DataProvider('seconds')]
    public function test_scheduled_activation_remains_due_at_or_after_its_instant(int $seconds): void
    {
        $this->fixture();
        $link = $this->link(['state' => 'scheduled', 'scheduled_at' => now()->addSeconds($seconds), 'expires_at' => now()->addDay()]);
        $this->transitionDueLinks();
        $this->assertSame($seconds <= 0 ? 'active' : 'scheduled', $link->fresh()->state);
        $this->call('GET', 'http://'.config('uvh.public_host').'/'.$link->alias)->assertStatus($seconds <= 0 ? 302 : 404);
    }

    #[DataProvider('impreciseColumns')]
    public function test_completed_ledger_cannot_hide_imprecise_link_columns(string $field): void
    {
        DB::beginTransaction();
        try {
            foreach ($field === 'both' ? ['scheduled_at', 'expires_at'] : [$field] as $column) {
                DB::statement('ALTER TABLE links ALTER COLUMN '.$column.' TYPE timestamp(0) with time zone');
            }
            $this->assertContains('Falta la precisión de fechas de enlaces (2026_10_06).', ReleaseReadiness::errors());
        } finally {
            DB::rollBack();
        }
    }

    #[DataProvider('fractionalLifecycle')]
    public function test_housekeeping_preserves_fractional_activation_and_expiry_boundaries(string $kind, int $microseconds): void
    {
        $this->fixture();
        $this->travelTo(now()->addMicroseconds(500000));
        $date = now()->addMicroseconds($microseconds);
        $link = $this->link($kind === 'activation'
            ? ['state' => 'scheduled', 'scheduled_at' => $date, 'expires_at' => now()->addDay()]
            : ['expires_at' => $date]);
        $this->transitionDueLinks();
        $this->assertSame($kind === 'activation'
            ? ($microseconds <= 0 ? 'active' : 'scheduled')
            : ($microseconds <= 0 ? 'expired' : 'active'), $link->fresh()->state);
    }

    #[DataProvider('delayedCreation')]
    public function test_creation_derives_state_after_waiting_for_authority(string $client, string $kind): void
    {
        $this->fixture($client);
        $instant = now()->addSeconds(10);
        $fired = false;
        DB::listen(function (QueryExecuted $event) use (&$fired, $instant): void {
            if (! $fired && str_starts_with($event->sql, 'select * from "users"') && str_contains($event->sql, 'for update')) {
                $fired = true;
                $this->travelTo($instant);
            }
        });
        $base = $client === 'bearer' ? '/api/v1/public/links' : '/api/v1/links';
        $body = ['destination' => 'https://example.org/delayed', $kind === 'activation' ? 'scheduledAt' : 'expiresAt' => $instant->toIso8601String()];
        $response = $this->postJson($base, $body);
        $this->assertTrue($fired, 'Creation must observe an actual locked authority query after the initial clock');
        $response->assertCreated()->assertJsonPath('link.state', $kind === 'activation' ? 'active' : 'expired');
    }

    public function test_migration_roundtrip_keeps_integer_unbounded_rows_and_indexes(): void
    {
        $this->fixture();
        $this->link(['scheduled_at' => now()->subDay(), 'expires_at' => now()->addDay()]);
        $this->link(['alias' => 'unbounded-legacy']);
        $before = DB::table('links')->orderBy('id')->get()->toArray();
        $indexes = Schema::getIndexes('links');
        $migration = require database_path('migrations/2026_10_06_000002_preserve_link_lifecycle_precision.php');
        DB::beginTransaction();
        try {
            $migration->down();
            foreach (['scheduled_at', 'expires_at'] as $field) {
                $this->assertSame('timestamp(0) with time zone', collect(Schema::getColumns('links'))->firstWhere('name', $field)['type']);
            }
            $migration->up();
            foreach (['scheduled_at', 'expires_at'] as $field) {
                $this->assertSame('timestamp(6) with time zone', collect(Schema::getColumns('links'))->firstWhere('name', $field)['type']);
            }
            $this->assertEquals($before, DB::table('links')->orderBy('id')->get()->toArray());
            $this->assertSame($indexes, Schema::getIndexes('links'));
        } finally {
            DB::rollBack();
        }
    }

    #[DataProvider('fractionalDowngrades')]
    public function test_downgrade_cannot_round_active_or_historical_link_instants(string $field, string $kind): void
    {
        $this->fixture();
        $date = ($kind === 'active' ? now()->addDay() : now()->subDay())->addMicroseconds(123456);
        $link = $this->link([$field => $date, 'state' => $kind === 'active' ? 'active' : 'deleted', 'deleted_at' => $kind === 'active' ? null : now()]);
        $migration = require database_path('migrations/2026_10_06_000002_preserve_link_lifecycle_precision.php');
        try {
            $migration->down();
            $this->fail('Precision downgrade must refuse any fractional lifecycle instant');
        } catch (\RuntimeException $e) {
            $this->assertSame('Cannot reduce link lifecycle precision while fractional instants exist', $e->getMessage());
        }
        $stored = Link::withTrashed()->findOrFail($link->id);
        $this->assertTrue($date->equalTo($stored->{$field}));
        foreach (['scheduled_at', 'expires_at'] as $column) {
            $this->assertSame('timestamp(6) with time zone', collect(Schema::getColumns('links'))->firstWhere('name', $column)['type']);
        }
    }

    public function test_precise_link_columns_do_not_hide_an_unapplied_migration(): void
    {
        DB::beginTransaction();
        try {
            $this->assertSame(1, DB::table('migrations')->where('migration', '2026_10_06_000002_preserve_link_lifecycle_precision')->delete());
            $this->assertContains('Hay 1 migraciones pendientes para esta imagen.', ReleaseReadiness::errors());
            $this->artisan('uvh:release-check')->assertExitCode(1);
            $this->assertDatabaseMissing('migrations', ['migration' => '2026_10_06_000002_preserve_link_lifecycle_precision']);
        } finally {
            DB::rollBack();
        }
    }

    private function fixture(string $client = 'browser'): void
    {
        $user = User::factory()->create(['email_verified_at' => now()]);
        $workspace = $user->ownedWorkspaces()->create(['name' => 'Lifecycle', 'slug' => 'lifecycle']);
        $workspace->memberships()->create(['user_id' => $user->id, 'role' => 'owner']);
        $workspace->quota()->create(['links_limit' => 100]);
        $session = SessionManager::create($user->id, Request::create('/'), (int) $user->security_version, true);
        $this->withCookie((string) config('uvh.session_cookie'), $session)->withHeader('X-Workspace-Id', (string) $workspace->id);
        if ($client === 'bearer') {
            ApiToken::create(['workspace_id' => $workspace->id, 'created_by' => $user->id, 'name' => 'Lifecycle', 'token_hash' => Ids::sha256Hex(self::BEARER), 'scopes' => ['links:read', 'links:write']]);
            $this->withHeader('Authorization', 'Bearer '.self::BEARER);
        }
    }

    private function link(array $attributes = []): Link
    {
        return Link::create(array_merge(['workspace_id' => DB::table('workspaces')->value('id'), 'created_by' => DB::table('users')->value('id'), 'alias' => 'lifecycle-link', 'destination' => 'https://example.org/lifecycle', 'state' => 'active', 'version' => 1], $attributes));
    }

    private function assertInstant(?string $expected, ?Carbon $actual): void
    {
        $this->assertSame($expected === null ? null : IsoDate::parse($expected)->utc()->format('Y-m-d\TH:i:s.u\Z'), $actual?->copy()->utc()->format('Y-m-d\TH:i:s.u\Z'));
    }

    private function withPreciseSchema(callable $exercise): void
    {
        DB::beginTransaction();
        try {
            DB::statement('ALTER TABLE links ALTER COLUMN scheduled_at TYPE timestamp(6) with time zone, ALTER COLUMN expires_at TYPE timestamp(6) with time zone');
            $exercise();
        } finally {
            DB::rollBack();
        }
    }

    private function transitionDueLinks(): void
    {
        // Exercise the native stage without invoking unrelated purges,
        // mail delivery, provider sweeps or a productive scheduler.
        (new ReflectionMethod(UvhHousekeeping::class, 'transitionDueLinks'))->invoke(new UvhHousekeeping);
    }

    private function businessState(): array
    {
        $state = [];
        foreach (['links', 'audit_events', 'audit_outbox', 'webhook_deliveries'] as $table) {
            $state[$table] = DB::table($table)->orderBy('id')->get()->map(static fn ($row) => (array) $row)->all();
        }

        return $state;
    }
}
