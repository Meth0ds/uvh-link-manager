<?php

namespace Tests\Feature;

use App\Http\Controllers\AccountCredentialsController;
use App\Http\Controllers\MfaConfigurationController;
use App\Jobs\DeliverMailOutboxJob;
use App\Models\AccountRecoveryRequest;
use App\Models\EmailChangeRequest;
use App\Models\EmailToken;
use App\Models\User;
use App\Support\Audit;
use App\Support\Ids;
use App\Support\MailDeliveryEligibility;
use App\Support\SessionManager;
use App\Support\Totp;
use App\Support\UvhCrypto;
use App\Support\UvhRequest;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Schema;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/** MFA/email notification contracts, prepared for an isolated *_test database. */
final class SecurityNoticeAtomicityTest extends TestCase
{
    private const PASSWORD = 'tiovivo-cobrizo-astilla-42';

    private const RECOVERY_CODE = 'ABCD2345EFGH6789';

    // RFC 6238 fixture: Base32 encoding of the ASCII key used by pendingCode().
    private const PENDING_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

    private int $failAtInsert = 0;

    private array $insertLevels = [];

    protected function setUp(): void
    {
        parent::setUp(); // Refuses non-*_test databases before fixture writes.
        DB::statement('TRUNCATE users, sessions, workspaces, email_tokens, mail_outbox, audit_events, audit_outbox, operational_metrics RESTART IDENTITY CASCADE');
        config(['cache.default' => 'array']);
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', 'security-notice-csrf')->withHeaders(['X-CSRF-Token' => 'security-notice-csrf']);
        Queue::fake();
        DB::listen(function (QueryExecuted $event): void {
            if (! str_starts_with(strtolower($event->sql), 'insert') || ! str_contains($event->sql, '"mail_outbox"')) {
                return;
            }
            $this->insertLevels[] = $event->connection->transactionLevel();
            if ($this->failAtInsert === count($this->insertLevels)) {
                // For two-mailbox flows, fail AFTER the second real INSERT.
                // The first envelope and its afterCommit callback must vanish.
                throw new \RuntimeException('Fixture: security notice interrupted');
            }
        });
    }

    public static function mfaCases(): array
    {
        $cases = [];
        foreach (['enable', 'reconfigure', 'regenerate', 'disable'] as $action) {
            $cases[$action.' succeeds'] = [$action, false];
            $cases[$action.' rolls back'] = [$action, true];
        }

        return $cases;
    }

