<?php

namespace Tests\Feature;

use App\Http\Controllers\AuthController;
use App\Jobs\DeliverMailOutboxJob;
use App\Models\User;
use App\Support\Audit;
use App\Support\Ids;
use App\Support\MailDeliveryEligibility;
use App\Support\SessionManager;
use App\Support\UvhCrypto;
use App\Support\UvhRequest;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Schema;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/**
 * Bulk session closure security notice: the template, its outbox admission and
 * the single commit it shares with the revocation it announces. Prepared
 * regression contracts: run only with the isolated *_test DB guard.
 */
final class SessionsRevocationNoticeTest extends TestCase
{
    private const PASSWORD = 'tiovivo-cobrizo-astilla-42';

    private bool $failNoticeInsert = false;

    private bool $failExactAudit = false;

    /** @var list<int> */
    private array $noticeTransactionLevels = [];

    protected function setUp(): void
    {
        // The parent's database-name guard runs BEFORE any fixture truncation.
        parent::setUp();
        DB::statement('TRUNCATE users, sessions, workspaces, email_tokens, mail_outbox, audit_events, audit_outbox, notifications, operational_metrics RESTART IDENTITY CASCADE');
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', 'sessions-notice-csrf')->withHeaders(['X-CSRF-Token' => 'sessions-notice-csrf']);
        Queue::fake();

        DB::listen(function (QueryExecuted $event): void {
            if ($this->failExactAudit && str_starts_with(strtolower($event->sql), 'insert') && str_contains($event->sql, '"audit_outbox"')) {
                foreach ($event->bindings as $binding) {
                    $row = is_string($binding) ? json_decode($binding, true) : null;
                    if (is_array($row) && in_array($row['action'] ?? null, ['auth.session_revoke', 'auth.sessions_revoked_others', 'auth.sessions_revoked_all'], true)) {
                        throw new \RuntimeException('Fixture: exact session audit admission interrupted');
                    }
                }
            }
            if (! str_starts_with(strtolower($event->sql), 'insert')
                || ! str_contains($event->sql, '"mail_outbox"')) {
                return;
            }
            $this->noticeTransactionLevels[] = $event->connection->transactionLevel();
            if ($this->failNoticeInsert) {
                // Fail AFTER the real INSERT, not before it. The envelope and
                // the revocation it announces must roll back together.
                throw new \RuntimeException('Fixture: notice admission interrupted');
            }
        });
    }

    public function test_individual_revocation_admits_one_notice_and_is_idempotent(): void
    {
        [$user, $current, $other] = $this->account();
        $path = '/api/v1/auth/sessions/'.Ids::sha256Hex($other).'/revoke';
        $this->withCookie('uvh_session', $current)->postJson($path)->assertOk();
        $this->withCookie('uvh_session', $current)->postJson($path)->assertOk();
        $this->assertNotNull(DB::table('sessions')->where('id', Ids::sha256Hex($other))->value('revoked_at'));
        $this->assertSame(1, DB::table('mail_outbox')->count());
        $this->assertSame(1, DB::table('notifications')->where('user_id', $user->id)->where('kind', 'session_revoked')->count());
        $this->assertSame([1], $this->noticeTransactionLevels);
    }

    public function test_individual_revocation_rolls_back_when_notice_admission_fails(): void
    {
        [$user, $current, $other] = $this->account();
        $this->failNoticeInsert = true;
        $this->withCookie('uvh_session', $current)->postJson('/api/v1/auth/sessions/'.Ids::sha256Hex($other).'/revoke')->assertStatus(503);
        $this->assertNull(DB::table('sessions')->where('id', Ids::sha256Hex($other))->value('revoked_at'));
        $this->assertDatabaseCount('mail_outbox', 0);
        $this->assertDatabaseCount('notifications', 0);
    }

    public function test_closing_other_sessions_admits_one_incident_notice_with_the_template_and_bearer(): void
    {
        [$user, $current, $other] = $this->account();

        $this->withCookie('uvh_session', $current)
            ->postJson('/api/v1/auth/sessions/revoke-others', [])->assertExactJson(['ok' => true, 'revoked' => 1]);

        $this->assertDatabaseHas('sessions', ['id' => Ids::sha256Hex($current), 'revoked_at' => null]);
        $this->assertNotNull(DB::table('sessions')->where('id', Ids::sha256Hex($other))->value('revoked_at'));
        $this->assertNotice(
            'sessions_revoked_others',
            'Sesiones cerradas en UVH',
            'Se han cerrado las demás sesiones abiertas de tu cuenta',
            $user,
        );
        $this->assertDatabaseHas('notifications', ['user_id' => $user->id, 'kind' => 'sessions_revoked_others']);
        $this->assertSame([1], $this->noticeTransactionLevels, 'the notice is admitted inside the revocation transaction');
        Queue::assertPushed(DeliverMailOutboxJob::class, 1);
    }

