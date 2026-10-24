<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\Ids;
use App\Support\LocalRecoveryBridge;
use App\Support\LocalRecoveryGate;
use App\Support\SessionManager;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Tests\TestCase;

final class LocalRecoveryTest extends TestCase
{
    private string $bridge;

    private const PASSWORD = 'recovery-test-password';

    private const FACTOR = 'ABCDEFGHJKLMNPQR';

    protected function setUp(): void
    {
        parent::setUp();
        $this->bridge = sys_get_temp_dir().'/uvh-recovery-'.Str::uuid();
        File::makeDirectory($this->bridge.'/requests', 0700, true);
        file_put_contents($this->bridge.'/key', str_repeat('c', 64));
        config(['recovery.enabled' => true, 'recovery.bridge' => $this->bridge]);
        $this->publish('maintenance.json', ['maintenance' => false]);
        $this->publish('snapshot.json', ['schema' => 1, 'expires' => (int) floor(microtime(true) * 1000) + 90000, 'operation' => null, 'history' => [], 'auditEvents' => []]);
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', 'recovery-csrf')->withHeaders(['X-CSRF-Token' => 'recovery-csrf']);
    }

    protected function tearDown(): void
    {
        File::deleteDirectory($this->bridge);
        parent::tearDown();
    }

    public function test_normal_user_cannot_read_recovery_state(): void
    {
        $this->adminSession(false);
        $this->getJson('/api/v1/admin/updates')->assertForbidden();
    }

    public function test_administrator_reads_only_an_authenticated_fresh_snapshot(): void
    {
        $this->adminSession();
        $this->getJson('/api/v1/admin/updates')->assertOk()->assertJsonPath('schema', 1);
        file_put_contents($this->bridge.'/snapshot.json', '{"body":"{}","mac":"forged"}');
        $this->getJson('/api/v1/admin/updates')->assertStatus(503);
    }

    public function test_access_requires_concrete_second_factor_and_consumes_it(): void
    {
        $user = $this->adminSession();
        $this->postJson('/api/v1/admin/updates/access', ['password' => self::PASSWORD, 'factorCode' => 'wrong'])->assertForbidden();
        $response = $this->postJson('/api/v1/admin/updates/access', ['password' => self::PASSWORD, 'factorCode' => self::FACTOR])->assertOk();
        $frame = json_decode(base64_decode(strtr($response->json('ticket'), '-_', '+/')), true);
        self::assertSame(hash_hmac('sha256', $frame['body'], str_repeat('c', 64)), $frame['mac']);
        self::assertSame('recovery-access', json_decode($frame['body'], true)['purpose']);
        self::assertSame([], $user->fresh()->recovery_codes);
        $this->postJson('/api/v1/admin/updates/access', ['password' => self::PASSWORD, 'factorCode' => self::FACTOR])->assertForbidden();
    }

    public function test_a_mutation_requires_step_up_and_admits_only_a_signed_target(): void
    {
        $this->adminSession();
        $id = (string) Str::uuid();
        $this->postJson('/api/v1/admin/updates/backup', ['requestId' => $id])->assertUnprocessable();
        self::assertCount(0, File::files($this->bridge.'/requests'));
        $this->postJson('/api/v1/admin/updates/backup', ['requestId' => $id, 'password' => self::PASSWORD, 'factorCode' => self::FACTOR])->assertAccepted();
        $frame = json_decode(file_get_contents($this->bridge.'/requests/'.$id.'.json'), true);
        self::assertSame(hash_hmac('sha256', $frame['body'], str_repeat('c', 64)), $frame['mac']);
        self::assertSame('backup', json_decode($frame['body'], true)['action']);
        self::assertStringNotContainsString(self::PASSWORD, $frame['body']);
    }

    public function test_maintenance_also_blocks_direct_backend_requests_and_fails_closed(): void
    {
        $this->publish('maintenance.json', ['maintenance' => true]);
        $this->getJson('/health')->assertStatus(503)->assertJsonPath('reason', 'local_maintenance');
        unlink($this->bridge.'/maintenance.json');
        self::assertTrue(LocalRecoveryGate::paused());
        $this->postJson('/api/v1/auth/login', [])->assertStatus(503);
    }

    public function test_recovery_audit_is_idempotent_and_can_be_replayed_after_restore(): void
    {
        $bridge = app(LocalRecoveryBridge::class);
        $id = (string) Str::uuid();
        $snapshot = ['auditEvents' => [['id' => $id, 'action' => 'operation.restore.completed', 'actor' => null]]];
        $bridge->reconcileAudit($snapshot);
        $bridge->reconcileAudit($snapshot);
        self::assertSame(1, DB::table('audit_events')->where('resource_id', $id)->count());
    }

    public function test_invalid_fields_and_untrusted_targets_are_rejected(): void
    {
        $this->adminSession();
        $this->postJson('/api/v1/admin/updates/restore', ['requestId' => (string) Str::uuid(), 'target' => ['command' => 'anything']])->assertUnprocessable();
        self::assertCount(0, File::files($this->bridge.'/requests'));
    }

    private function publish(string $name, array $value): void
    {
        file_put_contents($this->bridge.'/'.$name, json_encode(app(LocalRecoveryBridge::class)->sign($value), JSON_THROW_ON_ERROR));
    }

    private function adminSession(bool $admin = true): User
    {
        $user = User::factory()->create(['password_hash' => Hash::make(self::PASSWORD), 'is_admin' => $admin, 'mfa_enabled' => true,
            'recovery_codes' => [Ids::sha256Hex(self::FACTOR)], 'email_verified_at' => now(), 'security_version' => 1]);
        $token = SessionManager::create($user->id, Request::create('/'), (int) $user->security_version, mfaVerified: true);
        $this->withCookie((string) config('uvh.session_cookie'), $token);

        return $user;
    }
}