    #[DataProvider('mfaCases')]
    public function test_mfa_state_and_its_security_notice_share_one_commit(string $action, bool $fail): void
    {
        $active = $action !== 'enable';
        [$user, $current, $other] = $this->account($active);
        if (in_array($action, ['enable', 'reconfigure'], true)) {
            $user->update([
                'mfa_pending_secret' => UvhCrypto::encryptAtRest(self::PENDING_SECRET),
                'mfa_pending_expires_at' => now()->addMinutes(5),
            ]);
        }
        $before = $this->securityState($user);
        $case = $this->recoveryCase($user);
        $code = $this->pendingCode();
        $counter = Totp::matchingCounter($code, self::PENDING_SECRET);
        [$url, $payload, $kind] = match ($action) {
            'enable', 'reconfigure' => ['/api/v1/auth/mfa/enable', ['code' => $code], $active ? 'mfa_reconfigured' : 'mfa_enabled'],
            'regenerate' => ['/api/v1/auth/mfa/recovery-codes/regenerate', [
                'password' => self::PASSWORD, 'factorCode' => self::RECOVERY_CODE,
            ], 'mfa_recovery_codes_regenerated'],
            'disable' => ['/api/v1/auth/mfa/disable', [
                'password' => self::PASSWORD, 'code' => self::RECOVERY_CODE,
            ], 'mfa_disabled'],
        };

        $this->failAtInsert = $fail ? 1 : 0;
        $response = $this->postJson($url, $payload);
        $this->assertSame([1], $this->insertLevels);
        if ($fail) {
            $response->assertStatus(503)->assertJsonMissingPath('recoveryCodes');
            $this->assertSame($before, $this->securityState($user));
            $this->assertSessionsUnchanged($current, $other);
            $this->assertSame('requested', $case->refresh()->status);
            $this->assertDatabaseCount('mail_outbox', 0);
            Queue::assertNothingPushed();
            if (in_array($action, ['enable', 'reconfigure'], true)) {
                // This shared-cache analogue is outside SQL: rollback must not
                // clear a consumed counter to make the same TOTP reusable.
                $this->assertNotNull($counter);
                $factor = substr(hash('sha256', self::PENDING_SECRET), 0, 24);
                $this->assertTrue(Cache::has('uvh:mfa:totp-used:'.$user->id.':'.$factor.':'.$counter));
            }

            return;
        }

        $response->assertOk();
        $this->assertSame(2, $user->refresh()->security_version);
        $this->assertSame($action !== 'disable', $user->mfa_enabled);
        $this->assertDatabaseHas('sessions', ['id' => Ids::sha256Hex($current), 'security_version' => 2, 'revoked_at' => null]);
        $this->assertNotNull(DB::table('sessions')->where('id', Ids::sha256Hex($other))->value('revoked_at'));
        $this->assertSame('cancelled', $case->refresh()->status);
        if ($action === 'disable') {
            $this->assertNull($user->mfa_secret);
            $this->assertNull($user->recovery_codes);
        } else {
            $response->assertJsonCount(10, 'recoveryCodes');
            $normalized = array_map(static fn (string $value) => str_replace('-', '', $value), $response->json('recoveryCodes'));
            $this->assertSame(array_map([Ids::class, 'sha256Hex'], $normalized), $user->recovery_codes);
            if ($action !== 'regenerate') {
                $this->assertSame(self::PENDING_SECRET, UvhCrypto::decryptAtRest($user->mfa_secret));
                $this->assertNull($user->mfa_pending_secret);
            }
        }
        $this->assertMessages([[$kind, $user->email]]);
        Queue::assertPushed(DeliverMailOutboxJob::class, 1);
    }

    public static function mfaAuditCases(): array
    {
        $cases = [];
        foreach (['setup', 'cancel', 'enable', 'reconfigure', 'regenerate', 'disable'] as $action) {
            $cases[$action.' admission unavailable'] = [$action, true];
            $cases[$action.' history unavailable'] = [$action, false];
        }

        return $cases;
    }

    #[DataProvider('mfaAuditCases')]
    public function test_mfa_mutation_and_exact_audit_event_share_one_commit(string $action, bool $admissionFails): void
    {
        [$user, $current, $other] = $this->account($action !== 'enable');
        $user->update([
            'mfa_pending_secret' => UvhCrypto::encryptAtRest(self::PENDING_SECRET),
            'mfa_pending_expires_at' => now()->addMinutes(5),
        ]);
        $before = $this->securityState($user);
        $case = $this->recoveryCase($user);
        [$url, $payload, $event] = match ($action) {
            'setup' => ['/api/v1/auth/mfa/setup', ['password' => self::PASSWORD, 'code' => self::RECOVERY_CODE], 'auth.mfa_setup'],
            'cancel' => ['/api/v1/auth/mfa/cancel-setup', [], 'auth.mfa_setup_cancel'],
            'enable', 'reconfigure' => ['/api/v1/auth/mfa/enable', ['code' => $this->pendingCode()], $action === 'enable' ? 'auth.mfa_enable' : 'auth.mfa_reconfigured'],
            'regenerate' => ['/api/v1/auth/mfa/recovery-codes/regenerate', ['password' => self::PASSWORD, 'factorCode' => self::RECOVERY_CODE], 'auth.mfa_recovery_regenerate'],
            'disable' => ['/api/v1/auth/mfa/disable', ['password' => self::PASSWORD, 'code' => self::RECOVERY_CODE], 'auth.mfa_disable'],
        };
        $table = $admissionFails ? 'audit_outbox' : 'audit_events';
        Schema::rename($table, $table.'_unavailable');
        try {
            $response = $this->postJson($url, $payload);
            if ($admissionFails) {
                $response->assertServerError()->assertJsonMissingPath('recoveryCodes')->assertJsonMissingPath('secret');
                $this->assertSame($before, $this->securityState($user));
                $this->assertSessionsUnchanged($current, $other);
                $this->assertSame('requested', $case->refresh()->status);
                $this->assertDatabaseCount('mail_outbox', 0);
                Queue::assertNothingPushed();
            } else {
                $response->assertOk();
                $pending = DB::table('audit_outbox')->get()->map(static fn ($row) => json_decode($row->event, true, flags: JSON_THROW_ON_ERROR));
                $exact = $pending->where('action', $event)->values();
                $this->assertCount(1, $exact);
                $this->assertSame($user->id, $exact[0]['user_id']);
                $this->assertSame((string) $user->id, $exact[0]['resource_id']);
                $serialized = json_encode($exact[0], JSON_THROW_ON_ERROR);
                $this->assertStringNotContainsString(self::PASSWORD, $serialized);
                $this->assertStringNotContainsString(self::RECOVERY_CODE, $serialized);
                $this->assertStringNotContainsString(self::PENDING_SECRET, $serialized);
            }
        } finally {
            Schema::rename($table.'_unavailable', $table);
        }
        if (! $admissionFails) {
            $this->assertTrue(Audit::drain());
            $this->assertTrue(Audit::drain());
            $this->assertSame(1, DB::table('audit_events')->where('action', $event)->count());
            $this->assertDatabaseCount('audit_outbox', 0);
        }
    }