    public function test_closing_every_session_announces_the_total_closure(): void
    {
        [$user, $current, $other] = $this->account();

        $this->withCookie('uvh_session', $current)
            ->postJson('/api/v1/auth/sessions/revoke-all', [])->assertExactJson(['ok' => true, 'revoked' => 2]);

        foreach ([$current, $other] as $session) {
            $this->assertNotNull(DB::table('sessions')->where('id', Ids::sha256Hex($session))->value('revoked_at'));
        }
        $this->assertNotice(
            'sessions_revoked_all',
            'Todas las sesiones cerradas en UVH',
            'Se han cerrado todas las sesiones de tu cuenta UVH',
            $user,
        );
        $this->assertDatabaseHas('notifications', ['user_id' => $user->id, 'kind' => 'sessions_revoked_all']);
        Queue::assertPushed(DeliverMailOutboxJob::class, 1);
    }

    public function test_a_repetition_with_nothing_left_to_close_sends_no_second_notice(): void
    {
        [$user, $current, $other] = $this->account();

        $this->withCookie('uvh_session', $current)
            ->postJson('/api/v1/auth/sessions/revoke-others', [])->assertExactJson(['ok' => true, 'revoked' => 1]);
        $this->withCookie('uvh_session', $current)
            ->postJson('/api/v1/auth/sessions/revoke-others', [])->assertExactJson(['ok' => true, 'revoked' => 0]);

        $this->assertSame([1], $this->noticeTransactionLevels);
        $this->assertDatabaseCount('mail_outbox', 1);
        $this->assertDatabaseCount('notifications', 1);
        Queue::assertPushed(DeliverMailOutboxJob::class, 1);
    }

    public function test_failed_admission_rolls_back_the_closure_and_allows_a_safe_retry(): void
    {
        [$user, $current, $other] = $this->account();

        $this->failNoticeInsert = true;
        $this->withCookie('uvh_session', $current)
            ->postJson('/api/v1/auth/sessions/revoke-others', [])->assertStatus(503)->assertExactJson([
                'error' => 'No se pudo guardar el aviso de seguridad. No se cerró ninguna sesión. Inténtalo de nuevo más tarde',
            ]);

        // Nothing was closed without its warning: both sessions survive and no
        // envelope, bearer or inbox row is left behind by the rolled-back try.
        foreach ([$current, $other] as $session) {
            $this->assertDatabaseHas('sessions', ['id' => Ids::sha256Hex($session), 'revoked_at' => null]);
        }
        $this->assertDatabaseCount('mail_outbox', 0);
        $this->assertDatabaseCount('email_tokens', 0);
        $this->assertDatabaseCount('notifications', 0);
        Queue::assertNothingPushed();
        $this->assertDatabaseHas('audit_events', [
            'user_id' => $user->id, 'action' => 'auth.email_delivery_failed',
        ]);

        // The same closure retries safely once admission works again.
        $this->failNoticeInsert = false;
        $this->withCookie('uvh_session', $current)
            ->postJson('/api/v1/auth/sessions/revoke-others', [])->assertExactJson(['ok' => true, 'revoked' => 1]);
        $this->assertNotNull(DB::table('sessions')->where('id', Ids::sha256Hex($other))->value('revoked_at'));
        $this->assertNotice(
            'sessions_revoked_others',
            'Sesiones cerradas en UVH',
            'Se han cerrado las demás sesiones abiertas de tu cuenta',
            $user,
        );
        Queue::assertPushed(DeliverMailOutboxJob::class, 1);
    }

    public static function staleActors(): array
    {
        $cases = [];
        foreach (['individual', 'others', 'all'] as $surface) {
            foreach (['revoked', 'expired', 'version'] as $reason) {
                $cases[$surface.' '.$reason] = [$surface, $reason];
            }
        }

        return $cases;
    }

