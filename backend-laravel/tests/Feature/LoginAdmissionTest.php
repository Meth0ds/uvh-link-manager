<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\Audit;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Schema;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

final class LoginAdmissionTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, audit_events, audit_outbox RESTART IDENTITY CASCADE');
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', 'login-fixture')->withHeaders(['X-CSRF-Token' => 'login-fixture']);
    }

    public static function credentialRaces(): array
    {
        return ['version' => ['security_version', 2], 'block' => ['deleted_at', 'now'], 'verification removed' => ['email_verified_at', null], 'email changed without version' => ['email', 'changed@example.test'], 'MFA enabled without version' => ['mfa_enabled', true], 'password replaced without version' => ['password_hash', 'different-hash']];
    }

    #[DataProvider('credentialRaces')]
    public function test_login_does_not_publish_success_after_credentials_change(string $field, mixed $value): void
    {
        $user = User::factory()->create(['password_hash' => Hash::make('orbit-copper-magnolia-73')]);
        Hash::partialMock()->shouldReceive('check')->once()->andReturnUsing(static function () use ($user, $field, $value): bool {
            DB::table('users')->where('id', $user->id)->update([$field => $value === 'now' ? now() : $value]);

            return true;
        });
        $this->postJson('/api/v1/auth/login', ['email' => $user->email, 'password' => 'orbit-copper-magnolia-73', 'captchaToken' => 'fixture-captcha'])->assertStatus(401)->assertJsonMissingPath('user');
        $this->assertDatabaseCount('sessions', 0);
    }

    public function test_success_returns_current_profile_after_password_preflight(): void
    {
        $user = User::factory()->create(['password_hash' => Hash::make('orbit-copper-magnolia-73')]);
        Hash::partialMock()->shouldReceive('check')->once()->andReturnUsing(static function () use ($user): bool {
            DB::table('users')->where('id', $user->id)->update(['name' => 'Current Profile']);

            return true;
        });
        $this->postJson('/api/v1/auth/login', ['email' => $user->email, 'password' => 'orbit-copper-magnolia-73', 'captchaToken' => 'fixture-captcha'])
            ->assertOk()->assertJsonPath('user.name', 'Current Profile');
        $this->assertDatabaseCount('sessions', 1);
    }

    public static function auditFailures(): array
    {
        return ['admission' => [true], 'history' => [false]];
    }

    #[DataProvider('auditFailures')]
    public function test_login_session_and_exact_event_share_a_commit(bool $admissionFails): void
    {
        $user = User::factory()->create(['password_hash' => Hash::make('orbit-copper-magnolia-73')]);
        if ($admissionFails) {
            DB::listen(static function (QueryExecuted $query): void {
                if (str_starts_with(strtolower($query->sql), 'insert') && str_contains($query->sql, '"audit_outbox"')) {
                    foreach ($query->bindings as $binding) {
                        if (is_string($binding) && str_contains($binding, '"action":"auth.login"')) {
                            throw new \RuntimeException('Fixture: login admission unavailable');
                        }
                    }
                }
            });
        } else {
            Schema::rename('audit_events', 'audit_events_unavailable');
        }
        try {
            $response = $this->postJson('/api/v1/auth/login', ['email' => $user->email, 'password' => 'orbit-copper-magnolia-73', 'captchaToken' => 'fixture-captcha']);
            if ($admissionFails) {
                $response->assertServerError();
                $this->assertDatabaseCount('sessions', 0);
                $this->assertDatabaseCount('audit_outbox', 0);
            } else {
                $response->assertOk()->assertJsonPath('user.id', $user->id);
                $this->assertDatabaseCount('sessions', 1);
                $this->assertDatabaseCount('audit_outbox', 1);
            }
        } finally {
            if (! $admissionFails) {
                Schema::rename('audit_events_unavailable', 'audit_events');
            }
        }
        if (! $admissionFails) {
            $this->assertTrue(Audit::drain());
            $this->assertTrue(Audit::drain());
            $this->assertSame(1, DB::table('audit_events')->where('action', 'auth.login')->count());
        }
    }
}