    public static function staleMfaActors(): array
    {
        $cases = [];
        foreach (['setup', 'cancel', 'enable', 'reconfigure', 'regenerate', 'disable'] as $action) {
            foreach (['expired', 'revoked', 'version'] as $reason) {
                $cases[$action.' '.$reason] = [$action, $reason];
            }
        }

        return $cases;
    }

    #[DataProvider('staleMfaActors')]
    public function test_pre_authorized_mfa_requests_cannot_mutate_after_the_session_changes(string $action, string $reason): void
    {
        [$user, $current, $other] = $this->account($action !== 'enable');
        $user->update(['mfa_pending_secret' => UvhCrypto::encryptAtRest(self::PENDING_SECRET), 'mfa_pending_expires_at' => now()->addMinutes(5)]);
        $snapshot = clone $user;
        $currentId = Ids::sha256Hex($current);
        if ($reason === 'expired') {
            DB::table('sessions')->where('id', $currentId)->update(['expires_at' => now()->subSecond()]);
        } elseif ($reason === 'revoked') {
            DB::table('sessions')->where('id', $currentId)->update(['revoked_at' => now()]);
        } else {
            // A newer legitimate operation refreshed SQL's session/version;
            // this request still owns the earlier middleware snapshot.
            DB::table('users')->where('id', $user->id)->update(['security_version' => 2]);
            DB::table('sessions')->where('id', $currentId)->update(['security_version' => 2]);
        }
        $before = $this->securityState($user);
        $sessions = DB::table('sessions')->orderBy('id')->get()->toJson();
        $request = Request::create('/', 'POST', match ($action) {
            'setup' => ['password' => self::PASSWORD, 'code' => self::RECOVERY_CODE],
            'enable', 'reconfigure' => ['code' => $this->pendingCode()],
            'regenerate' => ['password' => self::PASSWORD, 'factorCode' => self::RECOVERY_CODE],
            'disable' => ['password' => self::PASSWORD, 'code' => self::RECOVERY_CODE],
            'cancel' => [],
        });
        $request->attributes->set(UvhRequest::USER, $snapshot);
        $request->attributes->set(UvhRequest::SESSION_ID, $currentId);
        $controller = app(MfaConfigurationController::class);
        $response = match ($action) {
            'setup' => $controller->mfaSetup($request),
            'cancel' => $controller->mfaCancelSetup($request),
            'enable', 'reconfigure' => $controller->mfaEnable($request),
            'regenerate' => $controller->mfaRegenerateRecoveryCodes($request),
            'disable' => $controller->mfaDisable($request),
        };
        $this->assertSame(409, $response->getStatusCode());
        $this->assertSame($before, $this->securityState($user));
        $this->assertSame($sessions, DB::table('sessions')->orderBy('id')->get()->toJson());
        $this->assertDatabaseCount('mail_outbox', 0);
        $this->assertDatabaseCount('notifications', 0);
        Queue::assertNothingPushed();
    }

    public static function emailCases(): array
    {
        return ['request replacement' => [false], 'confirm new identity' => [true]];
    }

