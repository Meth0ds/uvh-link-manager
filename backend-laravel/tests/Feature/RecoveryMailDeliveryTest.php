<?php

namespace Tests\Feature;

use App\Jobs\DeliverMailOutboxJob;
use App\Models\AccountRecoveryRequest;
use App\Models\User;
use App\Support\Ids;
use App\Support\UvhMail;
use Illuminate\Mail\Mailer;
use Illuminate\Mail\Transport\ArrayTransport;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Queue;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

final class RecoveryMailDeliveryTest extends TestCase
{
    private ArrayTransport $transport;

    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, mail_outbox, audit_events, audit_outbox RESTART IDENTITY CASCADE');
        Queue::fake();
        config(['mail.driver' => null]);
        $this->transport = new ArrayTransport;
        $mailer = new Mailer('recovery-fixture', $this->app['view'], $this->transport, $this->app['events']);
        $mailer->alwaysFrom('sender@example.test');
        Mail::swap($mailer);
    }

    public static function lifecycleCases(): array
    {
        $cases = [];
        foreach ([false, true] as $approved) {
            foreach (['eligible', 'no-mfa', 'blocked', 'unverified', 'generation', 'deadline'] as $state) {
                $cases[($approved ? 'approved' : 'confirmation').' '.$state] = [$approved, $state];
            }
        }

        return $cases;
    }

    #[DataProvider('lifecycleCases')]
    public function test_delivery_requires_a_current_recoverable_account(bool $approved, string $state): void
    {
        $this->travelTo(now()->startOfSecond());
        $user = User::factory()->create(['email' => 'recovery@example.test', 'mfa_enabled' => true]);
        $token = Ids::randomToken(32);
        $hash = Ids::sha256Hex($token);
        $prefix = $approved ? 'completion' : 'confirmation';
        $case = AccountRecoveryRequest::create([
            'user_id' => $user->id,
            'security_version' => (int) $user->security_version,
            'status' => $approved ? 'approved' : 'requested',
            $prefix.'_token_hash' => $hash,
            $prefix.'_expires_at' => now()->addMinutes(30),
            'expires_at' => now()->addDay(),
        ]);
        $url = 'http://localhost/auth/account-recovery/'.($approved ? 'complete' : 'confirm').'#token='.$token;
        $this->assertTrue($approved
            ? UvhMail::accountRecoveryApproved($user->email, $url, $case->id, $hash)
            : UvhMail::accountRecoveryConfirmation($user->email, $url, $case->id, $hash));
        $row = DB::table('mail_outbox')->sole();
        // A restored/legacy account may lack MFA without rotating its stored
        // generation. Eligibility must enforce this invariant independently.
        match ($state) {
            'no-mfa' => $user->update(['mfa_enabled' => false]),
            'blocked' => $user->update(['deleted_at' => now()]),
            'unverified' => $user->update(['email_verified_at' => null]),
            'generation' => $user->update(['security_version' => (int) $user->security_version + 1]),
            'deadline' => $case->update([$prefix.'_expires_at' => now()]),
            default => null,
        };
        (new DeliverMailOutboxJob($row->id))->handle();
        $eligible = $state === 'eligible';
        $this->assertDatabaseHas('mail_outbox', [
            'id' => $row->id,
            'status' => $eligible ? 'sent' : 'obsolete',
            'encrypted_envelope' => '',
            'last_error' => $eligible ? null : 'lifecycle_obsolete',
        ]);
        $this->assertCount($eligible ? 1 : 0, $this->transport->messages());
        if ($eligible) {
            $message = $this->transport->messages()->first()->getOriginalMessage();
            $this->assertSame($user->email, $message->getTo()[0]->getAddress());
            $this->assertStringContainsString($token, $message->getTextBody());
            (new DeliverMailOutboxJob($row->id))->handle();
            $this->assertCount(1, $this->transport->messages());
        }
    }
}
