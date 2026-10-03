<?php

namespace Tests\Feature;

use App\Models\PendingRegistration;
use App\Models\RegistrationAttempt;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

final class RegistrationAttemptSchemaTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, pending_registrations, registration_attempts RESTART IDENTITY CASCADE');
    }

    public function test_independent_browser_contexts_do_not_claim_an_email_or_create_accounts(): void
    {
        $deadline = now()->addHour()->setMillisecond(123);
        foreach (range(1, 2) as $_) {
            $attempt = RegistrationAttempt::create(['email' => 'same@example.test', 'expires_at' => $deadline]);
            $this->assertSame(1, $attempt->security_version);
            $attempt->refresh();
            $this->assertSame($deadline->getTimestampMs(), $attempt->expires_at->getTimestampMs());
            $this->assertNull($attempt->pending_registration_id);
            foreach (['name', 'password_hash', 'user_id', 'terms_version'] as $field) {
                $this->assertArrayNotHasKey($field, $attempt->getAttributes());
            }
        }
        $this->assertDatabaseCount('registration_attempts', 2);
        $this->assertDatabaseCount('users', 0);
        $this->assertDatabaseCount('pending_registrations', 0);
        $this->assertDatabaseCount('sessions', 0);
        $this->assertDatabaseCount('workspaces', 0);
        $this->assertDatabaseCount('legal_acceptances', 0);
    }

    public function test_pending_consumption_keeps_browser_context_and_private_lineage(): void
    {
        $pending = PendingRegistration::create(['email' => 'original@example.test', 'security_version' => 999]);
        $attempt = RegistrationAttempt::create(['email' => $pending->email, 'expires_at' => now()->addHour(), 'pending_registration_id' => $pending->id, 'pending_security_version' => 999, 'legacy_pending_id' => $pending->id, 'legacy_security_version' => 999]);
        $this->assertSame($pending->id, $attempt->pendingRegistration->id);
        $pending->delete();
        $this->assertNull($attempt->refresh()->pending_registration_id);
        $this->assertSame($pending->id, $attempt->legacy_pending_id);
        $this->assertSame('original@example.test', $attempt->email);
        $this->assertDatabaseCount('registration_attempts', 1);
    }

    public static function badGenerations(): array
    {
        return ['zero generation' => ['security_version', 0], 'negative generation' => ['security_version', -1], 'zero legacy id' => ['legacy_pending_id', 0], 'zero legacy generation' => ['legacy_security_version', 0], 'negative pending generation' => ['pending_security_version', -1], 'malformed legacy digest' => ['legacy_claim_hash', 'not-a-hash']];
    }

    #[DataProvider('badGenerations')]
    public function test_database_refuses_invalid_capability_state(string $field, mixed $value): void
    {
        try {
            RegistrationAttempt::create(['email' => 'invalid@example.test', 'expires_at' => now()->addHour(), $field => $value]);
            $this->fail('An invalid capability state reached storage');
        } catch (QueryException $error) {
            $this->assertSame('23514', $error->errorInfo[0]);
        }
    }

    public function test_two_contexts_cannot_hold_the_same_pending_registration(): void
    {
        $pending = PendingRegistration::create(['email' => 'original@example.test', 'security_version' => 1]);
        $attributes = ['email' => $pending->email, 'expires_at' => now()->addHour(), 'pending_registration_id' => $pending->id, 'pending_security_version' => 1];
        RegistrationAttempt::create($attributes);
        try {
            RegistrationAttempt::create($attributes);
            $this->fail('Two contexts acquired the same pending registration');
        } catch (QueryException $error) {
            $this->assertSame('23505', $error->errorInfo[0]);
        }
    }

    public function test_rollback_refuses_to_destroy_an_active_browser_context(): void
    {
        $attempt = RegistrationAttempt::create(['email' => 'active@example.test', 'expires_at' => now()->addHour()]);
        $migration = require database_path('migrations/2026_10_03_000001_create_registration_attempts.php');
        try {
            $migration->down();
            $this->fail('Rollback destroyed a live browser context');
        } catch (\RuntimeException $error) {
            $this->assertStringContainsString('browser contexts are active', $error->getMessage());
        }
        $this->assertTrue(Schema::hasTable('registration_attempts'));
        $this->assertNotNull($attempt->fresh());
    }

    public function test_expired_rollback_and_rebuild_preserve_legacy_lineage_without_accounts(): void
    {
        $pending = PendingRegistration::create(['email' => 'legacy@example.test', 'security_version' => 1000]);
        RegistrationAttempt::create(['email' => $pending->email, 'expires_at' => now()->subHour()]);
        $migration = require database_path('migrations/2026_10_03_000001_create_registration_attempts.php');
        try {
            $migration->down();
            $this->assertFalse(Schema::hasTable('registration_attempts'));
            $this->assertNotNull($pending->fresh());
            $migration->up();
            $attempt = RegistrationAttempt::sole();
            $this->assertSame(1, $attempt->security_version);
            $this->assertSame($pending->id, $attempt->pending_registration_id);
            $this->assertSame($pending->id, $attempt->legacy_pending_id);
            $this->assertSame(1000, $attempt->pending_security_version);
            $this->assertSame(1000, $attempt->legacy_security_version);
            $this->assertNull($attempt->legacy_consumed_at);
            $this->assertDatabaseCount('users', 0);
        } finally {
            if (! Schema::hasTable('registration_attempts')) {
                $migration->up();
            }
        }
    }
}