    #[DataProvider('emailCases')]
    public function test_second_mailbox_failure_rolls_back_both_notices_and_can_be_retried(bool $confirm): void
    {
        [$user, $current, $other] = $this->account(true);
        $before = $this->securityState($user);
        $oldEmail = $user->email;
        $newEmail = 'new-identity@example.test';
        $token = Ids::randomToken(32);
        $pending = EmailChangeRequest::create([
            'id' => Ids::sha256Hex($token), 'user_id' => $user->id, 'security_version' => 1,
            'new_email' => $confirm ? $newEmail : 'prior-reservation@example.test',
            'expires_at' => now()->addHour(), 'created_at' => now(),
        ]);
        $case = $this->recoveryCase($user);
        [$url, $payload] = $confirm
            ? ['/api/v1/auth/confirm-email-change', ['token' => $token]]
            : ['/api/v1/auth/change-email', ['newEmail' => $newEmail, 'password' => self::PASSWORD, 'factorCode' => self::RECOVERY_CODE]];

        $this->failAtInsert = 2;
        $this->postJson($url, $payload)->assertStatus(503);
        $this->assertSame([1, 1], $this->insertLevels);
        $this->assertSame($before, $this->securityState($user));
        $this->assertSessionsUnchanged($current, $other);
        $this->assertDatabaseHas('email_change_requests', ['id' => $pending->id, 'new_email' => $pending->new_email, 'security_version' => 1]);
        $this->assertSame('requested', $case->refresh()->status);
        $this->assertDatabaseCount('mail_outbox', 0);
        Queue::assertNothingPushed();

        $this->failAtInsert = 0;
        $this->postJson($url, $payload)->assertOk();
        $this->assertSame([1, 1, 1, 1], $this->insertLevels);
        $this->assertDatabaseMissing('email_change_requests', ['id' => $pending->id]);
        if ($confirm) {
            $this->assertSame($newEmail, $user->refresh()->email);
            $this->assertSame(2, $user->security_version);
            foreach ([$current, $other] as $session) {
                $this->assertNotNull(DB::table('sessions')->where('id', Ids::sha256Hex($session))->value('revoked_at'));
            }
            $this->assertSame('cancelled', $case->refresh()->status);
            $this->assertMessages([['email_changed', $oldEmail], ['email_changed', $newEmail]]);
        } else {
            $this->assertSame($oldEmail, $user->refresh()->email);
            $this->assertSame([], $user->recovery_codes);
            $this->assertSessionsUnchanged($current, $other);
            $this->assertDatabaseHas('email_change_requests', ['user_id' => $user->id, 'new_email' => $newEmail]);
            $this->assertMessages([['email_change_verification', $newEmail], ['email_change_requested', $oldEmail]]);
        }
        Queue::assertPushed(DeliverMailOutboxJob::class, 2);
    }

    public static function identityActors(): array
    {
        $cases = [];
        foreach (['password', 'request', 'cancel'] as $action) {
            foreach (['expired', 'revoked', 'version'] as $reason) {
                $cases[$action.' '.$reason] = [$action, $reason];
            }
        }

        return $cases;
    }

    #[DataProvider('identityActors')]
    public function test_identity_mutations_reject_obsolete_middleware_authorization(string $action, string $reason): void
    {
        [$user, $current] = $this->account(true);
        EmailChangeRequest::create([
            'id' => Ids::sha256Hex(Ids::randomToken(32)), 'user_id' => $user->id,
            'security_version' => 1, 'new_email' => 'reserved@example.test', 'expires_at' => now()->addHour(),
        ]);
        $snapshot = clone $user;
        $sessionId = Ids::sha256Hex($current);
        if ($reason === 'version') {
            DB::table('users')->where('id', $user->id)->update(['security_version' => 2]);
            DB::table('sessions')->where('id', $sessionId)->update(['security_version' => 2]);
        } else {
            DB::table('sessions')->where('id', $sessionId)->update([$reason === 'expired' ? 'expires_at' : 'revoked_at' => now()->subSecond()]);
        }
        $before = $user->refresh()->getRawOriginal();
        $sessions = DB::table('sessions')->orderBy('id')->get()->toJson();
        $reservation = DB::table('email_change_requests')->get()->toJson();
        $request = Request::create('/', 'POST', [
            'password' => self::PASSWORD, 'current' => self::PASSWORD,
            'newPassword' => 'novel-copper-magnolia-73', 'newEmail' => 'next@example.test',
            'factorCode' => self::RECOVERY_CODE,
        ]);
        $request->attributes->set(UvhRequest::USER, $snapshot);
        $request->attributes->set(UvhRequest::SESSION_ID, $sessionId);
        $controller = app(AccountCredentialsController::class);
        $response = match ($action) {
            'password' => $controller->changePassword($request),
            'request' => $controller->requestEmailChange($request),
            'cancel' => $controller->cancelEmailChange($request),
        };
        $this->assertSame(409, $response->getStatusCode());
        $this->assertSame($before, $user->refresh()->getRawOriginal());
        $this->assertSame($sessions, DB::table('sessions')->orderBy('id')->get()->toJson());
        $this->assertSame($reservation, DB::table('email_change_requests')->get()->toJson());
        $this->assertDatabaseCount('mail_outbox', 0);
        Queue::assertNothingPushed();
    }

