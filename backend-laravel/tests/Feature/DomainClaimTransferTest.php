<?php

namespace Tests\Feature;

use App\Jobs\DnsStub;
use App\Jobs\DnsViews;
use App\Jobs\VerifyDomainDnsJob;
use App\Models\CustomDomain;
use App\Models\CustomDomainClaim;
use App\Models\User;
use App\Models\Workspace;
use App\Support\DomainEvents;
use App\Support\Ids;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

/**
 * A hostname changing hands, as events and routes.
 *
 * When a claim moves because the previous holder stopped proving ownership,
 * the loss is the *old* workspace's fact and must be recorded against the old
 * workspace's rows: their activity timeline must find it, and the notification
 * must route to a domain they can actually open. Cross-tenant ids never travel
 * in the payload. The acquiring workspace gets its own `domain.claimed`, once
 * per transition. The DNS resolver is the namespaced stub, so the whole
 * verification path runs in process. Regression contracts: run only with the
 * isolated *_test DB guard.
 */
final class DomainClaimTransferTest extends TestCase
{
    private const TOKEN_B = 'uvh-verify=Takeover1234abcd';

    protected function setUp(): void
    {
        parent::setUp(); // Refuses non-*_test databases before fixture writes.
        require_once dirname(__DIR__).'/Support/dns-stub.php';
        DnsStub::reset();
        DnsViews::reset();
        DB::statement('TRUNCATE users, sessions, workspaces, memberships, quotas, links, custom_domains, custom_domain_claims, domain_events, notifications, notification_preferences, mail_outbox, audit_events, operational_metrics RESTART IDENTITY CASCADE');
        config([
            'uvh.custom_domains.cname_target' => 'edge.example.test',
            'uvh.custom_domains.claim_fresh_days' => 30,
        ]);
        Queue::fake();
    }

    protected function tearDown(): void
    {
        // Estado estático: sin limpiar, el stub filtraría a otras suites.
        DnsStub::reset();
        DnsViews::reset();
        parent::tearDown();
    }

    public function test_a_takeover_records_the_loss_against_the_displaced_workspace_rows(): void
    {
        $host = 'go-'.strtolower(Ids::randomToken(6)).'.example.test';
        [$ownerA, $workspaceA] = $this->workspace('A');
        [$ownerB, $workspaceB] = $this->workspace('B');
        // The previous holder has not proven ownership for 40 days.
        CustomDomainClaim::create([
            'workspace_id' => $workspaceA->id, 'domain' => $host,
            'claimed_at' => now()->subDays(40), 'last_proven_at' => now()->subDays(40),
        ]);
        $rowA = $this->row($workspaceA->id, $host, 'uvh-verify=OldOwner1234abcd', [
            'ownership_status' => 'verified', 'routing_status' => 'healthy',
            'verified_at' => Carbon::now()->subDays(40), 'ownership_verified_at' => Carbon::now()->subDays(40),
            'routing_verified_at' => Carbon::now()->subDays(40), 'edge_eligible' => true,
            'tls_status' => 'ready', 'tls_ready_at' => Carbon::now()->subDays(40),
        ]);
        $rowB = $this->row($workspaceB->id, $host, self::TOKEN_B);

        $this->verify((int) $rowB->id, (int) $workspaceB->id, $ownerB, $host, self::TOKEN_B);

        // The claim moved and the displaced rows were demoted.
        $this->assertSame((int) $workspaceB->id, (int) CustomDomainClaim::whereRaw('lower(domain) = ?', [$host])->first()->workspace_id);
        $freshA = $rowA->refresh();
        $this->assertSame('lost', $freshA->ownership_status);
        $this->assertSame('claim_transferred', $freshA->dns_error);
        $this->assertFalse((bool) $freshA->edge_eligible);

        // The loss is the old workspace's fact, against the old workspace's row.
        $transfer = DB::table('domain_events')->where('event', 'domain.claim_transferred')->first();
        $this->assertNotNull($transfer);
        $this->assertSame((int) $workspaceA->id, (int) $transfer->workspace_id);
        $this->assertSame((int) $rowA->id, (int) $transfer->domain_id);
        $payload = json_decode((string) $transfer->payload, true);
        $this->assertSame((int) $rowA->id, (int) ($payload['domainId'] ?? 0));
        $this->assertSame($host, $payload['domain'] ?? null);
        $this->assertArrayNotHasKey('previousWorkspaceId', $payload);
        $this->assertArrayNotHasKey('newWorkspaceId', $payload);

        // `GET /domains/{oldRow}/activity` finds it (same predicate as the API).
        $this->assertSame(1, DB::table('domain_events')
            ->where('workspace_id', $workspaceA->id)->where('domain_id', $rowA->id)->count());

        // The acquiring workspace gets its own event against its own row.
        $claimed = DB::table('domain_events')->where('event', 'domain.claimed')->first();
        $this->assertNotNull($claimed);
        $this->assertSame((int) $workspaceB->id, (int) $claimed->workspace_id);
        $this->assertSame((int) $rowB->id, (int) $claimed->domain_id);
    }