    #[DataProvider('staleActors')]
    public function test_pre_authorized_requests_cannot_revoke_sessions_after_the_actor_changes(string $surface, string $reason): void
    {
        [$user, $current, $other] = $this->account();
        $request = Request::create('/');
        $request->attributes->set(UvhRequest::USER, $user);
        $request->attributes->set(UvhRequest::SESSION_ID, Ids::sha256Hex($current));
        match ($reason) {
            'revoked' => DB::table('sessions')->where('id', Ids::sha256Hex($current))->update(['revoked_at' => now()]),
            'expired' => DB::table('sessions')->where('id', Ids::sha256Hex($current))->update(['expires_at' => now()->subSecond()]),
            'version' => DB::table('users')->where('id', $user->id)->update(['security_version' => 2]),
        };
        // Simulate the interleaving AFTER middleware authorized its snapshot.
        $controller = app(AuthController::class);
        $response = match ($surface) {
            'individual' => $controller->revokeSession($request, Ids::sha256Hex($other)),
            'others' => $controller->revokeOtherSessions($request),
            'all' => $controller->revokeAllSessions($request),
        };
        $this->assertSame($surface === 'individual' ? 404 : 409, $response->getStatusCode());
        $this->assertDatabaseHas('sessions', ['id' => Ids::sha256Hex($other), 'revoked_at' => null]);
        $this->assertDatabaseCount('mail_outbox', 0);
        $this->assertDatabaseCount('notifications', 0);
        $this->assertDatabaseCount('audit_outbox', 0);
        Queue::assertNothingPushed();
    }

    public static function bulkAuditCases(): array
    {
        return [['others', true], ['all', true], ['others', false], ['all', false]];
    }

    #[DataProvider('bulkAuditCases')]
    public function test_bulk_revocation_admits_its_exact_audit_in_the_commit(string $surface, bool $admissionFails): void
    {
        [$user, $current, $other] = $this->account();
        $this->failExactAudit = $admissionFails;
        if (! $admissionFails) {
            Schema::rename('audit_events', 'audit_events_unavailable');
        }
        try {
            $response = $this->postJson('/api/v1/auth/sessions/revoke-'.$surface);
            if ($admissionFails) {
                $response->assertServerError();
                foreach ([$current, $other] as $token) {
                    $this->assertDatabaseHas('sessions', ['id' => Ids::sha256Hex($token), 'revoked_at' => null]);
                }
                $this->assertDatabaseCount('mail_outbox', 0);
                $this->assertDatabaseCount('notifications', 0);
                Queue::assertNothingPushed();
            } else {
                $response->assertOk();
                $rows = DB::table('audit_outbox')->get()->map(static fn ($row) => json_decode($row->event, true, flags: JSON_THROW_ON_ERROR));
                $event = $rows->where('action', 'auth.sessions_revoked_'.$surface)->values();
                $this->assertCount(1, $event);
                $this->assertSame($user->id, $event[0]['user_id']);
                $metadata = json_decode($event[0]['metadata'], true, flags: JSON_THROW_ON_ERROR);
                $this->assertSame($surface === 'all' ? 2 : 1, $metadata['revoked']);
            }
        } finally {
            $this->failExactAudit = false;
            if (! $admissionFails) {
                Schema::rename('audit_events_unavailable', 'audit_events');
            }
        }
        if (! $admissionFails) {
            $this->assertTrue(Audit::drain());
            $this->assertTrue(Audit::drain());
            $this->assertSame(1, DB::table('audit_events')->where('action', 'auth.sessions_revoked_'.$surface)->count());
            $this->assertDatabaseCount('audit_outbox', 0);
        }
    }

    public static function outerClosures(): array
    {
        $cases = [];
        foreach (['individual', 'current', 'others', 'all'] as $surface) {
            foreach ([false, true] as $commit) {
                $cases[$surface.' '.($commit ? 'commit' : 'rollback')] = [$surface, $commit];
            }
        }

        return $cases;
    }

