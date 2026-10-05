<?php

namespace Tests\Feature;

use App\Models\EmailToken;
use App\Models\User;
use App\Support\Ids;
use App\Support\SessionManager;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

final class LinkIntentCounterLifetimeTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, audit_events, audit_outbox, operational_metrics RESTART IDENTITY CASCADE');
        Queue::fake();
        $this->disableCookieEncryption();
        $this->withCredentials()->withCookie('uvh_csrf', 'intent-lifetime')->withHeader('X-CSRF-Token', 'intent-lifetime');
        $this->travelTo(now()->startOfHour());
    }

    protected function tearDown(): void
    {
        $this->travelBack();
        parent::tearDown();
    }

    private function issue(string $path): string
    {
        $token = $this->postJson('/api/v1/link-intents', ['destination' => 'https://example.com/'.$path])
            ->assertCreated()->json('intent');
        $this->assertIsString($token);

        return $token;
    }

    private function claim(User $owner, string $intent): array
    {
        $this->withCookie('uvh_session', SessionManager::create($owner->id, Request::create('/'), 1, true));
        $this->postJson('/api/v1/link-intents/claim', ['intent' => $intent])->assertOk();
        $record = Cache::get('link-intent:'.Ids::sha256Hex($intent));
        $this->assertIsArray($record);

        return $record;
    }

    private function remove(User $owner, string $intent, string $action): void
    {
        if ($action === 'complete') {
            $this->postJson('/api/v1/link-intents/complete', ['intent' => $intent])->assertOk();
        } else {
            $token = Ids::randomToken(32);
            EmailToken::create([
                'id' => Ids::sha256Hex($token), 'user_id' => $owner->id,
                'kind' => 'security_revoke', 'expires_at' => now()->addHour(),
            ]);
            $this->postJson('/api/v1/auth/security-incident/revoke', ['token' => $token])->assertOk();
            $this->assertDatabaseHas('sessions', ['user_id' => $owner->id, 'revoked_at' => now()]);
        }
        $this->assertNull(Cache::get('link-intent:'.Ids::sha256Hex($intent)));
        $this->assertDatabaseMissing('link_intent_claims', ['intent_hash' => Ids::sha256Hex($intent)]);
    }

    public static function lifetimesAndRemoval(): array
    {
        $cases = [];
        foreach ([24, 48, 168] as $hours) {
            foreach (['incident', 'complete'] as $action) {
                $cases[$hours.'h-'.$action] = [$hours, $action];
            }
        }

        return $cases;
    }

    #[DataProvider('lifetimesAndRemoval')]
    public function test_removing_one_intent_preserves_ip_admission_for_other_live_intents(int $hours, string $action): void
    {
        config(['uvh.intent_ttl_hours' => $hours]);
        $owner = User::factory()->create();
        $mine = $this->issue('owner');
        $others = [];
        foreach (range(1, 19) as $index) {
            $others[] = $this->issue('other-'.$index);
        }
        $record = $this->claim($owner, $mine);
        $this->postJson('/api/v1/link-intents', ['destination' => 'https://example.com/full'])->assertStatus(429);
        $this->remove($owner, $mine, $action);
        $this->assertSame(19, Cache::get($record['counter_key']));
        $this->travel($hours > 24 ? 25 : 12)->hours();
        foreach ($others as $intent) {
            $this->assertIsArray(Cache::get('link-intent:'.Ids::sha256Hex($intent)));
        }
        // A new verified account can still use the old bearer after the clock
        // advances: these are live destinations, not merely residual counters.
        $this->claim(User::factory()->create(), $others[0]);
        $this->issue('last-free-slot');
        $this->postJson('/api/v1/link-intents', ['destination' => 'https://example.com/over-cap'])
            ->assertStatus(429)->assertJsonPath('error', 'Hay demasiadas URLs guardadas en este momento. Completa o descarta una antes de añadir otra.');
    }

    #[DataProvider('lifetimesAndRemoval')]
    public function test_removing_one_intent_preserves_global_admission_for_other_live_buckets(int $hours, string $action): void
    {
        config(['uvh.intent_ttl_hours' => $hours]);
        $owner = User::factory()->create();
        $mine = $this->issue('owner');
        $record = $this->claim($owner, $mine);
        $survivor = $this->issue('survivor');
        // Explicit capacity fixture: two real HTTP bearers and the remaining
        // population's aggregate counter. This does not simulate 100k users.
        Cache::put($record['global_counter_key'], 100_000, now()->addHours($hours + 2));
        $this->postJson('/api/v1/link-intents', ['destination' => 'https://example.com/full'])->assertStatus(429);
        $this->remove($owner, $mine, $action);
        $this->assertSame(99_999, Cache::get($record['global_counter_key']));
        $this->travel($hours > 24 ? 25 : 12)->hours();
        $this->claim(User::factory()->create(), $survivor);
        $this->issue('last-global-slot');
        $this->postJson('/api/v1/link-intents', ['destination' => 'https://example.com/over-global-cap'])
            ->assertStatus(429)->assertJsonPath('error', 'Hay demasiadas URLs guardadas en este momento. Completa o descarta una antes de añadir otra.');
    }
}
