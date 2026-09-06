<?php

namespace Tests\Feature;

use App\Models\AuditEvent;
use App\Models\User;
use App\Support\SessionManager;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** Account-scoped read model tests; no workspace or external service is used. */
final class SecurityCenterTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users RESTART IDENTITY CASCADE');
        $this->disableCookieEncryption();
        $this->withCredentials();
    }

    public function test_summary_and_activity_are_minimized_and_account_scoped(): void
    {
        $user = User::factory()->create([
            'email_verified_at' => now(), 'mfa_enabled' => true,
            'recovery_codes' => ['one', 'two', 'three'],
        ]);
        $foreign = User::factory()->create();
        $this->signIn($user);
        AuditEvent::create(['user_id' => $user->id, 'action' => 'auth.password_change', 'resource_type' => 'user',
            'resource_id' => (string) $user->id, 'metadata' => ['secret' => 'private-metadata'], 'ip_hash' => 'private-ip-hash']);
        AuditEvent::create(['user_id' => $user->id, 'action' => 'link.update', 'resource_type' => 'link', 'resource_id' => '99']);
        AuditEvent::create(['user_id' => $foreign->id, 'action' => 'auth.login', 'resource_type' => 'user',
            'resource_id' => (string) $foreign->id, 'metadata' => ['foreign' => 'foreign-private']]);

        $response = $this->getJson('/api/v1/auth/security-center')->assertOk()
            ->assertJsonPath('summary.mfaEnabled', true)
            ->assertJsonPath('summary.recoveryCodesRemaining', 3)
            ->assertJsonPath('summary.activeSessions', 1)
            ->assertJsonPath('activity.0.action', 'auth.password_change')
            ->assertJsonCount(1, 'activity');
        foreach (['private-metadata', 'private-ip-hash', 'foreign-private', 'link.update', 'resource_id', 'metadata'] as $forbidden) {
            $this->assertStringNotContainsString($forbidden, $response->getContent());
        }
    }

    public function test_activity_is_bounded_and_uses_stable_descending_order(): void
    {
        $user = User::factory()->create(['email_verified_at' => now()]);
        $this->signIn($user);
        for ($index = 0; $index < 24; $index++) {
            AuditEvent::create(['user_id' => $user->id, 'action' => 'auth.login', 'resource_type' => 'user',
                'resource_id' => (string) $user->id, 'created_at' => now()->addSeconds($index)]);
        }
        $response = $this->getJson('/api/v1/auth/security-center')->assertOk()->assertJsonCount(20, 'activity');
        $ids = collect($response->json('activity'))->pluck('id')->all();
        $sorted = $ids;
        rsort($sorted);
        $this->assertSame($sorted, $ids);
    }

    public function test_security_center_requires_a_live_session(): void
    {
        $this->getJson('/api/v1/auth/security-center')->assertUnauthorized()->assertExactJson(['error' => 'No autenticado']);
    }

    private function signIn(User $user): void
    {
        $this->withCookie('uvh_session', SessionManager::create($user->id, Request::create('/'), (int) $user->security_version, true));
    }
}
