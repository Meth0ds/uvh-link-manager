<?php

namespace Tests\Feature;

use App\Models\Link;
use App\Models\User;
use App\Support\DestinationDenylist;
use App\Support\DestinationReputationService;
use App\Support\LinkService;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Destination-level moderation.
 *
 * Blocking a link used to leave the abuse intact: the same URL came back as a
 * second link a minute later and was also reachable through a redirect rule.
 * These tests pin the properties that make the destination the unit of
 * moderation, and — just as importantly — the ones that keep an optional,
 * possibly absent provider from ever being reported as "this destination is
 * safe".
 */
final class DestinationReputationTest extends TestCase
{
    private int $workspaceId;

    private int $userId;

    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, workspaces, memberships, quotas, links, redirect_rules, abuse_reports, audit_events, destination_denylist, destination_reputation_checks, operational_metrics RESTART IDENTITY CASCADE');
        config([
            'uvh.reputation.provider_url' => null,
            'uvh.reputation.auto_block' => false,
            'uvh.reputation.cache_ttl_hours' => 24,
        ]);

        $this->userId = User::factory()->create()->id;
        $this->workspaceId = DB::table('workspaces')->insertGetId([
            'name' => 'Reputation QA',
            'slug' => 'reputation-qa',
            'owner_user_id' => $this->userId,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public function test_a_host_entry_blocks_the_host_and_its_subdomains_but_never_a_lookalike(): void
    {
        $this->assertNotNull(DestinationDenylist::blockHost('evil.example', 'Phishing confirmado'));

        // The host itself and any subdomain an abuser rotates to.
        $this->assertSame(
            LinkService::BLOCKED_DESTINATION,
            LinkService::validate(['destination' => 'https://evil.example/login'])['error'],
        );
        $this->assertSame(
            LinkService::BLOCKED_DESTINATION,
            LinkService::validate(['destination' => 'https://pay.evil.example/login'])['error'],
        );

        // Label-aware, never substring: a distinct registrable name that merely
        // contains the blocked label stays allowed.
        $this->assertTrue(LinkService::validate(['destination' => 'https://notevil.example/login'])['ok']);
        $this->assertTrue(LinkService::validate(['destination' => 'https://evil.example.nothere.test/login'])['ok']);
    }

    public function test_an_exact_url_entry_matches_its_canonical_form_and_is_never_stored_in_clear(): void
    {
        $destination = 'https://evil.example/login?campaign=mail';
        $this->assertNotNull(DestinationDenylist::blockUrl($destination, 'Credenciales robadas'));

        // The fragment never reaches a server, so ignoring it cannot be used to
        // walk past an entry.
        $this->assertSame(
            LinkService::BLOCKED_DESTINATION,
            LinkService::validate(['destination' => $destination.'#anything'])['error'],
        );
        // A different path on the same host is not covered by a URL entry.
        $this->assertTrue(LinkService::validate(['destination' => 'https://evil.example/other'])['ok']);

        // The denylist never keeps a browsing target in clear text.
        $stored = (string) DB::table('destination_denylist')->where('match_kind', 'url')->value('match_value');
        $this->assertMatchesRegularExpression('/^[0-9a-f]{64}$/', $stored);
        $this->assertStringNotContainsString('evil.example', $stored);
    }

    public function test_an_expired_entry_stops_blocking_and_is_revived_in_place(): void
    {
        DestinationDenylist::blockHost('expired.example', 'Temporal', expiresAt: now()->subMinute());
        $this->assertTrue(LinkService::validate(['destination' => 'https://expired.example/a'])['ok']);

        // Re-blocking the same host must update the existing row rather than
        // collide with the unique index.
        $this->assertNotNull(DestinationDenylist::blockHost('expired.example', 'Reabierto'));
        $this->assertSame(
            LinkService::BLOCKED_DESTINATION,
            LinkService::validate(['destination' => 'https://expired.example/a'])['error'],
        );
        $this->assertSame(1, DB::table('destination_denylist')->where('match_value', 'expired.example')->count());
    }

    public function test_fallback_destinations_and_redirect_rules_are_held_to_the_same_rule(): void
    {
        DestinationDenylist::blockHost('evil.example', 'Phishing');

        $fallback = LinkService::validate([
            'destination' => 'https://clean.example/a',
            'fallback_destination' => 'https://evil.example/b',
        ]);
        $this->assertFalse($fallback['ok']);
        $this->assertStringStartsWith('Destino fallback:', (string) $fallback['error']);

        $rule = LinkService::validate([
            'destination' => 'https://clean.example/a',
            'rules' => [['priority' => 0, 'destination' => 'https://evil.example/r']],
        ]);
        $this->assertFalse($rule['ok']);
        $this->assertStringStartsWith('Regla inválida:', (string) $rule['error']);
    }

    public function test_the_redirect_path_is_never_consulted_but_the_link_state_is_enforced(): void
    {
        // A blocked link is refused exactly like one a moderator blocked; the
        // service never runs while a click is being served.
        DestinationDenylist::blockHost('evil.example', 'Phishing');
        $link = $this->link('https://evil.example/a');

        $this->assertSame(DestinationReputationService::OUTCOME_BLOCKED, DestinationReputationService::evaluate($link->id));
        $this->assertSame('blocked', (string) DB::table('links')->where('id', $link->id)->value('state'));
        $this->assertDatabaseHas('audit_events', [
            'action' => 'system.link_block',
            'resource_id' => (string) $link->id,
            'workspace_id' => $this->workspaceId,
        ]);
    }

    public function test_a_suspicious_verdict_opens_exactly_one_moderation_case_without_blocking(): void
    {
        $link = $this->link('https://suspicious.example/a');
        $this->cacheVerdict('https://suspicious.example/a', 'suspicious');

        $this->assertSame(DestinationReputationService::OUTCOME_MODERATED, DestinationReputationService::evaluate($link->id));
        // A signal is a case for a human, not a verdict: the link stays up.
        $this->assertSame('active', (string) DB::table('links')->where('id', $link->id)->value('state'));

        // Re-evaluating must not turn the moderation queue into a mailbox, even
        // though two workers can race to the same link.
        DestinationReputationService::evaluate($link->id);
        $this->assertSame(1, DB::table('abuse_reports')
            ->where('link_id', $link->id)->where('source', 'reputation')->where('status', 'open')->count());
    }

    public function test_only_an_enabled_auto_block_turns_a_malicious_verdict_into_a_block(): void
    {
        $link = $this->link('https://malicious.example/a');
        $this->cacheVerdict('https://malicious.example/a', 'malicious');

        // Default: nothing blocks a link on a signal the deployment did not ask
        // for. The verdict is still recorded and visible.
        config(['uvh.reputation.auto_block' => false]);
        $this->assertSame(DestinationReputationService::OUTCOME_ALLOWED, DestinationReputationService::evaluate($link->id));
        $this->assertSame('active', (string) DB::table('links')->where('id', $link->id)->value('state'));

        config(['uvh.reputation.auto_block' => true]);
        $this->assertSame(DestinationReputationService::OUTCOME_BLOCKED, DestinationReputationService::evaluate($link->id));
        $this->assertSame('blocked', (string) DB::table('links')->where('id', $link->id)->value('state'));
    }

    public function test_an_unconfigured_provider_is_never_reported_as_covering_a_destination(): void
    {
        // No provider at all: the capability is published as not configured and
        // the adapter refuses to invent a verdict.
        $this->getJson('/api/v1/status')->assertOk()
            ->assertJsonPath('externalAnalysis.configured', false)
            ->assertJsonPath('externalAnalysis.enabled', false)
            ->assertJsonPath('externalAnalysis.operational', false)
            ->assertJsonPath('externalAnalysis.status', 'not_configured');

        // Configured but silent: `enabled` is true because the adapter exists,
        // yet nothing has been verified, so it is published as `not_verified`.
        config(['uvh.reputation.provider_url' => 'https://reputation.example.test/api']);
        $this->getJson('/api/v1/status')->assertOk()
            ->assertJsonPath('externalAnalysis.configured', true)
            ->assertJsonPath('externalAnalysis.enabled', true)
            ->assertJsonPath('externalAnalysis.operational', false)
            ->assertJsonPath('externalAnalysis.status', 'not_verified');

        // Once a verdict has actually come back, the claim is supported.
        $this->cacheVerdict('https://suspicious.example/a', 'safe', provider: 'reputation.example.test');
        $this->getJson('/api/v1/status')->assertOk()
            ->assertJsonPath('externalAnalysis.operational', true)
            ->assertJsonPath('externalAnalysis.status', 'operational');
    }

    public function test_the_status_feed_publishes_a_count_and_never_the_denylist_itself(): void
    {
        DestinationDenylist::blockHost('evil.example', 'Phishing confirmado');
        DestinationDenylist::blockUrl('https://evil.example/login', 'Credenciales');

        $response = $this->getJson('/api/v1/status')->assertOk();
        $this->assertSame(2, $response->json('externalAnalysis.denylistEntries'));
        // A count, never an entry: the list is operator data.
        $this->assertStringNotContainsString('evil.example', $response->getContent());
    }

    private function link(string $destination): Link
    {
        return Link::create([
            'workspace_id' => $this->workspaceId,
            'created_by' => $this->userId,
            'alias' => 'rep-'.bin2hex(random_bytes(4)),
            'destination' => $destination,
            'state' => 'active',
        ]);
    }

    private function cacheVerdict(string $destination, string $verdict, string $provider = 'external', int $ttlHours = 24): void
    {
        $key = DestinationDenylist::key($destination);
        $this->assertNotNull($key, "the test destination {$destination} must be a valid destination");
        DB::table('destination_reputation_checks')->insertOrIgnore([
            'url_hash' => $key['url_hash'],
            'host' => $key['host'],
            'verdict' => $verdict,
            'score' => null,
            'provider' => $provider,
            'checked_at' => now(),
            'expires_at' => now()->addHours($ttlHours),
            'failure_count' => 0,
            'last_error' => null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
