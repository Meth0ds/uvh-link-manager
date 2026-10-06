<?php

namespace Tests\Feature;

use App\Models\ApiToken;
use App\Models\Link;
use App\Models\User;
use App\Support\Ids;
use App\Support\IsoDate;
use App\Support\ReleaseReadiness;
use App\Support\SessionManager;
use App\Support\UvhCrypto;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Schema;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/** Native HTTP/SQL boundaries; serial hooks do not claim cross-process races. */
final class ApiTokenAuthorityBoundaryTest extends TestCase
{
    private const PASSWORD = 'api-authority-fixture-password-42';

    private const RECOVERY = 'ABCD2345EFGH6789';

    private const BEARER = 'api-authority-fixture-bearer';

    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, workspaces, audit_events, audit_outbox, mail_outbox, notifications, operational_metrics RESTART IDENTITY CASCADE');
        config(['cache.default' => 'array']);
        $this->travelTo(now()->startOfSecond());
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', 'api-authority-csrf')->withHeader('X-CSRF-Token', 'api-authority-csrf');
        Queue::fake();
    }

    public static function middlewareDeadlines(): array
    {
        // Invalid/missing resources on write routes keep this admission test
        // from doing business or DNS/provider I/O if middleware is defective.
        $routes = [
            ['GET', '/public/links'], ['GET', '/public/links/999999'],
            ['POST', '/public/links/check-alias'], ['POST', '/public/links'],
            ['PATCH', '/public/links/999999'], ['POST', '/public/links/999999/state'],
            ['DELETE', '/public/links/999999'], ['POST', '/public/links/999999/restore'],
            ['GET', '/public/domains'], ['POST', '/public/domains'],
            ['POST', '/public/domains/999999/verify'], ['POST', '/public/domains/999999/activate'],
            ['GET', '/public/domains/999999/activity'], ['POST', '/public/domains/999999/disable'],
            ['DELETE', '/public/domains/999999'], ['POST', '/public/domains/999999/revalidate'],
            ['PATCH', '/public/domains/999999'], ['GET', '/analytics/public/overview'],
        ];
        $cases = [];
        foreach ($routes as [$method, $path]) {
            foreach ([-1, 0] as $seconds) {
                $cases[$method.' '.$path.' '.$seconds] = [$method, $path, $seconds];
            }
        }

        return $cases;
    }

    public static function validReads(): array
    {
        $cases = [];
        foreach (['index', 'show', 'check-alias'] as $operation) {
            foreach ([1, null] as $seconds) {
                $cases[$operation.' '.($seconds ?? 'unbounded')] = [$operation, $seconds];
            }
        }

        return $cases;
    }

    public static function lockedDeadlines(): array
    {
        $cases = [];
        foreach (['store', 'update', 'state', 'destroy', 'restore'] as $operation) {
            foreach ([-1, 0, 1] as $seconds) {
                $cases[$operation.' '.$seconds] = [$operation, $seconds];
            }
        }

        return $cases;
    }

    public static function invalidSessions(): array
    {
        $cases = [];
        foreach (['store', 'destroy'] as $operation) {
            foreach (['revoked', 'expired', 'generation', 'foreign', 'missing'] as $change) {
                $cases[$operation.' '.$change] = [$operation, $change];
            }
        }

        return $cases;
    }

    public static function sessionDeadlines(): array
    {
        $cases = [];
        foreach ([['store', 'password'], ['store', 'recovery'], ['destroy', 'password']] as [$operation, $factor]) {
            foreach ([-1, 0, 1] as $seconds) {
                $cases[$operation.' '.$factor.' '.$seconds] = [$operation, $factor, $seconds];
            }
        }

        return $cases;
    }

    public static function chosenDeadlines(): array
    {
        return [['past'], ['now'], ['future'], ['unbounded'], ['too-far']];
    }

    public static function successfulCredentials(): array
    {
        return [['store', false], ['store', true], ['destroy', false]];
    }

    public static function roleChanges(): array
    {
        return [['store', 'viewer'], ['destroy', 'viewer'], ['store', 'editor'], ['destroy', 'editor']];
    }

    public static function fractionalDowngrades(): array
    {
        return [['active'], ['historical']];
    }

    #[DataProvider('middlewareDeadlines')]
    public function test_expired_bearer_is_rejected_before_every_native_handler(string $method, string $path, int $seconds): void
    {
        $fixture = $this->fixture();
        $fixture['apiToken']->update(['expires_at' => now()->addSeconds($seconds)]);
        $before = $this->businessState();
        $this->withHeader('Authorization', 'Bearer '.self::BEARER);
        $this->json($method, '/api/v1'.$path)->assertUnauthorized()
            ->assertJsonPath('error', 'Token inválido o revocado');
        $this->assertNull($fixture['apiToken']->fresh()->last_used_at);
        $this->assertSame($before, $this->businessState());
        Queue::assertNothingPushed();
    }

    #[DataProvider('validReads')]
    public function test_future_and_unbounded_bearers_preserve_native_reads(string $operation, ?int $seconds): void
    {
        $fixture = $this->fixture();
        $fixture['apiToken']->update(['expires_at' => $seconds === null ? null : now()->addSeconds($seconds)]);
        $this->withHeader('Authorization', 'Bearer '.self::BEARER);
        $response = match ($operation) {
            'index' => $this->getJson('/api/v1/public/links'),
            'show' => $this->getJson('/api/v1/public/links/'.$fixture['active']->id),
            'check-alias' => $this->postJson('/api/v1/public/links/check-alias', ['alias' => 'available-fixture-alias']),
        };
        $response->assertOk();
        $this->assertNotNull($fixture['apiToken']->fresh()->last_used_at);
        $this->assertDatabaseCount('audit_events', 0);
        Queue::assertNothingPushed();
    }

    #[DataProvider('lockedDeadlines')]
    public function test_bearer_expiry_is_rechecked_under_the_business_locks(string $operation, int $seconds): void
    {
        $fixture = $this->fixture();
        $before = $this->businessState();
        $this->withHeader('Authorization', 'Bearer '.self::BEARER);
        $intercepted = $this->atAccountLock(static function () use ($fixture, $seconds): void {
            DB::table('api_tokens')->where('id', $fixture['apiToken']->id)->update(['expires_at' => now()->addSeconds($seconds)]);
        });
        $response = $this->writeLink($operation, $fixture);
        $this->assertTrue($intercepted->fired);
        if ($seconds <= 0) {
            $response->assertForbidden();
            $this->assertSame($before, $this->businessState());
            Queue::assertNothingPushed();
        } else {
            $response->assertStatus($operation === 'store' ? 201 : 200);
            $this->assertNotSame($before, $this->businessState());
            $this->assertGreaterThan(0, DB::table('audit_events')->count());
        }
    }

    #[DataProvider('invalidSessions')]
    public function test_browser_credential_mutation_requires_the_exact_live_session(string $operation, string $change): void
    {
        $fixture = $this->fixture();
        $before = $this->businessState();
        $intercepted = $this->atAccountLock(static function () use ($fixture, $change): void {
            $query = DB::table('sessions')->where('id', $fixture['sessionId']);
            match ($change) {
                'revoked' => $query->update(['revoked_at' => now()]),
                'expired' => $query->update(['expires_at' => now()]),
                'generation' => $query->update(['security_version' => 2]),
                'foreign' => $query->update(['user_id' => $fixture['other']->id]),
                'missing' => $query->delete(),
            };
        });
        $this->credential($operation, $fixture)->assertStatus($operation === 'store' ? 409 : 403);
        $this->assertTrue($intercepted->fired);
        $this->assertSame($before, $this->businessState());
        $this->assertDatabaseHas('sessions', ['id' => $fixture['otherSessionId'], 'user_id' => $fixture['user']->id, 'revoked_at' => null]);
        Queue::assertNothingPushed();
    }

    #[DataProvider('sessionDeadlines')]
    public function test_session_deadline_precedes_factor_consumption(string $operation, string $factor, int $seconds): void
    {
        $fixture = $this->fixture($factor === 'recovery');
        $before = $this->businessState(includeProof: true);
        $intercepted = $this->atAccountLock(static function () use ($fixture, $seconds): void {
            DB::table('sessions')->where('id', $fixture['sessionId'])->update(['expires_at' => now()->addSeconds($seconds)]);
        });
        $response = $this->credential($operation, $fixture);
        $this->assertTrue($intercepted->fired);
        if ($seconds <= 0) {
            $response->assertStatus($operation === 'store' ? 409 : 403);
            $this->assertSame($before, $this->businessState(includeProof: true));
            Queue::assertNothingPushed();
        } else {
            $response->assertStatus($operation === 'store' ? 201 : 200);
            $this->assertNotSame($before, $this->businessState(includeProof: true));
            if ($factor === 'recovery') {
                $this->assertSame([], $fixture['user']->fresh()->recovery_codes);
            }
        }
    }

    #[DataProvider('chosenDeadlines')]
    public function test_issuance_requires_a_future_expiry_or_no_expiry(string $choice): void
    {
        $fixture = $this->fixture();
        $expires = match ($choice) {
            'past' => now()->subSecond(), 'now' => now(), 'future' => now()->addSecond(),
            'unbounded' => null, 'too-far' => now()->addYear()->addSecond(),
        };
        $before = $this->businessState(includeProof: true);
        $response = $this->credential('store', $fixture, $expires === null ? null : $expires->toISOString());
        if (in_array($choice, ['future', 'unbounded'], true)) {
            $response->assertCreated()->assertJsonPath('token.expiresAt', IsoDate::format($expires));
            $this->assertSame([], $fixture['user']->fresh()->recovery_codes);
            $this->assertDatabaseCount('api_tokens', 2);
        } else {
            $response->assertUnprocessable()->assertJsonMissingPath('plainToken');
            $this->assertSame($before, $this->businessState(includeProof: true));
            Queue::assertNothingPushed();
        }
    }

    public function test_chosen_expiry_that_elapses_before_authority_does_not_spend_a_factor(): void
    {
        $fixture = $this->fixture();
        $expires = now()->addSeconds(3)->toISOString();
        $before = $this->businessState(includeProof: true);
        $intercepted = $this->atAccountLock(function (): void {
            $this->travelTo(now()->addSeconds(5));
        });
        $this->credential('store', $fixture, $expires)->assertUnprocessable()->assertJsonMissingPath('plainToken');
        $this->assertTrue($intercepted->fired);
        $this->assertSame($before, $this->businessState(includeProof: true));
        Queue::assertNothingPushed();
    }

    public function test_chosen_expiry_that_elapses_during_real_password_check_rolls_back_mfa_proof(): void
    {
        $fixture = $this->fixture();
        $expires = now()->addSeconds(3)->toISOString();
        $before = $this->businessState(includeProof: true);
        $nativeHash = Hash::getFacadeRoot();
        $checked = false;
        Hash::shouldReceive('check')->once()->andReturnUsing(function (string $value, string $hash, array $options = []) use ($nativeHash, &$checked): bool {
            $valid = $nativeHash->check($value, $hash, $options);
            $checked = $valid;
            $this->travelTo(now()->addSeconds(5));

            return $valid;
        });
        $this->credential('store', $fixture, $expires)->assertUnprocessable()->assertJsonMissingPath('plainToken');
        $this->assertTrue($checked, 'The native bcrypt check still decides validity');
        $this->assertSame($before, $this->businessState(includeProof: true));
        Queue::assertNothingPushed();
    }

    public function test_fractional_expiry_survives_issuance_and_is_enforced_at_its_exact_instant(): void
    {
        $fixture = $this->fixture();
        $expires = now()->addMilliseconds(500);
        $response = $this->credential('store', $fixture, $expires->toISOString());
        $response->assertCreated()->assertJsonPath('token.expiresAt', IsoDate::format($expires));
        $issued = ApiToken::findOrFail($response->json('token.id'));
        $this->assertTrue($issued->expires_at->equalTo($expires));
        $this->withHeader('Authorization', 'Bearer '.$response->json('plainToken'));
        $this->getJson('/api/v1/public/links')->assertOk();
        $this->travelTo($expires);
        $this->getJson('/api/v1/public/links')->assertUnauthorized();
    }

    public function test_release_rejects_seconds_precision_even_with_a_completed_migration_ledger(): void
    {
        DB::beginTransaction();
        try {
            DB::statement('ALTER TABLE api_tokens ALTER COLUMN expires_at TYPE timestamp(0) with time zone');
            DB::table('migrations')->updateOrInsert(
                ['migration' => '2026_10_06_000001_preserve_api_token_expiry_precision'], ['batch' => 1],
            );
            $this->assertContains('Falta la precisión de caducidad de tokens API (2026_10_06).', ReleaseReadiness::errors());
        } finally {
            DB::rollBack();
        }
    }

    #[DataProvider('successfulCredentials')]
    public function test_valid_credentials_reuse_one_account_and_one_exact_session_lock(string $operation, bool $mfa): void
    {
        $fixture = $this->fixture($mfa);
        $locks = [];
        DB::listen(static function (QueryExecuted $event) use (&$locks): void {
            if (str_contains($event->sql, 'for update') && preg_match('/^select \* from "(users|sessions|workspaces|api_tokens)"/', $event->sql, $match)) {
                $locks[] = $match[1];
            }
        });
        $response = $this->credential($operation, $fixture);
        $response->assertStatus($operation === 'store' ? 201 : 200);
        $this->assertSame($operation === 'store' ? ['users', 'sessions', 'workspaces'] : ['users', 'sessions', 'workspaces', 'api_tokens'], $locks);
        $event = DB::table('audit_events')->where('action', 'api_token.'.($operation === 'store' ? 'create' : 'revoke'))->sole();
        $this->assertSame((int) $fixture['user']->id, $event->user_id);
        $this->assertSame((int) $fixture['workspace']->id, $event->workspace_id);
        $this->assertSame((string) ($operation === 'store' ? $response->json('token.id') : $fixture['apiToken']->id), $event->resource_id);
        $this->assertStringNotContainsString(self::PASSWORD, $event->metadata ?? '');
        $this->assertStringNotContainsString(self::RECOVERY, $event->metadata ?? '');
        if ($operation === 'store') {
            $this->assertDatabaseCount('notifications', 1);
            $this->assertDatabaseCount('mail_outbox', 1);
            $this->assertStringNotContainsString($response->json('plainToken'), $event->metadata ?? '');
            $this->assertSame($mfa ? 'recovery' : 'password_only', json_decode($event->metadata, true)['factor']);
        }
    }

    #[DataProvider('roleChanges')]
    public function test_credential_mutations_recheck_current_role_and_preserve_editor_authority(string $operation, string $role): void
    {
        $fixture = $this->fixture();
        $before = $this->businessState(includeProof: true);
        $intercepted = $this->atAccountLock(static function () use ($fixture, $role): void {
            DB::table('memberships')->where('workspace_id', $fixture['workspace']->id)->where('user_id', $fixture['user']->id)->update(['role' => $role]);
        });
        $response = $this->credential($operation, $fixture);
        $this->assertTrue($intercepted->fired);
        if ($role === 'viewer') {
            $response->assertForbidden();
            $this->assertSame($before, $this->businessState(includeProof: true));
            Queue::assertNothingPushed();
        } else {
            $response->assertStatus($operation === 'store' ? 201 : 200);
            $this->assertNotSame($before, $this->businessState(includeProof: true));
        }
    }

    public function test_expiry_migration_preserves_legacy_integer_and_unbounded_rows_and_indexes(): void
    {
        $fixture = $this->fixture();
        ApiToken::create([
            'workspace_id' => $fixture['workspace']->id, 'created_by' => $fixture['user']->id,
            'name' => 'Unbounded legacy', 'token_hash' => Ids::sha256Hex('legacy-unbounded'), 'scopes' => ['links:read'],
        ]);
        $before = DB::table('api_tokens')->orderBy('id')->get()->toArray();
        $migration = require database_path('migrations/2026_10_06_000001_preserve_api_token_expiry_precision.php');
        DB::beginTransaction();
        try {
            $migration->down();
            $this->assertSame('timestamp(0) with time zone', collect(Schema::getColumns('api_tokens'))->firstWhere('name', 'expires_at')['type']);
            $migration->up();
            $this->assertSame('timestamp(6) with time zone', collect(Schema::getColumns('api_tokens'))->firstWhere('name', 'expires_at')['type']);
            $this->assertEquals($before, DB::table('api_tokens')->orderBy('id')->get()->toArray());
            $this->assertTrue(Schema::hasIndex('api_tokens', 'workspace_usage_tokens_idx'));
            $this->assertTrue(Schema::hasIndex('api_tokens', 'api_tokens_token_hash_unique'));
        } finally {
            DB::rollBack();
        }
    }

    #[DataProvider('fractionalDowngrades')]
    public function test_precision_downgrade_refuses_to_round_active_or_historical_deadlines(string $kind): void
    {
        $fixture = $this->fixture();
        $expires = ($kind === 'active' ? now()->addDay() : now()->subDay())->addMicroseconds(123456);
        $fixture['apiToken']->update(['expires_at' => $expires]);
        $migration = require database_path('migrations/2026_10_06_000001_preserve_api_token_expiry_precision.php');
        try {
            $migration->down();
            $this->fail('A downgrade must refuse fractional deadlines');
        } catch (\RuntimeException $e) {
            $this->assertSame('Cannot reduce API token expiry precision while fractional deadlines exist', $e->getMessage());
        }
        $this->assertTrue($fixture['apiToken']->fresh()->expires_at->equalTo($expires));
        $this->assertSame('timestamp(6) with time zone', collect(Schema::getColumns('api_tokens'))->firstWhere('name', 'expires_at')['type']);
    }

    public function test_precise_schema_does_not_hide_an_unapplied_migration(): void
    {
        DB::beginTransaction();
        try {
            $this->assertSame(1, DB::table('migrations')->where('migration', '2026_10_06_000001_preserve_api_token_expiry_precision')->delete());
            $this->assertContains('Hay 1 migraciones pendientes para esta imagen.', ReleaseReadiness::errors());
            $this->artisan('uvh:release-check')->assertExitCode(1);
            $this->assertDatabaseMissing('migrations', ['migration' => '2026_10_06_000001_preserve_api_token_expiry_precision']);
        } finally {
            DB::rollBack();
        }
    }

    public function test_six_digit_offset_expiry_retains_its_native_instant(): void
    {
        $fixture = $this->fixture();
        $expires = now()->addDay()->addMicroseconds(123456);
        $response = $this->credential('store', $fixture, $expires->copy()->setTimezone('Europe/Madrid')->format('Y-m-d\TH:i:s.uP'));
        $response->assertCreated()->assertJsonPath('token.expiresAt', IsoDate::format($expires));
        $token = ApiToken::findOrFail($response->json('token.id'));
        $this->assertTrue($token->expires_at->equalTo($expires));
        $this->withHeader('Authorization', 'Bearer '.$response->json('plainToken'));
        $this->travelTo($expires->copy()->subMicrosecond());
        $this->getJson('/api/v1/public/links')->assertOk();
        $this->travelTo($expires);
        $this->getJson('/api/v1/public/links')->assertUnauthorized();
    }

    public function test_late_expiry_rolls_back_sql_proof_while_totp_remains_spent(): void
    {
        $fixture = $this->fixture();
        $fixture['user']->update(['mfa_secret' => UvhCrypto::encryptAtRest('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ')]);
        $counter = intdiv(time(), 30);
        $digest = hash_hmac('sha1', pack('N2', 0, $counter), '12345678901234567890', true);
        $offset = ord($digest[19]) & 0x0F;
        $binary = unpack('N', substr($digest, $offset, 4))[1] & 0x7FFFFFFF;
        $code = str_pad((string) ($binary % 1000000), 6, '0', STR_PAD_LEFT);
        $expires = now()->addSeconds(3)->toISOString();
        $before = $this->businessState(includeProof: true);
        $nativeHash = Hash::getFacadeRoot();
        $checks = 0;
        Hash::shouldReceive('check')->twice()->andReturnUsing(function (string $value, string $hash, array $options = []) use ($nativeHash, &$checks): bool {
            $valid = $nativeHash->check($value, $hash, $options);
            if (++$checks === 1) {
                $this->travelTo(now()->addSeconds(5));
            }

            return $valid;
        });
        $payload = ['name' => 'TOTP deadline', 'scopes' => ['links:read'], 'password' => self::PASSWORD, 'factorCode' => $code];
        $this->postJson('/api/v1/tokens', $payload + ['expiresAt' => $expires])->assertUnprocessable();
        $this->assertSame($before, $this->businessState(includeProof: true));
        $this->postJson('/api/v1/tokens', $payload)->assertForbidden()
            ->assertJsonPath('error', 'El código de autenticación o recuperación es incorrecto');
        $this->assertSame(2, $checks);
        $this->assertSame($before, $this->businessState(includeProof: true));
        Queue::assertNothingPushed();
    }

    private function atAccountLock(callable $change): object
    {
        $state = (object) ['fired' => false];
        DB::listen(static function (QueryExecuted $event) use ($state, $change): void {
            if (! $state->fired && str_starts_with($event->sql, 'select * from "users"') && str_contains($event->sql, 'for update')) {
                $state->fired = true;
                $change();
            }
        });

        return $state;
    }

    private function fixture(bool $mfa = true): array
    {
        $user = User::factory()->create([
            'email_verified_at' => now(), 'password_hash' => Hash::make(self::PASSWORD),
            'mfa_enabled' => $mfa, 'mfa_secret' => $mfa ? UvhCrypto::encryptAtRest('JBSWY3DPEHPK3PXP') : null,
            'recovery_codes' => $mfa ? [Ids::sha256Hex(self::RECOVERY)] : [],
        ]);
        $other = User::factory()->create(['email_verified_at' => now()]);
        $workspace = $user->ownedWorkspaces()->create(['name' => 'API authority', 'slug' => 'api-authority']);
        $workspace->memberships()->create(['user_id' => $user->id, 'role' => 'owner']);
        $workspace->quota()->create(['links_limit' => 100]);
        $active = Link::create([
            'workspace_id' => $workspace->id, 'created_by' => $user->id, 'alias' => 'api-active',
            'destination' => 'https://example.org', 'state' => 'active', 'version' => 1,
        ]);
        $trashed = Link::create([
            'workspace_id' => $workspace->id, 'created_by' => $user->id, 'alias' => 'api-trashed',
            'destination' => 'https://example.org', 'state' => 'deleted', 'state_before_delete' => 'active',
            'deleted_at' => now(), 'version' => 2,
        ]);
        $apiToken = ApiToken::create([
            'workspace_id' => $workspace->id, 'created_by' => $user->id, 'name' => 'API fixture',
            'token_hash' => Ids::sha256Hex(self::BEARER), 'expires_at' => now()->addDay(),
            'scopes' => ['links:read', 'links:write', 'analytics:read', 'domains:read', 'domains:write'],
        ]);
        $sessionToken = SessionManager::create($user->id, Request::create('/'), (int) $user->security_version, true);
        $otherSessionToken = SessionManager::create($user->id, Request::create('/'), (int) $user->security_version, true);
        $sessionId = Ids::sha256Hex($sessionToken);
        $otherSessionId = Ids::sha256Hex($otherSessionToken);
        $this->withCookie((string) config('uvh.session_cookie'), $sessionToken)->withHeader('X-Workspace-Id', (string) $workspace->id);

        return compact('user', 'other', 'workspace', 'active', 'trashed', 'apiToken', 'sessionId', 'otherSessionId');
    }

    private function credential(string $operation, array $fixture, ?string $expires = null): TestResponse
    {
        return $operation === 'destroy'
            ? $this->deleteJson('/api/v1/tokens/'.$fixture['apiToken']->id)
            : $this->postJson('/api/v1/tokens', [
                'name' => 'New API credential', 'scopes' => ['links:read'], 'expiresAt' => $expires,
                'password' => self::PASSWORD, 'factorCode' => $fixture['user']->mfa_enabled ? self::RECOVERY : '',
            ]);
    }

    private function writeLink(string $operation, array $fixture): TestResponse
    {
        $base = '/api/v1/public/links';

        return match ($operation) {
            'store' => $this->postJson($base, ['alias' => 'api-new', 'destination' => 'https://example.org/new']),
            'update' => $this->patchJson($base.'/'.$fixture['active']->id, ['version' => 1, 'destination' => 'https://example.org/new']),
            'state' => $this->postJson($base.'/'.$fixture['active']->id.'/state', ['state' => 'paused']),
            'destroy' => $this->deleteJson($base.'/'.$fixture['active']->id),
            'restore' => $this->postJson($base.'/'.$fixture['trashed']->id.'/restore'),
        };
    }

    private function businessState(bool $includeProof = false): array
    {
        $state = [];
        foreach (['api_tokens', 'links', 'audit_events', 'audit_outbox', 'notifications', 'mail_outbox', 'webhook_deliveries'] as $table) {
            $state[$table] = DB::table($table)->orderBy('id')->get()->map(static function ($row) use ($table): array {
                $value = (array) $row;
                if ($table === 'api_tokens') {
                    // The expiry hook and middleware's permitted usage timestamp
                    // are deliberately outside the business comparison.
                    unset($value['expires_at'], $value['last_used_at']);
                }

                return $value;
            })->all();
        }
        $state['recovery'] = DB::table('users')->orderBy('id')->pluck('recovery_codes')->all();
        if ($includeProof) {
            $state['proof'] = DB::table('sessions')->orderBy('id')->pluck('mfa_verified_at')->all();
        }

        return $state;
    }
}
