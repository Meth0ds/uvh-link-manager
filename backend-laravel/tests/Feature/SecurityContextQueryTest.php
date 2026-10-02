<?php

namespace Tests\Feature;

use App\Http\Controllers\AuthController;
use App\Models\User;
use App\Support\Ids;
use App\Support\SessionManager;
use App\Support\Totp;
use App\Support\UvhCrypto;
use App\Support\UvhRequest;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Queue;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

final class SecurityContextQueryTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, audit_events, audit_outbox, mail_outbox RESTART IDENTITY CASCADE');
        Queue::fake();
    }

    public static function operations(): array
    {
        return array_map(static fn ($method) => [$method], ['profile', 'mfaReauthenticate', 'mfaSetup', 'mfaEnable', 'mfaRegenerateRecoveryCodes', 'mfaDisable', 'requestEmailChange', 'cancelEmailChange', 'changePassword']);
    }

    #[DataProvider('operations')]
    public function test_locked_operations_do_not_reload_their_security_context(string $method): void
    {
        $password = 'brujula-limonero-zafiro-93';
        $secret = 'JBSWY3DPEHPK3PXP';
        $recovery = 'ABCD2345EFGH6789';
        $user = User::factory()->create(['password_hash' => Hash::make($password), 'mfa_enabled' => true,
            'mfa_secret' => UvhCrypto::encryptAtRest($secret), 'recovery_codes' => [Ids::sha256Hex($recovery)],
            'mfa_pending_secret' => UvhCrypto::encryptAtRest($secret), 'mfa_pending_expires_at' => now()->addMinutes(5)]);
        $session = SessionManager::create($user->id, Request::create('/'), 1, true);
        $request = Request::create('/', 'POST', ['name' => 'Updated Owner', 'password' => $password, 'current' => $password,
            'newPassword' => 'tiovivo-cobrizo-astilla-42', 'newEmail' => 'updated-owner@example.test',
            'factorCode' => $recovery, 'code' => $method === 'mfaEnable' ? Totp::currentCode($secret) : $recovery]);
        $request->attributes->set(UvhRequest::USER, $user);
        $request->attributes->set(UvhRequest::SESSION_ID, Ids::sha256Hex($session));
        $counts = ['users' => 0, 'sessions' => 0];
        DB::listen(static function (QueryExecuted $query) use (&$counts): void {
            foreach (array_keys($counts) as $table) {
                if (str_starts_with(strtolower($query->sql), 'select * from "'.$table.'"')) {
                    $counts[$table]++;
                }
            }
        });
        $response = app(AuthController::class)->{$method}($request);
        $this->assertSame(200, $response->getStatusCode());
        // Email-change responses refresh the public DTO after the commit.
        $ownerReads = in_array($method, ['requestEmailChange', 'cancelEmailChange'], true) ? 2 : 1;
        $this->assertSame(['users' => $ownerReads, 'sessions' => 1], $counts, $method.' unnecessarily reloads its locked security context');
    }
}