    public static function identityAudits(): array
    {
        $cases = [];
        foreach (['password', 'request', 'cancel', 'confirm', 'reset'] as $action) {
            foreach ([true, false] as $fail) {
                $cases[$action.($fail ? ' admission' : ' history')] = [$action, $fail];
            }
        }

        return $cases;
    }

    #[DataProvider('identityAudits')]
    public function test_identity_exact_event_is_atomic_and_recoverable(string $action, bool $admissionFails): void
    {
        [$user] = $this->account(true);
        $token = Ids::randomToken(32);
        EmailChangeRequest::create([
            'id' => Ids::sha256Hex($token), 'user_id' => $user->id,
            'security_version' => 1, 'new_email' => 'reserved@example.test', 'expires_at' => now()->addHour(),
        ]);
        EmailToken::create(['id' => Ids::sha256Hex($token), 'user_id' => $user->id, 'kind' => 'reset', 'expires_at' => now()->addHour()]);
        [$url, $payload, $event] = match ($action) {
            'password' => ['/api/v1/auth/change-password', ['current' => self::PASSWORD, 'newPassword' => 'novel-copper-magnolia-73', 'factorCode' => self::RECOVERY_CODE], 'auth.password_change'],
            'request' => ['/api/v1/auth/change-email', ['password' => self::PASSWORD, 'newEmail' => 'next@example.test', 'factorCode' => self::RECOVERY_CODE], 'auth.email_change_requested'],
            'cancel' => ['/api/v1/auth/change-email/cancel', ['password' => self::PASSWORD, 'factorCode' => self::RECOVERY_CODE], 'auth.email_change_cancelled'],
            'confirm' => ['/api/v1/auth/confirm-email-change', ['token' => $token], 'auth.email_change_confirmed'],
            'reset' => ['/api/v1/auth/reset-password', ['token' => $token, 'password' => 'novel-copper-magnolia-73'], 'auth.password_reset'],
        };
        $before = $user->refresh()->getRawOriginal();
        $sessions = DB::table('sessions')->orderBy('id')->get()->toJson();
        $reservation = DB::table('email_change_requests')->get()->toJson();
        $tokens = DB::table('email_tokens')->get()->toJson();
        if ($admissionFails) {
            DB::listen(static function (QueryExecuted $query) use ($event): void {
                if (! str_starts_with(strtolower($query->sql), 'insert') || ! str_contains($query->sql, '"audit_outbox"')) {
                    return;
                }
                foreach ($query->bindings as $binding) {
                    if (is_string($binding) && str_contains($binding, '"action":"'.$event.'"')) {
                        throw new \RuntimeException('Fixture: exact identity audit admission interrupted');
                    }
                }
            });
        } else {
            Schema::rename('audit_events', 'audit_events_unavailable');
        }
        try {
            $response = $this->postJson($url, $payload);
            if ($admissionFails) {
                $response->assertServerError();
                $this->assertSame($before, $user->refresh()->getRawOriginal());
                $this->assertSame($sessions, DB::table('sessions')->orderBy('id')->get()->toJson());
                $this->assertSame($reservation, DB::table('email_change_requests')->get()->toJson());
                $this->assertSame($tokens, DB::table('email_tokens')->get()->toJson());
                $this->assertDatabaseCount('mail_outbox', 0);
                $this->assertDatabaseCount('audit_outbox', 0);
                Queue::assertNothingPushed();
            } else {
                $response->assertOk();
                $events = DB::table('audit_outbox')->get()->map(static fn ($row) => json_decode($row->event, true, flags: JSON_THROW_ON_ERROR));
                $exact = $events->where('action', $event)->values();
                $this->assertCount(1, $exact);
                $this->assertSame($user->id, $exact[0]['user_id']);
                $this->assertSame((string) $user->id, $exact[0]['resource_id']);
                $serialized = json_encode($exact[0], JSON_THROW_ON_ERROR);
                foreach ([self::PASSWORD, self::RECOVERY_CODE, $token, 'novel-copper-magnolia-73'] as $secret) {
                    $this->assertStringNotContainsString($secret, $serialized);
                }
            }
        } finally {
            if (! $admissionFails) {
                Schema::rename('audit_events_unavailable', 'audit_events');
            }
        }
        if (! $admissionFails) {
            $this->assertTrue(Audit::drain());
            $this->assertTrue(Audit::drain());
            $this->assertSame(1, DB::table('audit_events')->where('action', $event)->count());
            $this->assertDatabaseCount('audit_outbox', 0);
        }
    }

