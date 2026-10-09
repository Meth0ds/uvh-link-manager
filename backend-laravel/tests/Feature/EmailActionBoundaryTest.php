<?php

namespace Tests\Feature;

use App\Models\EmailChangeRequest;
use App\Models\EmailToken;
use App\Models\PendingRegistration;
use App\Models\User;
use App\Support\Ids;
use App\Support\SessionManager;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

final class EmailActionBoundaryTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, pending_registrations, audit_events, audit_outbox, mail_outbox RESTART IDENTITY CASCADE');
        $this->disableCookieEncryption();
        $this->withCredentials()->withCookie('uvh_csrf', 'email-action')->withHeader('X-CSRF-Token', 'email-action');
        $this->travelTo(now()->startOfSecond());
        Queue::fake();
    }

    public static function deadlines(): array
    {
        $cases = [];
        foreach (['pending', 'legacy', 'reset', 'email'] as $action) {
            foreach ([1, 0, -1] as $seconds) {
                $cases[$action.' '.$seconds] = [$action, $seconds];
            }
        }

        return $cases;
    }

    #[DataProvider('deadlines')]
    public function test_all_email_action_deadlines_are_exclusive(string $action, int $seconds): void
    {
        [$owner, $token, $path, $payload] = $this->fixture($action, $seconds);
        $before = $owner->refresh()->getRawOriginal();
        $response = $this->postJson($path, $payload);
        if ($seconds <= 0) {
            $response->assertStatus(400);
            $this->assertSame($before, $owner->refresh()->getRawOriginal());
            $this->assertDatabaseCount('mail_outbox', 0);
            $this->assertDatabaseCount('audit_events', 0);
            Queue::assertNothingPushed();
            if ($action === 'pending') {
                $this->assertDatabaseCount('users', 0);
                $this->assertDatabaseCount('workspaces', 0);
            }
        } else {
            $response->assertOk();
            $user = User::where('email', $action === 'email' ? 'changed@example.test' : 'boundary@example.test')->firstOrFail();
            $this->assertNotNull($user->email_verified_at);
            if ($action === 'reset' || $action === 'email') {
                $this->assertSame(2, (int) $user->security_version);
            }
            $this->postJson($path, $payload)->assertStatus(400);
        }
    }

    public static function browserSessions(): array
    {
        $cases = [];
        foreach (['reset', 'email'] as $action) {
            foreach (['owner', 'foreign', 'anonymous'] as $identity) {
                $cases[$action.' '.$identity] = [$action, $identity];
            }
        }

        return $cases;
    }

    #[DataProvider('browserSessions')]
    public function test_only_the_affected_browser_identity_is_cleared(string $action, string $identity): void
    {
        [$owner, $token, $path, $payload] = $this->fixture($action, 60);
        $foreign = User::factory()->create();
        $ownerSession = SessionManager::create($owner->id, Request::create('/'), 1);
        $foreignSession = SessionManager::create($foreign->id, Request::create('/'), 1);
        if ($identity !== 'anonymous') {
            $this->withCookie('uvh_session', $identity === 'owner' ? $ownerSession : $foreignSession);
        }
        $response = $this->postJson($path, $payload)->assertOk();
        $current = $identity === 'owner';
        $cookies = collect($response->headers->getCookies())->filter(fn ($cookie) => $cookie->getName() === 'uvh_session');
        $this->assertCount($current ? 1 : 0, $cookies);
        $response->assertJsonPath('current', $current);
        $this->assertNotNull(DB::table('sessions')->where('id', Ids::sha256Hex($ownerSession))->value('revoked_at'));
        $this->assertDatabaseHas('sessions', ['id' => Ids::sha256Hex($foreignSession), 'revoked_at' => null]);
        $this->assertSame(1, (int) $foreign->refresh()->security_version);
        if ($identity === 'foreign') {
            $this->getJson('/api/v1/auth/me')->assertOk()->assertJsonPath('user.id', $foreign->id);
        }
    }

    private function fixture(string $action, int $seconds): array
    {
        $owner = $action === 'pending'
            ? PendingRegistration::create(['email' => 'boundary@example.test', 'security_version' => 1])
            : User::factory()->create(['email' => 'boundary@example.test', 'email_verified_at' => $action === 'legacy' ? null : now()]);
        $token = Ids::randomToken(32);
        if ($action === 'email') {
            EmailChangeRequest::create(['id' => Ids::sha256Hex($token), 'user_id' => $owner->id, 'new_email' => 'changed@example.test', 'security_version' => 1, 'expires_at' => now()->addSeconds($seconds)]);
        } else {
            EmailToken::create(['id' => Ids::sha256Hex($token), $action === 'pending' ? 'pending_registration_id' : 'user_id' => $owner->id, 'kind' => $action === 'reset' ? 'reset' : 'verify', 'expires_at' => now()->addSeconds($seconds)]);
        }
        $payload = ['token' => $token, 'password' => 'brujula-limonero-zafiro-93', 'name' => 'Mailbox Owner', 'acceptTerms' => true, 'termsVersion' => '2026-10-09', 'privacyVersion' => '2026-10-09'];
        $path = '/api/v1/auth/'.match ($action) {
            'pending', 'legacy' => 'verify-email',
            'reset' => 'reset-password',
            'email' => 'confirm-email-change',
        };

        return [$owner, $token, $path, $payload];
    }
}
