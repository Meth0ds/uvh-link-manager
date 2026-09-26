<?php

namespace Tests\Feature;

use App\Jobs\DeliverMailOutboxJob;
use App\Models\User;
use App\Support\Ids;
use App\Support\MailDeliveryEligibility;
use App\Support\SessionManager;
use App\Support\UvhCrypto;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Queue;
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

    /** @var list<int> */
    private array $noticeTransactionLevels = [];

    protected function setUp(): void
    {
        // The parent's database-name guard runs BEFORE any fixture truncation.
        parent::setUp();
        DB::statement('TRUNCATE users, sessions, workspaces, email_tokens, mail_outbox, audit_events, notifications, operational_metrics RESTART IDENTITY CASCADE');
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', 'sessions-notice-csrf')->withHeaders(['X-CSRF-Token' => 'sessions-notice-csrf']);
        Queue::fake();

        DB::listen(function (QueryExecuted $event): void {
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
