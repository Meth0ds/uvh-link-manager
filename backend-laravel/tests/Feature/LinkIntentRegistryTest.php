<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\Ids;
use App\Support\LinkIntentRegistry;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Mockery;
use Tests\TestCase;

final class LinkIntentRegistryTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users CASCADE');
    }

    public function test_rejected_cache_delete_keeps_inverse_index_for_retry(): void
    {
        $user = User::factory()->create();
        $intent = Ids::randomToken(32);
        $digest = Ids::sha256Hex($intent);
        $cacheKey = 'link-intent:'.$digest;
        $record = [
            'destination' => 'https://example.com/revoke',
            'claimed_by' => $user->id,
            'expires_at' => now()->addHour()->toIso8601String(),
        ];
        Cache::put($cacheKey, $record, now()->addHour());
        DB::table('link_intent_claims')->insert([
            'intent_hash' => $digest,
            'user_id' => $user->id,
            'expires_at' => now()->addHour(),
            'created_at' => now(),
        ]);

        $cache = Cache::getFacadeRoot();
        $cacheMock = Mockery::mock($cache)->makePartial();
        $cacheMock->shouldReceive('forget')->once()->with($cacheKey)->andReturnFalse();
        Cache::swap($cacheMock);
        try {
            $result = LinkIntentRegistry::revokeForUser($user->id);
        } finally {
            Cache::swap($cache);
        }

        $this->assertSame(['revoked' => 0, 'busy' => 1], $result);
        $this->assertDatabaseHas('link_intent_claims', ['intent_hash' => $digest, 'user_id' => $user->id]);
        $this->assertSame($record, Cache::get($cacheKey));

        $this->assertSame(['revoked' => 1, 'busy' => 0], LinkIntentRegistry::revokeForUser($user->id));
        $this->assertDatabaseMissing('link_intent_claims', ['intent_hash' => $digest]);
        $this->assertNull(Cache::get($cacheKey));
    }
}