    private function account(bool $active): array
    {
        $user = User::factory()->create([
            'name' => 'Notice Person', 'email' => 'notice-person@example.test', 'password_hash' => Hash::make(self::PASSWORD),
            'mfa_enabled' => $active, 'mfa_secret' => $active ? UvhCrypto::encryptAtRest('JBSWY3DPEHPK3PXP') : null,
            'recovery_codes' => $active ? [Ids::sha256Hex(self::RECOVERY_CODE)] : null,
        ]);
        $current = SessionManager::create($user->id, Request::create('/'), 1, $active);
        $other = SessionManager::create($user->id, Request::create('/'), 1, $active);
        $this->withCookie('uvh_session', $current);

        return [$user, $current, $other];
    }

    private function securityState(User $user): array
    {
        $user->refresh();

        return array_map(fn (string $field) => $user->getRawOriginal($field), [
            'email', 'security_version', 'mfa_enabled', 'mfa_secret', 'mfa_pending_secret', 'mfa_pending_expires_at', 'recovery_codes',
        ]);
    }

    private function recoveryCase(User $user): AccountRecoveryRequest
    {
        return AccountRecoveryRequest::create([
            'user_id' => $user->id, 'security_version' => 1, 'status' => 'requested',
            'confirmation_token_hash' => Ids::sha256Hex(Ids::randomToken(32)),
            'confirmation_expires_at' => now()->addHour(), 'expires_at' => now()->addDay(),
        ]);
    }

    private function assertSessionsUnchanged(string $current, string $other): void
    {
        foreach ([$current, $other] as $session) {
            $this->assertDatabaseHas('sessions', ['id' => Ids::sha256Hex($session), 'security_version' => 1, 'revoked_at' => null]);
        }
    }

    private function assertMessages(array $expected): void
    {
        $rows = DB::table('mail_outbox')->orderBy('id')->get();
        $this->assertCount(count($expected), $rows);
        foreach ($rows as $index => $row) {
            $this->assertTrue(MailDeliveryEligibility::isCurrent($row));
            $envelope = json_decode(UvhCrypto::decryptAtRest($row->encrypted_envelope), true, 512, JSON_THROW_ON_ERROR);
            $this->assertSame($expected[$index], [$row->kind, $envelope['to']]);
        }
    }

    private function pendingCode(): string
    {
        // Totp uses wall-clock microtime(), not Carbon's test clock. Generate
        // the RFC fixture's current step without sleeps or changing system time.
        $counter = intdiv(time(), 30);
        $digest = hash_hmac('sha1', pack('N2', 0, $counter), '12345678901234567890', true);
        $offset = ord($digest[19]) & 0x0F;
        $binary = unpack('N', substr($digest, $offset, 4))[1] & 0x7FFFFFFF;

        return str_pad((string) ($binary % 1000000), 6, '0', STR_PAD_LEFT);
    }
}
