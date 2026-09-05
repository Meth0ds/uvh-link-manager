<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\Ids;
use App\Support\SessionManager;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class SessionManagerTest extends TestCase
{
    public function test_session_created_from_stale_credentials_is_rejected(): void
    {
        DB::statement('TRUNCATE users, sessions RESTART IDENTITY CASCADE');
        $user = User::factory()->create([
            'email_verified_at' => now(),
            'security_version' => 2,
        ]);
        $request = Request::create('/', 'POST', [], [], [], ['REMOTE_ADDR' => '203.0.113.10']);

        $token = SessionManager::create($user->id, $request, 1);
        $authenticated = Request::create('/', 'GET', [], [config('uvh.session_cookie') => $token]);

        $this->assertNull(SessionManager::hydrate($authenticated));
        $this->assertNotNull(DB::table('sessions')->where('id', Ids::sha256Hex($token))->value('revoked_at'));
    }
}