    #[DataProvider('outerClosures')]
    public function test_outer_commit_owns_revocation_notice_bearer_and_exact_event(string $surface, bool $commit): void
    {
        $this->freezeSecond();
        [$user, $current, $other] = $this->account();
        $foreign = User::factory()->create();
        $foreignToken = SessionManager::create($foreign->id, Request::create('/'), 1, true);
        $foreignId = Ids::sha256Hex($foreignToken);
        $currentId = Ids::sha256Hex($current);
        $otherId = Ids::sha256Hex($other);
        $targetId = $surface === 'current' ? $currentId : $otherId;
        $individual = in_array($surface, ['individual', 'current'], true);
        $path = $individual ? '/api/v1/auth/sessions/'.$targetId.'/revoke' : '/api/v1/auth/sessions/revoke-'.$surface;
        $action = $individual ? 'auth.session_revoke' : 'auth.sessions_revoked_'.$surface;
        $clearsCookie = in_array($surface, ['current', 'all'], true);
        $before = $user->refresh()->getRawOriginal();
        $sessionsBefore = DB::table('sessions')->orderBy('id')->get()->toJson();
        $call = fn () => $this->postJson($path);

        DB::beginTransaction();
        try {
            $response = $call()->assertOk();
            $response->assertExactJson($individual
                ? ['ok' => true, 'current' => $surface === 'current']
                : ['ok' => true, 'revoked' => $surface === 'all' ? 2 : 1]);
            if ($clearsCookie) {
                $response->assertCookieExpired('uvh_session');
            } else {
                $response->assertCookieMissing('uvh_session');
            }
            $this->assertSame($before, $user->refresh()->getRawOriginal());
            $this->assertDatabaseCount('mail_outbox', 1);
            $this->assertDatabaseCount('email_tokens', 1);
            $this->assertDatabaseCount('notifications', 1);
            $this->assertDatabaseCount('audit_outbox', 2);
            $this->assertDatabaseCount('audit_events', 0);
            $this->assertSame([2], $this->noticeTransactionLevels);
            Queue::assertNothingPushed();
            $notice = DB::table('mail_outbox')->sole();
            $this->assertSame('pending', $notice->status);
            $this->assertTrue(MailDeliveryEligibility::isCurrent($notice));
            $this->assertSame($notice->resource_id, DB::table('email_tokens')->sole()->id);
            $events = DB::table('audit_outbox')->get()->map(static fn ($row) => json_decode($row->event, true, flags: JSON_THROW_ON_ERROR));
            $exact = $events->where('action', $action)->sole();
            $this->assertSame($user->id, $exact['user_id']);
            $this->assertSame($individual ? 'session' : 'user', $exact['resource_type']);
            $this->assertSame($individual ? $targetId : (string) $user->id, $exact['resource_id']);
            if (! $individual) {
                $this->assertSame($surface === 'all' ? 2 : 1, json_decode($exact['metadata'], true, flags: JSON_THROW_ON_ERROR)['revoked']);
            }
            foreach ([self::PASSWORD, $current, $other, $foreignToken] as $secret) {
                $this->assertStringNotContainsString($secret, json_encode($exact, JSON_THROW_ON_ERROR));
            }
            $this->assertNull(DB::table('sessions')->where('id', $foreignId)->value('revoked_at'));
            $this->assertSame($surface === 'all' ? 2 : 1, DB::table('sessions')->where('user_id', $user->id)->whereNotNull('revoked_at')->count());
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
            $this->assertSame($sessionsBefore, DB::table('sessions')->orderBy('id')->get()->toJson());
            foreach (['mail_outbox', 'email_tokens', 'notifications', 'audit_outbox', 'audit_events'] as $table) {
                $this->assertDatabaseCount($table, 0);
            }
            Queue::assertNothingPushed();
            $call()->assertOk();
        }
        $this->assertSame($before, $user->refresh()->getRawOriginal());
        $this->assertNull(DB::table('sessions')->where('id', $foreignId)->value('revoked_at'));
        $this->assertSame($surface === 'all' ? 2 : 1, DB::table('sessions')->where('user_id', $user->id)->whereNotNull('revoked_at')->count());
        $this->assertDatabaseCount('mail_outbox', 1);
        $this->assertDatabaseCount('email_tokens', 1);
        $this->assertDatabaseCount('notifications', 1);
        $this->assertDatabaseCount('audit_outbox', 0);
        $this->assertSame(1, DB::table('audit_events')->where('action', $action)->count());
        $this->assertSame(1, DB::table('audit_events')->where('action', 'auth.security_notice_admitted')->count());
        Queue::assertPushed(DeliverMailOutboxJob::class, 1);
    }

    public static function individualAudits(): array
    {
        return [[false, false], [false, true], [true, false], [true, true]];
    }

