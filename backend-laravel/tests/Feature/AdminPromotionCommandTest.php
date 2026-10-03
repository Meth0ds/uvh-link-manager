<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\Ids;
use App\Support\UvhCrypto;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class AdminPromotionCommandTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, sessions, workspaces, memberships, invitations, quotas, custom_domains, links, tags, link_tags, redirect_rules, click_events, metric_rollups, metric_unique_visitors, api_tokens, webhooks, webhook_deliveries, abuse_reports, audit_events, email_tokens, jobs, failed_jobs RESTART IDENTITY CASCADE');
    }

    public function test_it_promotes_only_an_active_verified_mfa_enabled_account(): void
    {
        $user = User::factory()->create([
            'email' => 'operator@example.test',
            'mfa_enabled' => true,
            'mfa_secret' => UvhCrypto::encryptAtRest('JBSWY3DPEHPK3PXP'),
        ]);

        $this->artisan('uvh:admin:promote', ['email' => ' Operator@Example.Test '])
            ->expectsOutputToContain('operator@example.test ha sido promovido')
            ->assertSuccessful();

        $this->assertTrue($user->fresh()->is_admin);
        $this->assertDatabaseHas('audit_events', [
            'user_id' => $user->id,
            'action' => 'system.admin_promote',
            'resource_type' => 'user',
            'resource_id' => (string) $user->id,
        ]);
    }

    public function test_it_is_idempotent_and_does_not_duplicate_the_audit_event(): void
    {
        $user = User::factory()->create([
            'email' => 'admin@example.test',
            'is_admin' => true,
            'mfa_enabled' => true,
            'mfa_secret' => UvhCrypto::encryptAtRest('JBSWY3DPEHPK3PXP'),
        ]);

        $this->artisan('uvh:admin:promote', ['email' => $user->email])
            ->expectsOutputToContain('ya es administrador')
            ->assertSuccessful();

        $this->assertDatabaseCount('audit_events', 0);
    }

    #[DataProvider('ineligibleAccounts')]
    public function test_it_rejects_ineligible_accounts(array $attributes, string $message): void
    {
        $user = User::factory()->create(array_merge([
            'email' => 'candidate@example.test',
            'mfa_enabled' => true,
            'mfa_secret' => UvhCrypto::encryptAtRest('JBSWY3DPEHPK3PXP'),
        ], $attributes));

        $this->artisan('uvh:admin:promote', ['email' => $user->email])
            ->expectsOutputToContain($message)
            ->assertFailed();

        $this->assertFalse($user->fresh()->is_admin);
        $this->assertDatabaseCount('audit_events', 0);
    }

    #[DataProvider('unusableFactorProvider')]
    public function test_it_refuses_promotion_when_the_active_factor_cannot_be_used(string $kind): void
    {
        $secret = match ($kind) {
            'malformed ciphertext' => 'enc:v1:bad',
            'unreadable tag' => self::unreadableCiphertext(),
            'invalid alphabet' => UvhCrypto::encryptAtRest('INVALID!SECRET'),
            'too short' => UvhCrypto::encryptAtRest('ABCD'),
            'empty plaintext' => UvhCrypto::encryptAtRest(''),
        };
        $user = User::factory()->create([
            'email' => 'candidate@example.test',
            'mfa_enabled' => true,
            'mfa_secret' => $secret,
        ]);

        $this->artisan('uvh:admin:promote', ['email' => $user->email])
            ->expectsOutputToContain('factor MFA utilizable')
            ->assertFailed();
        self::assertFalse($user->fresh()->is_admin);
        $this->assertDatabaseCount('audit_events', 0);
    }

    public static function unusableFactorProvider(): array
    {
        return array_map(fn (string $kind): array => [$kind], ['malformed ciphertext', 'unreadable tag', 'invalid alphabet', 'too short', 'empty plaintext']);
    }

    private static function unreadableCiphertext(): string
    {
        $encrypted = UvhCrypto::encryptAtRest('JBSWY3DPEHPK3PXP');
        $payload = Ids::base64urlDecode(substr($encrypted, strlen('enc:v1:')));
        $payload[12] = chr(ord($payload[12]) ^ 1);

        return 'enc:v1:'.Ids::base64urlEncode($payload);
    }

    public function test_it_preserves_the_supported_usable_legacy_factor(): void
    {
        $user = User::factory()->create([
            'email' => 'legacy@example.test',
            'mfa_enabled' => true,
            'mfa_secret' => 'JBSWY3DPEHPK3PXP',
        ]);
        $this->artisan('uvh:admin:promote', ['email' => $user->email])->assertSuccessful();
        self::assertTrue($user->fresh()->is_admin);
        $this->assertDatabaseCount('audit_events', 1);
    }

    public static function ineligibleAccounts(): array
    {
        return [
            'blocked' => [['deleted_at' => '2026-08-30 10:00:00+00'], 'bloqueada'],
            'unverified' => [['email_verified_at' => null], 'verificar el email'],
            'without mfa' => [['mfa_enabled' => false, 'mfa_secret' => null], 'activar MFA'],
        ];
    }
}
