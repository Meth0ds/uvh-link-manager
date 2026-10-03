<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\Audit;
use App\Support\Ids;
use App\Support\NotificationInbox;
use App\Support\NotificationKinds;
use App\Support\NotificationPreferences;
use App\Support\SessionManager;
use App\Support\UvhCrypto;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Schema;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/** Actual HTTP boundaries after middleware hydration, exclusively on guarded *_test. */
final class NotificationAuthorityAdmissionTest extends TestCase
{
    private bool $interruptAudit = false;

    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, notifications, notification_preferences, audit_events, audit_outbox, mail_outbox, operational_metrics RESTART IDENTITY CASCADE');
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', 'notification-authority-csrf')->withHeader('X-CSRF-Token', 'notification-authority-csrf');
        $this->freezeSecond();
        Queue::fake();
        DB::listen(function (QueryExecuted $query): void {
            if (! $this->interruptAudit || ! str_starts_with(strtolower($query->sql), 'insert into "audit_outbox"')) {
                return;
            }
            foreach ($query->bindings as $binding) {
                $event = is_string($binding) ? json_decode($binding, true) : null;
                if (is_array($event) && ($event['action'] ?? null) === 'account.notification_preferences_updated') {
                    throw new \RuntimeException('Fixture: notification exact audit interrupted after insert');
                }
            }
        });
    }

    public static function staleContexts(): array
    {
        $cases = [];
        foreach (['index', 'unread', 'preferences', 'read', 'read-all', 'update-preferences'] as $surface) {
            foreach (['revoked', 'expired', 'session-version', 'foreign-owner', 'blocked', 'unverified', 'account-version'] as $state) {
                $cases[$surface.' '.$state] = [$surface, $state];
            }
        }

        return $cases;
    }

    #[DataProvider('staleContexts')]
    public function test_account_and_exact_session_are_revalidated_after_hydration(string $surface, string $state): void
    {
        [$user, $sessionId, $foreign, $notificationId] = $this->fixture();
        $before = $this->snapshot();
        $injected = false;
        DB::listen(static function (QueryExecuted $query) use ($user, $sessionId, $foreign, $state, &$injected): void {
            if ($injected || ! str_starts_with(strtolower($query->sql), 'select * from "users"') || str_contains(strtolower($query->sql), 'for update')) {
                return;
            }
            // Eager owner SELECT has fetched the old row; middleware receives
            // the authorized snapshot while the business lookup sees this change.
            $injected = true;
            match ($state) {
                'revoked' => DB::table('sessions')->where('id', $sessionId)->update(['revoked_at' => now()]),
                'expired' => DB::table('sessions')->where('id', $sessionId)->update(['expires_at' => now()]),
                'session-version' => DB::table('sessions')->where('id', $sessionId)->update(['security_version' => 2]),
                'foreign-owner' => DB::table('sessions')->where('id', $sessionId)->update(['user_id' => $foreign->id]),
                'blocked' => DB::table('users')->where('id', $user->id)->update(['deleted_at' => now()]),
                'unverified' => DB::table('users')->where('id', $user->id)->update(['email_verified_at' => null]),
                'account-version' => DB::table('users')->where('id', $user->id)->update(['security_version' => 2]),
            };
        });
        $response = match ($surface) {
            'index' => $this->getJson('/api/v1/notifications'),
            'unread' => $this->getJson('/api/v1/notifications/unread'),
            'preferences' => $this->getJson('/api/v1/notifications/preferences'),
            'read' => $this->postJson('/api/v1/notifications/'.$notificationId.'/read'),
            'read-all' => $this->postJson('/api/v1/notifications/read-all'),
            'update-preferences' => $this->changePreferences(),
        };
        $this->assertTrue($injected, 'the post-hydration interleaving must execute');
        $isRead = in_array($surface, ['index', 'unread', 'preferences'], true);
        $this->assertSame($isRead ? 401 : 409, $response->status(), json_encode([
            'surface' => $surface,
            'state' => $state,
            'payload' => $response->json(),
            'changed' => $before !== $this->snapshot(),
        ], JSON_THROW_ON_ERROR));
        $response->assertExactJson(['error' => $isRead ? 'No autenticado' : 'La sesión cambió. Vuelve a iniciar sesión']);
        $response->assertCookieMissing('uvh_session');
        $this->assertSame($before, $this->snapshot());
        Queue::assertNothingPushed();
    }

    public static function auditFailures(): array
    {
        return [['interrupted'], ['absent']];
    }

    #[DataProvider('auditFailures')]
    public function test_preference_changes_and_digest_retirement_require_exact_audit_admission(string $mode): void
    {
        $this->fixture();
        $before = $this->snapshot();
        $this->interruptAudit = $mode === 'interrupted';
        if ($mode === 'absent') {
            Schema::rename('audit_outbox', 'audit_outbox_notification_absent');
        }
        try {
            $response = $this->changePreferences();
        } finally {
            $this->interruptAudit = false;
            if ($mode === 'absent') {
                Schema::rename('audit_outbox_notification_absent', 'audit_outbox');
            }
        }
        $this->assertSame($before, $this->snapshot(), 'Audit admission failure must roll back preferences and pending digest retirement; HTTP '.$response->status());
        $response->assertServerError();
        $this->changePreferences()->assertOk();
        $this->assertSame(1, DB::table('audit_events')->where('action', 'account.notification_preferences_updated')->count());
    }

    public function test_history_outage_keeps_exact_event_recoverable_without_reverting_preferences(): void
    {
        [$user] = $this->fixture();
        Schema::rename('audit_events', 'audit_events_notification_history');
        try {
            $this->changePreferences()->assertOk();
            $this->assertDatabaseCount('audit_outbox', 1);
            $event = json_decode(DB::table('audit_outbox')->sole()->event, true, flags: JSON_THROW_ON_ERROR);
            $this->assertSame('account.notification_preferences_updated', $event['action']);
            $this->assertSame($user->id, $event['user_id']);
            $this->assertSame((string) $user->id, $event['resource_id']);
            $this->assertSame([NotificationKinds::API_TOKEN_CREATED], json_decode($event['metadata'], true, flags: JSON_THROW_ON_ERROR)['kinds']);
            $this->assertSame(UvhCrypto::hashIp('192.0.2.18'), $event['ip_hash']);
            $this->assertStringNotContainsString('192.0.2.18', json_encode($event, JSON_THROW_ON_ERROR));
        } finally {
            Schema::rename('audit_events_notification_history', 'audit_events');
        }
        $this->assertTrue(Audit::drain());
        $this->assertTrue(Audit::drain());
        $this->assertDatabaseCount('audit_outbox', 0);
        $this->assertSame(1, DB::table('audit_events')->where('action', 'account.notification_preferences_updated')->count());
    }

    #[DataProvider('auditFailures')]
    public function test_bare_preference_updates_roll_back_when_exact_admission_fails(string $mode): void
    {
        [$user] = $this->fixture();
        $before = $this->snapshot();
        $this->interruptAudit = $mode === 'interrupted';
        if ($mode === 'absent') {
            Schema::rename('audit_outbox', 'audit_outbox_notification_absent');
        }
        $failure = null;
        try {
            NotificationPreferences::update($user->id, [NotificationKinds::API_TOKEN_CREATED => 'in_app_only'], '192.0.2.18');
        } catch (\Throwable $error) {
            $failure = $error;
        } finally {
            $this->interruptAudit = false;
            if ($mode === 'absent') {
                Schema::rename('audit_outbox_notification_absent', 'audit_outbox');
            }
        }
        $this->assertNotNull($failure, 'Internal caller without an outer transaction must reject missing audit; state changed: '.($before !== $this->snapshot() ? 'yes' : 'no'));
        $this->assertSame($before, $this->snapshot());
        NotificationPreferences::update($user->id, [NotificationKinds::API_TOKEN_CREATED => 'in_app_only'], '192.0.2.18');
        $this->assertSame(1, DB::table('audit_events')->where('action', 'account.notification_preferences_updated')->count());
    }

    public function test_bare_preference_update_keeps_success_and_recoverable_event_when_history_is_down(): void
    {
        [$user] = $this->fixture();
        Schema::rename('audit_events', 'audit_events_notification_history');
        try {
            NotificationPreferences::update($user->id, [NotificationKinds::API_TOKEN_CREATED => 'in_app_only'], '192.0.2.18');
            $this->assertDatabaseCount('audit_outbox', 1);
            $this->assertSame('in_app_only', NotificationPreferences::deliveryFor($user->id, NotificationKinds::API_TOKEN_CREATED));
            $this->assertSame(0, DB::table('notifications')->where('user_id', $user->id)->whereNull('digested_at')->count());
        } finally {
            Schema::rename('audit_events_notification_history', 'audit_events');
        }
        $this->assertTrue(Audit::drain());
        $this->assertTrue(Audit::drain());
        $this->assertDatabaseCount('audit_outbox', 0);
        $this->assertSame(1, DB::table('audit_events')->where('action', 'account.notification_preferences_updated')->count());
    }

    public static function outerCommits(): array
    {
        return [[false], [true]];
    }

    #[DataProvider('outerCommits')]
    public function test_outer_commit_owns_preferences_digest_retirement_and_event(bool $commit): void
    {
        [$user] = $this->fixture();
        $before = $this->snapshot();
        DB::beginTransaction();
        try {
            $this->changePreferences()->assertOk();
            $this->assertDatabaseCount('audit_outbox', 1);
            $this->assertDatabaseCount('audit_events', 0);
            $this->assertSame(0, DB::table('notifications')->where('user_id', $user->id)->whereNull('digested_at')->count());
            Queue::assertNothingPushed();
            if ($commit) {
                DB::commit();
            } else {
                DB::rollBack();
            }
        } finally {
            while (DB::transactionLevel() > 0) {
                DB::rollBack();
            }
        }
        if (! $commit) {
            $this->assertSame($before, $this->snapshot());
            $this->changePreferences()->assertOk();
        }
        $this->assertDatabaseCount('audit_outbox', 0);
        $this->assertSame(1, DB::table('audit_events')->where('action', 'account.notification_preferences_updated')->count());
        $this->assertDatabaseCount('mail_outbox', 0);
        Queue::assertNothingPushed();
    }

    public static function duplicatePreferences(): array
    {
        return [['invalid-first'], ['valid-duplicate']];
    }

    #[DataProvider('duplicatePreferences')]
    public function test_duplicate_kinds_cannot_replace_an_invalid_row_or_silently_choose_a_delivery(string $shape): void
    {
        $this->fixture();
        $before = $this->snapshot();
        $response = $this->patchJson('/api/v1/notifications/preferences', ['preferences' => [
            ['kind' => NotificationKinds::API_TOKEN_CREATED, 'delivery' => $shape === 'invalid-first' ? 'not-a-delivery' : 'disabled'],
            ['kind' => NotificationKinds::API_TOKEN_CREATED, 'delivery' => 'in_app_only'],
        ]]);
        $this->assertSame($before, $this->snapshot(), 'Duplicated input must be rejected atomically; HTTP '.$response->status());
        $response->assertStatus(422)->assertExactJson(['error' => 'Datos inválidos']);
    }

    public static function preferenceViews(): array
    {
        return [['get'], ['patch']];
    }

    #[DataProvider('preferenceViews')]
    public function test_preference_view_loads_operational_deliveries_in_one_scoped_query(string $method): void
    {
        [$user] = $this->fixture();
        $queries = [];
        $observing = true;
        DB::listen(static function (QueryExecuted $query) use (&$queries, &$observing): void {
            if ($observing && str_starts_with(strtolower($query->sql), 'select "delivery"')
                && str_contains($query->sql, 'from "notification_preferences"')) {
                $queries[] = ['sql' => $query->sql, 'bindings' => $query->bindings];
            }
        });
        $response = $method === 'get' ? $this->getJson('/api/v1/notifications/preferences') : $this->changePreferences();
        $observing = false;
        $response->assertOk();
        $view = collect($response->json('preferences'))->keyBy('kind');
        $this->assertCount(count(NotificationKinds::all()), $view);
        $this->assertSame($method === 'get' ? 'daily_digest' : 'in_app_only', $view[NotificationKinds::API_TOKEN_CREATED]['delivery']);
        $this->assertSame('immediate', $view[NotificationKinds::PASSWORD_CHANGED]['delivery']);
        $this->assertCount(1, $queries, 'Operational delivery lookups during '.$method.': '.count($queries));
        $this->assertStringContainsString('"user_id" = ?', $queries[0]['sql']);
        $this->assertSame([$user->id], $queries[0]['bindings']);
    }

    /** @return array{User, string, User, int} */
    private function fixture(): array
    {
        $user = User::factory()->create();
        $foreign = User::factory()->create();
        foreach ([$user, $foreign] as $account) {
            DB::table('notification_preferences')->insert([
                'user_id' => $account->id,
                'kind' => NotificationKinds::API_TOKEN_CREATED,
                'delivery' => 'daily_digest',
                'updated_at' => now(),
            ]);
            NotificationInbox::record($account->id, NotificationKinds::API_TOKEN_CREATED, null, 'Private fixture notice');
        }
        $token = SessionManager::create($user->id, Request::create('/'), 1);
        $this->withCookie('uvh_session', $token)->withServerVariables(['REMOTE_ADDR' => '192.0.2.18']);

        return [$user, Ids::sha256Hex($token), $foreign, (int) DB::table('notifications')->where('user_id', $user->id)->value('id')];
    }

    /** @return array<string, string> */
    private function snapshot(): array
    {
        $state = [];
        foreach (['notifications', 'notification_preferences', 'audit_events', 'audit_outbox', 'mail_outbox'] as $table) {
            $query = DB::table($table);
            $query = $table === 'notification_preferences' ? $query->orderBy('user_id')->orderBy('kind') : $query->orderBy('id');
            $state[$table] = $query->get()->toJson();
        }

        return $state;
    }

    private function changePreferences(): TestResponse
    {
        return $this->patchJson('/api/v1/notifications/preferences', ['preferences' => [
            ['kind' => NotificationKinds::API_TOKEN_CREATED, 'delivery' => 'in_app_only'],
        ]]);
    }
}
