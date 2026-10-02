<?php

namespace Tests\Feature;

use App\Jobs\DeliverMailOutboxJob;
use App\Models\PendingRegistration;
use App\Models\User;
use App\Support\Ids;
use App\Support\UvhMail;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Mail\Mailer;
use Illuminate\Mail\Transport\ArrayTransport;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Queue;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

final class VerificationMailDeliveryTest extends TestCase
{
    private ArrayTransport $transport;

    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, pending_registrations, email_tokens, mail_outbox, audit_events, audit_outbox RESTART IDENTITY CASCADE');
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', 'delivery')->withHeader('X-CSRF-Token', 'delivery');
        Queue::fake();
        config(['mail.driver' => null, 'mail.default' => 'verification-fixture', 'mail.mailers.verification-fixture' => ['transport' => 'smtp'], 'uvh.resend_verification_min_duration_ms' => 0]);
        $this->transport = new ArrayTransport;
        $mailer = new Mailer('verification-fixture', $this->app['view'], $this->transport, $this->app['events']);
        $mailer->alwaysFrom('sender@example.test');
        Mail::swap($mailer);
    }

    private function enqueue(bool $legacy): array
    {
        $owner = $legacy
            ? User::factory()->create(['email' => 'mailbox@example.test', 'email_verified_at' => null])
            : PendingRegistration::create(['email' => 'mailbox@example.test', 'security_version' => 1]);
        $this->postJson('/api/v1/auth/resend-verification', ['email' => $owner->email, 'captchaToken' => 'fixture'])->assertOk()->assertExactJson(['ok' => true]);
        Queue::assertPushed(DeliverMailOutboxJob::class, 1);
        $row = DB::table('mail_outbox')->sole();

        return [$owner, $row];
    }

    public static function owners(): array
    {
        return ['pending' => [false], 'legacy' => [true]];
    }

    #[DataProvider('owners')]
    public function test_resend_delivers_a_working_activation_link_once(bool $legacy): void
    {
        [$owner, $row] = $this->enqueue($legacy);
        (new DeliverMailOutboxJob($row->id))->handle();
        $this->assertDatabaseHas('mail_outbox', ['id' => $row->id, 'status' => 'sent', 'encrypted_envelope' => '', 'lock_token' => null, 'last_error' => null]);
        $this->assertCount(1, $this->transport->messages());
        $message = $this->transport->messages()->first()->getOriginalMessage();
        $this->assertSame('mailbox@example.test', $message->getTo()[0]->getAddress());
        $this->assertSame(1, preg_match('/token=([A-Za-z0-9_-]{43})/', $message->getTextBody(), $match));
        $this->assertSame($row->resource_id, Ids::sha256Hex($match[1]));
        $this->postJson('/api/v1/auth/verify-email', ['token' => $match[1], 'password' => 'brujula-limonero-zafiro-93', 'name' => 'Mailbox Owner', 'acceptTerms' => true, 'termsVersion' => '2026-08-30', 'privacyVersion' => '2026-08-30'])->assertOk();
        $user = User::where('email', 'mailbox@example.test')->firstOrFail();
        $this->assertNotNull($user->email_verified_at);
        if ($legacy) {
            $this->assertSame($owner->id, $user->id);
        }
        (new DeliverMailOutboxJob($row->id))->handle();
        $this->assertCount(1, $this->transport->messages());
    }

    public static function staleCases(): array
    {
        $cases = [];
        foreach ([false, true] as $legacy) {
            foreach (['expired', 'used', 'deleted', 'generation', 'kind'] as $state) {
                $cases[($legacy ? 'legacy' : 'pending').' '.$state] = [$legacy, $state];
            }
        }
        $cases['legacy verified'] = [true, 'verified'];
        $cases['legacy blocked'] = [true, 'blocked'];

        return $cases;
    }

    #[DataProvider('staleCases')]
    public function test_stale_verification_never_reaches_transport(bool $legacy, string $state): void
    {
        [$owner, $row] = $this->enqueue($legacy);
        match ($state) {
            'expired' => DB::table('email_tokens')->where('id', $row->resource_id)->update(['expires_at' => now()->subSecond()]),
            'used' => DB::table('email_tokens')->where('id', $row->resource_id)->update(['used_at' => now()]),
            'generation' => DB::table('mail_outbox')->where('id', $row->id)->update(['resource_generation' => Ids::sha256Hex('another-bearer')]),
            'kind' => DB::table('email_tokens')->where('id', $row->resource_id)->update(['kind' => 'reset']),
            'verified' => $owner->update(['email_verified_at' => now()]),
            'blocked' => $owner->update(['deleted_at' => now()]),
            'deleted' => $owner->delete(),
        };
        (new DeliverMailOutboxJob($row->id))->handle();
        $this->assertDatabaseHas('mail_outbox', ['id' => $row->id, 'status' => 'obsolete', 'encrypted_envelope' => '', 'last_error' => 'lifecycle_obsolete']);
        $this->assertCount(0, $this->transport->messages());
    }

    #[DataProvider('owners')]
    public function test_unavailable_eligibility_retries_without_sending_or_erasing_the_envelope(bool $legacy): void
    {
        [$owner, $row] = $this->enqueue($legacy);
        $unavailable = true;
        DB::listen(static function (QueryExecuted $query) use (&$unavailable): void {
            if ($unavailable && str_starts_with(strtolower($query->sql), 'select') && str_contains($query->sql, '"email_tokens"')) {
                throw new \RuntimeException('Fixture: lifecycle database unavailable');
            }
        });
        (new DeliverMailOutboxJob($row->id))->handle();
        $this->assertDatabaseHas('mail_outbox', ['id' => $row->id, 'status' => 'pending', 'last_error' => 'eligibility_unavailable', 'encrypted_envelope' => $row->encrypted_envelope, 'lock_token' => null]);
        $this->assertCount(0, $this->transport->messages());
        $unavailable = false;
        DB::table('mail_outbox')->where('id', $row->id)->update(['available_at' => now()]);
        (new DeliverMailOutboxJob($row->id))->handle();
        $this->assertDatabaseHas('mail_outbox', ['id' => $row->id, 'status' => 'sent', 'encrypted_envelope' => '', 'attempts' => 2]);
        $this->assertCount(1, $this->transport->messages());
    }

    public function test_an_orphan_admission_never_sends_a_verification_message(): void
    {
        $token = Ids::randomToken(32);
        $this->assertTrue(UvhMail::verification('unknown@example.test', 'http://localhost/auth/verify-email#token='.$token, Ids::sha256Hex($token)));
        $row = DB::table('mail_outbox')->sole();
        (new DeliverMailOutboxJob($row->id))->handle();
        $this->assertDatabaseHas('mail_outbox', ['id' => $row->id, 'status' => 'obsolete', 'encrypted_envelope' => '']);
        $this->assertCount(0, $this->transport->messages());
    }
}