    public function test_the_displaced_owner_notification_routes_to_their_own_domain_row(): void
    {
        $host = 'move-'.strtolower(Ids::randomToken(6)).'.example.test';
        [$ownerA, $workspaceA] = $this->workspace('A');
        [$ownerB, $workspaceB] = $this->workspace('B');
        CustomDomainClaim::create([
            'workspace_id' => $workspaceA->id, 'domain' => $host,
            'claimed_at' => now()->subDays(40), 'last_proven_at' => now()->subDays(40),
        ]);
        $rowA = $this->row($workspaceA->id, $host, 'uvh-verify=OldOwner1234abcd');
        $rowB = $this->row($workspaceB->id, $host, self::TOKEN_B);

        $this->verify((int) $rowB->id, (int) $workspaceB->id, $ownerB, $host, self::TOKEN_B);

        $transfer = DB::table('domain_events')->where('event', 'domain.claim_transferred')->first();
        $this->assertTrue(DomainEvents::deliver((int) $transfer->id));

        $notice = DB::table('notifications')->where('kind', 'domain_claim_transferred')->first();
        $this->assertNotNull($notice);
        $this->assertSame((int) $ownerA->id, (int) $notice->user_id);
        $this->assertSame('/app/domains/'.(int) $rowA->id, (string) $notice->route);
    }

    public function test_claimed_is_recorded_once_per_transition_not_per_revalidation(): void
    {
        $host = 'once-'.strtolower(Ids::randomToken(6)).'.example.test';
        [$ownerB, $workspaceB] = $this->workspace('B');
        $rowB = $this->row($workspaceB->id, $host, self::TOKEN_B);

        $this->verify((int) $rowB->id, (int) $workspaceB->id, $ownerB, $host, self::TOKEN_B);
        // A routine revalidation of a claim that is already yours is not news.
        $this->verify((int) $rowB->id, (int) $workspaceB->id, $ownerB, $host, self::TOKEN_B);

        $this->assertSame(1, DB::table('domain_events')->where('event', 'domain.claimed')->count());
        $this->assertSame(1, DB::table('domain_events')->where('event', 'domain.verified')->count());
        $this->assertSame(0, DB::table('domain_events')->where('event', 'domain.claim_transferred')->count());
    }

    public function test_a_fresh_claim_elsewhere_is_reported_not_stolen(): void
    {
        $host = 'busy-'.strtolower(Ids::randomToken(6)).'.example.test';
        [, $workspaceA] = $this->workspace('A');
        [$ownerB, $workspaceB] = $this->workspace('B');
        CustomDomainClaim::create([
            'workspace_id' => $workspaceA->id, 'domain' => $host,
            'claimed_at' => now(), 'last_proven_at' => now(),
        ]);
        $rowB = $this->row($workspaceB->id, $host, self::TOKEN_B);

        $this->verify((int) $rowB->id, (int) $workspaceB->id, $ownerB, $host, self::TOKEN_B);

        $this->assertSame((int) $workspaceA->id, (int) CustomDomainClaim::whereRaw('lower(domain) = ?', [$host])->first()->workspace_id);
        $this->assertSame('domain_claimed_elsewhere', $rowB->refresh()->dns_error);
        $this->assertSame(0, DB::table('domain_events')->where('event', 'domain.claim_transferred')->count());
        $this->assertSame(0, DB::table('domain_events')->where('event', 'domain.claimed')->count());
    }

    /** @return array{User, Workspace} */
    private function workspace(string $label): array
    {
        $user = User::factory()->create();
        $workspace = $user->ownedWorkspaces()->create([
            'name' => 'Claim '.$label, 'slug' => 'claim-'.strtolower($label).'-'.Ids::randomToken(8),
        ]);
        $workspace->memberships()->create(['user_id' => $user->id, 'role' => 'owner']);
        $workspace->quota()->create(['links_limit' => 100]);

        return [$user, $workspace];
    }

    /**
     * @param  array<string, mixed>  $extra
     */
    private function row(int $workspaceId, string $host, string $token, array $extra = []): CustomDomain
    {
        return CustomDomain::create(array_merge([
            'workspace_id' => $workspaceId,
            'domain' => $host,
            'verification_token' => $token,
            'verification_version' => 1,
            'verification_scheme' => 2,
            'desired_state' => 'enabled',
            'ownership_status' => 'pending',
            'routing_status' => 'failed',
            'tls_status' => 'pending',
        ], $extra));
    }

    private function verify(int $domainId, int $workspaceId, User $user, string $host, string $token): void
    {
        DnsStub::reset();
        DnsStub::txt('_uvh-verification.'.$host, $token);
        DnsStub::cname($host, 'edge.example.test');

        (new VerifyDomainDnsJob(
            domainId: $domainId,
            workspaceId: $workspaceId,
            requestedBy: (int) $user->id,
            actorSecurityVersion: (int) $user->security_version,
            apiTokenId: null,
            domain: $host,
            verificationToken: $token,
            verificationScheme: 2,
            verificationVersion: 1,
            dedupeKey: 'claim-transfer-'.$domainId,
            dedupeOwner: 'claim-owner-'.$domainId,
        ))->handle();
    }
}