    #[DataProvider('individualAudits')]
    public function test_individual_revocation_preserves_exact_audit_admission_and_history_recovery(bool $currentTarget, bool $admissionFails): void
    {
        [$user, $current, $other] = $this->account();
        $id = Ids::sha256Hex($currentTarget ? $current : $other);
        $this->failExactAudit = $admissionFails;
        if (! $admissionFails) {
            Schema::rename('audit_events', 'audit_events_session_revocation');
        }
        try {
            $response = $this->postJson('/api/v1/auth/sessions/'.$id.'/revoke');
            if ($admissionFails) {
                $response->assertServerError()->assertCookieMissing('uvh_session');
                $this->assertSame(2, DB::table('sessions')->whereNull('revoked_at')->count());
                foreach (['mail_outbox', 'email_tokens', 'notifications', 'audit_outbox'] as $table) {
                    $this->assertDatabaseCount($table, 0);
                }
                Queue::assertNothingPushed();
            } else {
                $response->assertOk()->assertExactJson(['ok' => true, 'current' => $currentTarget]);
                $events = DB::table('audit_outbox')->get()->map(static fn ($row) => json_decode($row->event, true, flags: JSON_THROW_ON_ERROR));
                $exact = $events->where('action', 'auth.session_revoke')->sole();
                $this->assertSame($user->id, $exact['user_id']);
                $this->assertSame($id, $exact['resource_id']);
                $this->assertSame('session', $exact['resource_type']);
                $this->assertNotNull(DB::table('sessions')->where('id', $id)->value('revoked_at'));
            }
        } finally {
            $this->failExactAudit = false;
            if (! $admissionFails) {
                Schema::rename('audit_events_session_revocation', 'audit_events');
            }
        }
        if (! $admissionFails) {
            $this->assertTrue(Audit::drain());
            $this->assertTrue(Audit::drain());
            $this->assertDatabaseCount('audit_outbox', 0);
            $this->assertSame(1, DB::table('audit_events')->where('action', 'auth.session_revoke')->count());
        }
    }

    public static function unverifiedClosures(): array
    {
        return [['individual'], ['others'], ['all']];
    }

    #[DataProvider('unverifiedClosures')]
    public function test_pre_authorized_closure_preserves_its_live_email_and_step_up_policy(string $surface): void
    {
        [$user, $current, $other] = $this->account();
        $request = Request::create('/');
        $request->attributes->set(UvhRequest::USER, $user);
        $request->attributes->set(UvhRequest::SESSION_ID, Ids::sha256Hex($current));
        // A NEW request from an unverified account is rejected by hydrate.
        // This already-authorized snapshot characterizes only the mutation's
        // existing requireVerifiedEmail=false policy after an interleaving.
        DB::table('users')->where('id', $user->id)->update(['email_verified_at' => null]);
        $controller = app(AuthController::class);
        $response = match ($surface) {
            'individual' => $controller->revokeSession($request, Ids::sha256Hex($other)),
            'others' => $controller->revokeOtherSessions($request),
            'all' => $controller->revokeAllSessions($request),
        };
        $this->assertSame(200, $response->getStatusCode());
        $this->assertSame($surface === 'all' ? 2 : 1, DB::table('sessions')->whereNotNull('revoked_at')->count());
        $this->assertFalse($user->refresh()->mfa_enabled);
        $this->assertSame(1, $user->security_version);
        $this->assertNull($user->email_verified_at);
    }

    /** @return array{User, string, string} */
    private function account(): array
    {
        $user = User::factory()->create([
            'name' => 'Notice Person', 'email' => 'notice-person@example.test',
            'password_hash' => Hash::make(self::PASSWORD),
        ]);
        $current = SessionManager::create($user->id, Request::create('/'), 1, true);
        $other = SessionManager::create($user->id, Request::create('/'), 1, true);
        $this->withCookie('uvh_session', $current);

        return [$user, $current, $other];
    }

    /**
     * Exactly one live notice, announced by the template and backed by the
     * incident bearer it names: the token row must exist, be unused and still
     * pass the delivery eligibility gate.
     */
    private function assertNotice(string $kind, string $subject, string $textNeedle, User $user): void
    {
        $this->assertDatabaseCount('mail_outbox', 1);
        $notice = DB::table('mail_outbox')->where('kind', $kind)->first();
        $this->assertNotNull($notice);
        $this->assertTrue(MailDeliveryEligibility::isCurrent($notice));
        $this->assertDatabaseHas('email_tokens', [
            'id' => $notice->resource_id, 'user_id' => $user->id, 'kind' => 'security_revoke', 'used_at' => null,
        ]);
        $envelope = json_decode(UvhCrypto::decryptAtRest($notice->encrypted_envelope), true, 512, JSON_THROW_ON_ERROR);
        $this->assertSame($user->email, $envelope['to']);
        $this->assertSame($subject, $envelope['subject']);
        $this->assertStringContainsString($textNeedle, $envelope['text']);
        $this->assertStringContainsString('/auth/security-incident#token=', $envelope['text']);
        $this->assertStringContainsString('Cerrar accesos de emergencia', $envelope['html']);
    }
}
