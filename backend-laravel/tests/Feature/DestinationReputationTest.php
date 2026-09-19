<?php

namespace Tests\Feature;

use App\Jobs\ContinueDestinationSweepJob;
use App\Models\Link;
use App\Models\User;
use App\Support\DestinationDenylist;
use App\Support\DestinationReputationService;
use App\Support\LinkService;
use Illuminate\Database\QueryException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use ReflectionMethod;
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

    /**
     * An entry is stored in the form the matcher compares against, or not at all.
     *
     * Every value the console can hand over is canonicalised: the case and the
     * trailing dot a browser shows, the `host:port` copied out of an address
     * bar, the pasted URL. What cannot be a host — or a `KIND_URL` entry that is
     * not the hash the matcher computes — is refused, because storing it would
     * show protection in the console that no destination can ever match.
     */
    public function test_an_entry_that_could_never_match_a_destination_is_refused(): void
    {
        $this->assertNotNull(DestinationDenylist::blockHost('EVIL.example.', 'Phishing'));
        $this->assertSame(
            'evil.example',
            DB::table('destination_denylist')->where('match_kind', 'host')->value('match_value'),
        );
        $this->assertSame(
            LinkService::BLOCKED_DESTINATION,
            LinkService::validate(['destination' => 'https://evil.example/login'])['error'],
        );

        // A port belongs to the socket, not to the host entry: without stripping
        // it the row would sit in the console blocking nothing, not even the very
        // destination it was copied from.
        $this->assertNotNull(DestinationDenylist::blockHost('other.example:8443', 'Phishing'));
        $this->assertSame(
            LinkService::BLOCKED_DESTINATION,
            LinkService::validate(['destination' => 'https://other.example:8443/x'])['error'],
        );

        // A pasted URL contributes its host.
        $this->assertNotNull(DestinationDenylist::blockHost('https://third.example/whatever?x=1', 'Phishing'));
        $this->assertSame(
            LinkService::BLOCKED_DESTINATION,
            LinkService::validate(['destination' => 'https://third.example/y'])['error'],
        );

        $this->assertNull(DestinationDenylist::blockHost('not a host', 'Typo'));
        $this->assertNull(DestinationDenylist::blockHost('a..b', 'Typo'));
        $this->assertNull(DestinationDenylist::blockHost('-leading.example', 'Typo'));
        $this->assertNull(DestinationDenylist::add(
            DestinationDenylist::KIND_URL,
            'https://evil.example/x',
            'Typo: un hash, no una URL',
            DestinationDenylist::SOURCE_MANUAL,
        ));
        $this->assertSame(3, DB::table('destination_denylist')->count());
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

    public function test_withdrawing_an_entry_releases_the_links_it_blocked(): void
    {
        $entryId = DestinationDenylist::blockHost('evil.example', 'Phishing confirmado');
        $link = $this->link('https://evil.example/a');
        $this->assertSame(DestinationReputationService::OUTCOME_BLOCKED, DestinationReputationService::evaluate($link->id));

        DestinationDenylist::remove((int) $entryId);

        // An entry that leaves the list leaves no block behind it. Without this,
        // `expires_at` — the temporary block the runbook documents — is permanent
        // for the links it caught, because a blocked link is not re-analysed.
        $this->assertSame(1, DestinationReputationService::releaseUnlistedBlocks());
        $row = DB::table('links')->where('id', $link->id)->first();
        $this->assertSame('active', (string) $row->state);
        $this->assertNull($row->reputation_blocked_at);
        $this->assertNull($row->reputation_block_source);
        $this->assertNull($row->reputation_block_prior_state);
        $this->assertDatabaseHas('audit_events', [
            'action' => 'system.link_release',
            'resource_id' => (string) $link->id,
            'workspace_id' => $this->workspaceId,
        ]);
    }

    public function test_an_entry_that_expires_releases_its_links_without_an_event(): void
    {
        DestinationDenylist::blockHost('temp.example', 'Temporal', expiresAt: now()->addMinutes(10));
        $link = $this->link('https://temp.example/a');
        $this->assertSame(DestinationReputationService::OUTCOME_BLOCKED, DestinationReputationService::evaluate($link->id));

        // Expiry has nothing to hang an event from: nobody acts, the entry just
        // stops applying. The background pass is what notices.
        $this->travel(11)->minutes();

        $this->assertSame(1, DestinationReputationService::releaseUnlistedBlocks());
        $this->assertSame('active', (string) DB::table('links')->where('id', $link->id)->value('state'));
        $this->assertSame(1, DB::table('destination_denylist')->count());
    }

    public function test_a_moderators_block_is_never_withdrawn_by_the_platform(): void
    {
        $entryId = DestinationDenylist::blockHost('evil.example', 'Phishing confirmado');
        $link = $this->link('https://evil.example/a');
        // What a moderator's action leaves behind: a block, and no marker.
        DB::table('links')->where('id', $link->id)->update(['state' => 'blocked']);

        DestinationDenylist::remove((int) $entryId);

        $this->assertSame(0, DestinationReputationService::releaseUnlistedBlocks());
        $row = DB::table('links')->where('id', $link->id)->first();
        $this->assertSame('blocked', (string) $row->state);

        // And the platform does not adopt it as its own on the way past.
        $this->assertSame(DestinationReputationService::OUTCOME_ALLOWED, DestinationReputationService::evaluate($link->id));
        $this->assertNull(DB::table('links')->where('id', $link->id)->value('reputation_blocked_at'));
    }

    public function test_a_link_covered_by_a_second_entry_stays_blocked(): void
    {
        $hostEntry = DestinationDenylist::blockHost('evil.example', 'Phishing');
        DestinationDenylist::blockUrl('https://evil.example/x', 'Credenciales robadas');
        $link = $this->link('https://evil.example/x');
        $this->assertSame(DestinationReputationService::OUTCOME_BLOCKED, DestinationReputationService::evaluate($link->id));

        // Withdrawing one reason is not withdrawing all of them: the release
        // re-evaluates instead of assuming the link is now clean.
        DestinationDenylist::remove((int) $hostEntry);
        $this->assertSame(0, DestinationReputationService::releaseUnlistedBlocks());
        $this->assertSame('blocked', (string) DB::table('links')->where('id', $link->id)->value('state'));

        foreach (DB::table('destination_denylist')->pluck('id') as $id) {
            DestinationDenylist::remove((int) $id);
        }
        $this->assertSame(1, DestinationReputationService::releaseUnlistedBlocks());
        $this->assertSame('active', (string) DB::table('links')->where('id', $link->id)->value('state'));
    }

    public function test_a_release_gives_back_the_state_the_link_had(): void
    {
        DestinationDenylist::blockHost('evil.example', 'Phishing');
        $link = $this->link('https://evil.example/a');
        DB::table('links')->where('id', $link->id)->update(['state' => 'paused']);

        $this->assertSame(DestinationReputationService::OUTCOME_BLOCKED, DestinationReputationService::evaluate($link->id));
        $this->assertSame('paused', (string) DB::table('links')->where('id', $link->id)->value('reputation_block_prior_state'));

        foreach (DB::table('destination_denylist')->pluck('id') as $id) {
            DestinationDenylist::remove((int) $id);
        }
        DestinationReputationService::releaseUnlistedBlocks();

        // A block that landed on a paused link must not republish it: the prior
        // state is stored and honoured, not defaulted to `active`.
        $this->assertSame('paused', (string) DB::table('links')->where('id', $link->id)->value('state'));
    }

    public function test_a_release_never_resurrects_a_deleted_link(): void
    {
        $entryId = DestinationDenylist::blockHost('evil.example', 'Phishing');
        $link = $this->link('https://evil.example/a');
        DestinationReputationService::evaluate($link->id);
        DB::table('links')->where('id', $link->id)->update(['state' => 'deleted', 'deleted_at' => now()]);

        DestinationDenylist::remove((int) $entryId);

        $this->assertSame(0, DestinationReputationService::releaseUnlistedBlocks());
        $this->assertSame('deleted', (string) DB::table('links')->where('id', $link->id)->value('state'));
    }

    public function test_a_provider_block_is_withdrawn_when_its_verdict_stops_supporting_it(): void
    {
        config(['uvh.reputation.auto_block' => true]);
        $link = $this->link('https://malicious.example/a');
        $this->cacheVerdict('https://malicious.example/a', 'malicious');
        $this->assertSame(DestinationReputationService::OUTCOME_BLOCKED, DestinationReputationService::evaluate($link->id));
        $this->assertSame('provider', (string) DB::table('links')->where('id', $link->id)->value('reputation_block_source'));

        // The provider changes its mind: the block was the platform's own
        // decision, so the platform is allowed to take it back.
        DB::table('destination_reputation_checks')
            ->where('host', 'malicious.example')
            ->update(['verdict' => 'safe', 'checked_at' => now(), 'expires_at' => now()->addHour()]);
        $this->assertSame(DestinationReputationService::OUTCOME_RELEASED, DestinationReputationService::evaluate($link->id));
        $this->assertSame('active', (string) DB::table('links')->where('id', $link->id)->value('state'));

        // Disabling automatic blocking is the other way the ground disappears,
        // and it is not a licence to keep the link down forever.
        DB::table('destination_reputation_checks')
            ->where('host', 'malicious.example')
            ->update(['verdict' => 'malicious', 'checked_at' => now(), 'expires_at' => now()->addHour()]);
        $this->assertSame(DestinationReputationService::OUTCOME_BLOCKED, DestinationReputationService::evaluate($link->id));
        config(['uvh.reputation.auto_block' => false]);
        $this->assertSame(DestinationReputationService::OUTCOME_RELEASED, DestinationReputationService::evaluate($link->id));
    }

    public function test_a_release_happens_once_even_when_two_workers_arrive_together(): void
    {
        $entryId = DestinationDenylist::blockHost('evil.example', 'Phishing');
        $link = $this->link('https://evil.example/a');
        DestinationReputationService::evaluate($link->id);
        DestinationDenylist::remove((int) $entryId);

        DestinationReputationService::releaseUnlistedBlocks();
        // The second pass finds nothing to release: the marker is what the
        // transition is keyed on, not a read-then-write assumption.
        $this->assertSame(0, DestinationReputationService::releaseUnlistedBlocks());
        $this->assertSame(1, DB::table('audit_events')
            ->where('action', 'system.link_release')->where('resource_id', (string) $link->id)->count());
    }

    public function test_the_marker_cannot_be_written_half_way(): void
    {
        // A marker without its reason would be a block nobody can withdraw, and
        // one without its prior state would republish a paused link as active.
        $link = $this->link('https://half.example/a');

        $this->expectException(QueryException::class);
        DB::table('links')->where('id', $link->id)->update(['reputation_blocked_at' => now()]);
    }

    /**
     * A new entry has to reach the links that already exist, and the answer has
     * to distinguish "done" from "stopped at the budget".
     *
     * The endpoint used to report `linksScheduled: 500` whether it had swept a
     * host with 40 links or one with 40,000, so a partial block read exactly
     * like a complete one and the operator had no reason to look again.
     */
    public function test_a_destination_block_reaches_every_existing_link_or_says_it_could_not(): void
    {
        $this->link('https://viral.example/a');
        $this->link('https://viral.example/b');

        // Two links, room for one: the sweep has to admit it stopped.
        $partial = DestinationReputationService::reanalyzeHost('viral.example', budget: 1);
        $this->assertSame(1, $partial['scheduled']);
        $this->assertTrue($partial['truncated']);
        $this->assertSame(1, (int) DB::table('operational_metrics')
            ->where('metric', 'reputation.reanalysis_truncated')->sum('count'));

        // With room for the whole set, the answer says the block propagated.
        $complete = DestinationReputationService::reanalyzeHost('viral.example', budget: 50);
        $this->assertSame(2, $complete['scheduled']);
        $this->assertFalse($complete['truncated']);

        // A host nobody points at is an empty sweep, not a truncated one, and it
        // leaves the cursor where it was.
        $this->assertSame(
            ['scheduled' => 0, 'truncated' => false, 'cursor' => 0],
            DestinationReputationService::reanalyzeHost('quiet.example', budget: 50),
        );

        // The two sources share one budget, because the budget bounds the work
        // the sweep creates, not each query.
        $direct = $this->link('https://mixed.example/x');
        $viaRule = $this->link('https://elsewhere.example/y');
        DB::table('redirect_rules')->insert([
            'link_id' => $viaRule->id,
            'priority' => 1,
            'destination' => 'https://mixed.example/z',
            'created_at' => now(),
        ]);

        $union = DestinationReputationService::reanalyzeHost('mixed.example', budget: 1);
        $this->assertTrue($union['truncated']);
        $this->assertSame(1, $union['scheduled']);
        $this->assertNotNull($direct->id);
    }

    public function test_a_public_suffix_cannot_become_a_host_entry(): void
    {
        // Measured before the fix: `hostCandidates('evil.co.uk')` returned
        // `['evil.co.uk', 'co.uk']`, so one row could have taken every site
        // under a public suffix offline.
        $this->assertNull(DestinationDenylist::blockHost('co.uk', 'Typo'));
        $this->assertNull(DestinationDenylist::blockHost('github.io', 'Typo'));
        $this->assertSame(0, DB::table('destination_denylist')->count());

        // The capability is not removed, only the blast radius: a concrete host
        // under the same suffix still covers its own subdomains.
        $this->assertNotNull(DestinationDenylist::blockHost('evil.co.uk', 'Phishing'));
        $this->assertSame(
            LinkService::BLOCKED_DESTINATION,
            LinkService::validate(['destination' => 'https://pay.evil.co.uk/a'])['error'],
        );
        $this->assertTrue(LinkService::validate(['destination' => 'https://notevil.co.uk/a'])['ok']);

        // And one exact page on a shared platform is still blockable by URL.
        $this->assertNotNull(DestinationDenylist::blockUrl('https://x.github.io/bad', 'Phishing'));
        $this->assertSame(
            LinkService::BLOCKED_DESTINATION,
            LinkService::validate(['destination' => 'https://x.github.io/bad'])['error'],
        );
        $this->assertTrue(LinkService::validate(['destination' => 'https://x.github.io/other'])['ok']);
    }

    public function test_a_stale_row_is_not_a_verdict_once_the_provider_is_gone(): void
    {
        // With no provider configured the honest answer is `unknown`, and it has
        // to stay that way for a row whose window has passed: returning the row
        // made the cache outlive its own contract, so switching the provider off
        // left its expired verdicts deciding.
        $this->cacheVerdict('https://stale.example/one', 'malicious', ttlHours: -1);

        $verdict = DestinationReputationService::verdictFor('https://stale.example/one');
        $this->assertSame('unknown', $verdict->verdict());
        $this->assertSame('provider_not_configured', $verdict->error());

        // A row that is still inside its window is a fact with a validity date,
        // and it keeps being one: only the expired case changes.
        $this->cacheVerdict('https://fresh.example/one', 'malicious');
        $this->assertSame('malicious', DestinationReputationService::verdictFor('https://fresh.example/one')->verdict());
    }

    public function test_a_provider_outage_never_lifts_a_block(): void
    {
        config([
            'uvh.reputation.auto_block' => true,
            'uvh.reputation.provider_url' => 'https://reputation.example.test/api',
        ]);
        $link = $this->link('https://malicious.example/outage');
        $this->cacheVerdict('https://malicious.example/outage', 'malicious', provider: 'reputation.example.test');
        $this->assertSame(DestinationReputationService::OUTCOME_BLOCKED, DestinationReputationService::evaluate($link->id));

        // The provider stops answering anything usable — 503, timeout, or a body
        // outside the contract — and the verdict's window passes with it.
        DB::table('destination_reputation_checks')
            ->where('host', 'malicious.example')
            ->update(['expires_at' => now()->subMinute()]);
        Http::fake(['reputation.example.test/*' => Http::response('', 503)]);

        $outcome = DestinationReputationService::evaluate($link->id);

        // Absence of evidence is not evidence of absence: the block stands.
        // Reading `unknown` as "no longer malicious" republished every link a
        // provider had flagged, on any third-party hiccup.
        $this->assertSame(DestinationReputationService::OUTCOME_ALLOWED, $outcome);
        $this->assertSame('blocked', (string) DB::table('links')->where('id', $link->id)->value('state'));
        $this->assertSame('provider', (string) DB::table('links')->where('id', $link->id)->value('reputation_block_source'));
    }

    public function test_a_provider_block_is_still_withdrawn_on_evidence_that_its_ground_is_gone(): void
    {
        // The other side of the same rule, so the fix cannot be "never release":
        // a definitive answer that no longer supports the block releases it.
        config(['uvh.reputation.auto_block' => true]);
        $link = $this->link('https://cleared.example/a');
        $this->cacheVerdict('https://cleared.example/a', 'malicious');
        $this->assertSame(DestinationReputationService::OUTCOME_BLOCKED, DestinationReputationService::evaluate($link->id));

        DB::table('destination_reputation_checks')
            ->where('host', 'cleared.example')
            ->update(['verdict' => 'safe', 'checked_at' => now(), 'expires_at' => now()->addHour()]);

        $this->assertSame(DestinationReputationService::OUTCOME_RELEASED, DestinationReputationService::evaluate($link->id));
        $this->assertSame('active', (string) DB::table('links')->where('id', $link->id)->value('state'));
    }

    public function test_a_verdict_is_never_applied_to_a_link_that_changed_under_it(): void
    {
        // The window being tested is the one between the evaluation's read and
        // its write, which is where a destination change lands: the verdict was
        // computed for `malware.example` and the row now points somewhere else.
        // Driving the private entry point is what makes that instant testable at
        // all; the guard it exercises is the same one the evaluation goes
        // through.
        config(['uvh.reputation.auto_block' => true]);
        $link = $this->link('https://malware.example/changed');
        $this->cacheVerdict('https://malware.example/changed', 'malicious');

        $snapshot = DB::table('links')->where('id', $link->id)->first();
        DB::table('links')->where('id', $link->id)->update([
            'destination' => 'https://safe.example/elsewhere',
            'version' => DB::raw('version + 1'),
        ]);

        $block = new ReflectionMethod(DestinationReputationService::class, 'block');
        $this->assertSame('stale', $block->invoke(null, $snapshot, 'provider', 'Señal de reputación external'));
        $this->assertSame('active', (string) DB::table('links')->where('id', $link->id)->value('state'));
        $this->assertNull(DB::table('links')->where('id', $link->id)->value('reputation_blocked_at'));
        $this->assertSame(0, (int) DB::table('audit_events')->where('action', 'system.link_block')->count());
        $this->assertSame(1, (int) DB::table('operational_metrics')
            ->where('metric', 'reputation.decision_discarded')->sum('count'));

        // A link that did not move is still blocked exactly as before.
        $fresh = DB::table('links')->where('id', $link->id)->first();
        $this->assertSame('applied', $block->invoke(null, $fresh, 'provider', 'Señal de reputación external'));
        $this->assertSame('blocked', (string) DB::table('links')->where('id', $link->id)->value('state'));
    }

    public function test_the_sweep_advances_instead_of_re_examining_the_same_window(): void
    {
        config(['uvh.reputation.provider_url' => 'https://reputation.example.test/api']);

        // A batch of two looks at a window of eight (limit * 4). Filling that
        // window with fresh verdicts is what used to starve everything behind
        // it: the same eight rows were read on every tick, because being
        // examined does not update a link.
        $busy = [];
        for ($i = 0; $i < 8; $i++) {
            $busy[] = $this->link('https://busy.example/'.$i)->id;
            $this->cacheVerdict('https://busy.example/'.$i, 'safe', provider: 'reputation.example.test');
        }
        DB::table('links')->whereIn('id', $busy)->update(['updated_at' => now()->subDay()]);

        // The ninth link is the one whose verdict expired — the row that never
        // came into view.
        $stale = $this->link('https://stale.example/only');
        $this->cacheVerdict('https://stale.example/only', 'malicious', provider: 'reputation.example.test', ttlHours: -1);

        $examined = [];
        for ($tick = 0; $tick < 12; $tick++) {
            foreach (DestinationReputationService::staleLinkIds(2) as $id) {
                $examined[] = $id;
            }
        }

        $this->assertContains($stale->id, $examined, 'the sweep has to reach a link beyond the first window');
        $this->assertNotNull(DB::table('links')->where('id', $stale->id)->value('reputation_checked_at'));
    }

    public function test_a_truncated_propagation_carries_the_cursor_forward(): void
    {
        Queue::fake();
        DestinationDenylist::blockHost('viral.example', 'Phishing');
        foreach (range(0, 2) as $i) {
            $this->link('https://viral.example/'.$i);
        }

        $sweep = DestinationReputationService::reanalyzeHost('viral.example', budget: 2);
        $this->assertTrue($sweep['truncated']);
        $this->assertSame(2, $sweep['scheduled']);
        Queue::assertPushed(
            ContinueDestinationSweepJob::class,
            fn (ContinueDestinationSweepJob $job) => $job->host === 'viral.example' && $job->afterId === $sweep['cursor'],
        );

        // Resuming from that cursor reaches the rest, and the second pass knows
        // it finished.
        $rest = DestinationReputationService::reanalyzeHost('viral.example', 2, $sweep['cursor']);
        $this->assertFalse($rest['truncated']);
        $this->assertSame(1, $rest['scheduled']);
    }

    public function test_the_propagation_finishes_without_any_reputation_provider(): void
    {
        // The denylist is a local decision, and the background sweep that was
        // supposed to finish a truncated propagation does not even run without a
        // provider: the links beyond the budget stayed live in a deployment that
        // had switched the provider off. The continuation runs on the queue with
        // the sync driver here, so the chain is exercised end to end.
        $this->assertFalse(DestinationReputationService::provider()->configured());
        DestinationDenylist::blockHost('viral.example', 'Phishing');
        foreach (range(0, 2) as $i) {
            $this->link('https://viral.example/'.$i);
        }

        $sweep = DestinationReputationService::reanalyzeHost('viral.example', budget: 2);
        $this->assertTrue($sweep['truncated']);

        $this->assertSame(3, (int) DB::table('operational_metrics')
            ->where('metric', 'reputation.reanalysis_scheduled')->sum('count'));
        $this->assertSame(3, (int) DB::table('links')->where('state', 'blocked')->count());
        $this->assertSame(1, (int) DB::table('operational_metrics')
            ->where('metric', 'reputation.reanalysis_truncated')->sum('count'));
    }

    public function test_the_sweep_does_not_rewrite_the_row_it_looked_at(): void
    {
        // `updated_at` means "this row changed", and a background reader must
        // not claim that: rewriting it would push every examined link to the top
        // of every list ordered by activity, including the panel's.
        config(['uvh.reputation.provider_url' => 'https://reputation.example.test/api']);
        $link = $this->link('https://quiet.example/a');
        $this->cacheVerdict('https://quiet.example/a', 'safe', provider: 'reputation.example.test');
        DB::table('links')->where('id', $link->id)->update(['updated_at' => now()->subDay()]);

        DestinationReputationService::staleLinkIds(2);

        $row = DB::table('links')->where('id', $link->id)->first(['updated_at', 'reputation_checked_at']);
        $this->assertTrue(Carbon::parse($row->updated_at)->lt(now()->subHours(12)));
        $this->assertNotNull($row->reputation_checked_at);
    }

    public function test_the_queue_only_sees_a_link_the_evaluation_finished(): void
    {
        // A job that never got to run leaves the cursor where it was, so the
        // sweep comes back to it: a failed lookup must not retire a link.
        $link = $this->link('https://never.example/a');
        $this->assertNull(DB::table('links')->where('id', $link->id)->value('reputation_checked_at'));

        DestinationReputationService::evaluate($link->id);
        $this->assertNotNull(DB::table('links')->where('id', $link->id)->value('reputation_checked_at'));

        $missing = DestinationReputationService::evaluate(999_999);
        $this->assertSame(DestinationReputationService::OUTCOME_MISSING, $missing);
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
