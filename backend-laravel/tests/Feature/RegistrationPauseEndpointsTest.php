<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\Ids;
use App\Support\RegistrationGate;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

final class RegistrationPauseEndpointsTest extends TestCase
{
    private const CSRF = 'registration-pause-endpoints';

    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, sessions, audit_events, audit_outbox RESTART IDENTITY CASCADE');
        DB::table('operational_settings')->where('key', RegistrationGate::KEY)->delete();
        Cache::flush();
        $this->disableCookieEncryption();
        $this->withCredentials()->withCookie('uvh_csrf', self::CSRF)->withHeader('X-CSRF-Token', self::CSRF);
    }

    public function test_config_publishes_pause_state_without_authentication(): void
    {
        $this->getJson('/api/v1/config')->assertOk()->assertJsonPath('registrationPaused', false);

        RegistrationGate::setPaused(true, null, null);

        $this->getJson('/api/v1/config')->assertOk()->assertJsonPath('registrationPaused', true);
    }

    public function test_admin_can_pause_and_resume_with_audit(): void
    {
        [$admin, $token] = $this->adminSession();

        $this->withCookie('uvh_session', $token)
            ->postJson('/api/v1/admin/registration-pause', ['paused' => true])
            ->assertOk()
            ->assertExactJson(['ok' => true, 'paused' => true]);

        $this->withCookie('uvh_session', $token)
            ->getJson('/api/v1/admin/overview')
            ->assertOk()
            ->assertJsonPath('registrationPaused', true);
        $this->withCookie('uvh_session', $token)
            ->getJson('/api/v1/admin/operations')
            ->assertOk()
            ->assertJsonPath('registrationPaused', true);
        $this->getJson('/api/v1/config')->assertOk()->assertJsonPath('registrationPaused', true);
        $this->assertDatabaseHas('audit_events', [
            'user_id' => $admin->id,
            'action' => 'admin.registration_pause',
        ]);

        $this->withCookie('uvh_session', $token)
            ->postJson('/api/v1/admin/registration-pause', ['paused' => false])
            ->assertOk()
            ->assertExactJson(['ok' => true, 'paused' => false]);
        $this->getJson('/api/v1/config')->assertOk()->assertJsonPath('registrationPaused', false);
    }

    public function test_pause_rejects_non_boolean_values_without_changing_state(): void
    {
        [, $token] = $this->adminSession();

        foreach ([['paused' => 'yes'], ['paused' => 1], []] as $payload) {
            $this->withCookie('uvh_session', $token)
                ->postJson('/api/v1/admin/registration-pause', $payload)
                ->assertUnprocessable()
                ->assertJson(['error' => 'Datos inválidos']);
        }

        $this->getJson('/api/v1/config')->assertOk()->assertJsonPath('registrationPaused', false);
    }

    public function test_pause_requires_admin_session_with_fresh_mfa(): void
    {
        $this->postJson('/api/v1/admin/registration-pause', ['paused' => true])
            ->assertUnauthorized()
            ->assertJson(['error' => 'No autenticado']);

        $nonAdmin = User::create([
            'email' => 'member@example.test',
            'name' => 'Member',
            'password_hash' => 'not-used-in-pause-test',
            'email_verified_at' => now(),
            'mfa_enabled' => true,
            'security_version' => 1,
        ]);
        $memberToken = Ids::randomToken(32);
        DB::table('sessions')->insert([
            'id' => Ids::sha256Hex($memberToken),
            'user_id' => $nonAdmin->id,
            'security_version' => 1,
            'mfa_verified_at' => now(),
            'created_at' => now(),
            'last_used_at' => now(),
            'expires_at' => now()->addDay(),
        ]);
        $this->withCookie('uvh_session', $memberToken)
            ->postJson('/api/v1/admin/registration-pause', ['paused' => true])
            ->assertForbidden()
            ->assertJsonPath('error', 'Acceso restringido');

        [$staleAdmin, $staleToken] = $this->adminSession(false);
        $this->withCookie('uvh_session', $staleToken)
            ->postJson('/api/v1/admin/registration-pause', ['paused' => true])
            ->assertForbidden()
            ->assertJson([
                'error' => 'Esta operación requiere una sesión autenticada con MFA',
                'details' => ['reason' => 'mfa_required'],
            ]);
        $this->assertTrue($staleAdmin->mfa_enabled);
        $this->assertTrue($nonAdmin->mfa_enabled);

        $this->getJson('/api/v1/config')->assertOk()->assertJsonPath('registrationPaused', false);
    }

    /** @return array{User, string} */
    private function adminSession(bool $mfaVerified = true): array
    {
        $admin = User::create([
            'email' => 'admin'.Ids::randomToken(4).'@example.test',
            'name' => 'Platform Admin',
            'password_hash' => 'not-used-in-pause-test',
            'email_verified_at' => now(),
            'is_admin' => true,
            'mfa_enabled' => true,
            'security_version' => 1,
        ]);
        $token = Ids::randomToken(32);
        DB::table('sessions')->insert([
            'id' => Ids::sha256Hex($token),
            'user_id' => $admin->id,
            'security_version' => 1,
            'mfa_verified_at' => $mfaVerified ? now() : null,
            'created_at' => now(),
            'last_used_at' => now(),
            'expires_at' => now()->addDay(),
        ]);

        return [$admin, $token];
    }
}
