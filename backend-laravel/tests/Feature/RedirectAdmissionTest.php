<?php

namespace Tests\Feature;

use App\Models\Link;
use App\Models\User;
use App\Models\Webhook;
use App\Models\Workspace;
use App\Support\Ids;
use App\Support\UvhCrypto;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * Admission contract for the public redirect surface.
 *
 * Usage limits are the only place where a redirect has an authoritative side
 * effect, and `docs/architecture.md` claimed they were covered under real
 * concurrency by `ApiParityTest`, which only asserted the JSON field list.
 * These tests fix the observable behaviour; the parallel proof lives in
 * `RedirectConcurrencyTest`.
 *
 * The counter assertions are deliberate, not cosmetic: they pin that a click
 * rejected by the limit is never counted, and that an admitted one is visible
 * the moment the response is written.
 */
final class RedirectAdmissionTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users RESTART IDENTITY CASCADE');
    }

    public function test_single_use_link_is_consumed_once_and_reports_gone_afterwards(): void
    {
        [$owner, $workspace] = $this->workspace();
        $link = $this->link($workspace, $owner, 'one-shot', ['single_use' => true]);

        $first = $this->resolveAlias('one-shot');
        $this->assertSame(302, $first->getStatusCode());
        $this->assertSame('https://example.test/one-shot', $first->headers->get('Location'));
        $this->assertSame(1, (int) $link->fresh()->click_count);
        $this->assertNotNull($link->fresh()->used_at);

        $second = $this->resolveAlias('one-shot');
        $this->assertSame(410, $second->getStatusCode());
        // A rejected click must not be counted: the limit is the contract and
        // the counter is only its visible trace.
        $this->assertSame(1, (int) $link->fresh()->click_count);
    }

    public function test_max_clicks_stops_admitting_and_stops_counting_at_the_limit(): void
    {
        [$owner, $workspace] = $this->workspace();
        $link = $this->link($workspace, $owner, 'two-clicks', ['max_clicks' => 2]);

        $this->assertSame(302, $this->resolveAlias('two-clicks')->getStatusCode());
        $this->assertSame(302, $this->resolveAlias('two-clicks')->getStatusCode());
        $this->assertSame(410, $this->resolveAlias('two-clicks')->getStatusCode());
        $this->assertSame(410, $this->resolveAlias('two-clicks')->getStatusCode());

        $this->assertSame(2, (int) $link->fresh()->click_count);
        $this->assertNull($link->fresh()->used_at);
    }

    /**
     * The plain path must keep an exact counter that is visible as soon as the
     * response is written. This is what the redirect split is not allowed to
     * trade away for throughput.
     */
    public function test_plain_link_counts_every_admitted_click_and_stays_available(): void
    {
        [$owner, $workspace] = $this->workspace();
        $link = $this->link($workspace, $owner, 'plain');

        for ($expected = 1; $expected <= 3; $expected++) {
            $this->assertSame(302, $this->resolveAlias('plain')->getStatusCode());
            $this->assertSame($expected, (int) $link->fresh()->click_count);
        }
        $this->assertNull($link->fresh()->used_at);
    }

    public function test_threshold_webhook_is_admitted_exactly_once_at_the_last_admitted_click(): void
    {
        [$owner, $workspace] = $this->workspace();
        $this->webhook($workspace, $owner);
        $this->link($workspace, $owner, 'threshold', ['max_clicks' => 2]);

        $this->resolveAlias('threshold');
        $this->assertSame(0, DB::table('webhook_deliveries')->where('event', 'link.threshold_reached')->count());

        $this->resolveAlias('threshold');
        $this->assertSame(1, DB::table('webhook_deliveries')->where('event', 'link.threshold_reached')->count());

        // Clicks past the limit are refused, so they must not re-admit it.
        $this->assertSame(410, $this->resolveAlias('threshold')->getStatusCode());
        $this->assertSame(1, DB::table('webhook_deliveries')->where('event', 'link.threshold_reached')->count());
    }

    /**
     * The unlocked lookup decides which lock the resolution takes, so it can be
     * stale. This forces the race that the retry exists for: the link becomes
     * single use between that lookup and the locked resolution.
     */
    public function test_link_that_becomes_single_use_mid_resolution_is_consumed_not_admitted_free(): void
    {
        [$owner, $workspace] = $this->workspace();
        $link = $this->link($workspace, $owner, 'flips-midway');

        // The listener fires after the lookup runs, so that read still sees an
        // unlimited link while the locked read that follows sees the limit.
        $flipped = false;
        DB::listen(function ($query) use (&$flipped, $link): void {
            if ($flipped || ! str_contains($query->sql, 'from "links"')) {
                return;
            }
            if (str_contains($query->sql, 'for update') || str_contains($query->sql, 'for share')) {
                return;
            }
            $flipped = true;
            DB::table('links')->where('id', $link->id)->update(['single_use' => true]);
        });

        $this->assertSame(302, $this->resolveAlias('flips-midway')->getStatusCode());

        $this->assertTrue($flipped, 'The unlocked lookup was never observed, so this test proves nothing.');
        // Admitted through the exclusive retry, so it consumed the single use.
        $this->assertNotNull($link->fresh()->used_at);
        $this->assertSame(1, (int) $link->fresh()->click_count);
        $this->assertSame(410, $this->resolveAlias('flips-midway')->getStatusCode());
    }

    public function test_ineligible_links_never_reach_the_counter(): void
    {
        [$owner, $workspace] = $this->workspace();
        $paused = $this->link($workspace, $owner, 'paused-link', ['state' => 'paused']);
        $expired = $this->link($workspace, $owner, 'expired-link', ['state' => 'expired']);
        $scheduled = $this->link($workspace, $owner, 'later-link', ['state' => 'scheduled', 'scheduled_at' => now()->addDay()]);

        foreach (['paused-link', 'expired-link', 'later-link'] as $alias) {
            $this->assertSame(404, $this->resolveAlias($alias)->getStatusCode());
        }

        $this->assertSame(0, (int) $paused->fresh()->click_count);
        $this->assertSame(0, (int) $expired->fresh()->click_count);
        $this->assertSame(0, (int) $scheduled->fresh()->click_count);
    }

    // ---------------- helpers ----------------

    /** @param array<string, mixed> $attributes */
    private function link(Workspace $workspace, User $creator, string $alias, array $attributes = []): Link
    {
        return Link::create(array_merge([
            'workspace_id' => $workspace->id,
            'created_by' => $creator->id,
            'alias' => $alias,
            'destination' => 'https://example.test/'.$alias,
        ], $attributes));
    }

    private function webhook(Workspace $workspace, User $creator): Webhook
    {
        return Webhook::create([
            'workspace_id' => $workspace->id,
            'created_by' => $creator->id,
            'url' => 'https://example.test/hook',
            'secret' => UvhCrypto::encryptAtRest('redirect-threshold-secret-1234'),
            'events' => ['link.threshold_reached'],
            'active' => true,
            'config_version' => 1,
        ]);
    }

    /** Resolve through the canonical public surface, as a real visitor does. */
    private function resolveAlias(string $alias): TestResponse
    {
        return $this->call('GET', 'http://'.config('uvh.public_host').'/'.$alias);
    }

    /** @return array{User, Workspace} */
    private function workspace(): array
    {
        $owner = User::factory()->create(['email_verified_at' => now()]);
        $workspace = $owner->ownedWorkspaces()->create(['name' => 'Redirects', 'slug' => 'redirects-'.Ids::randomToken(8)]);
        $workspace->memberships()->create(['user_id' => $owner->id, 'role' => 'owner']);
        $workspace->quota()->create(['links_limit' => 100]);

        return [$owner, $workspace];
    }
}
