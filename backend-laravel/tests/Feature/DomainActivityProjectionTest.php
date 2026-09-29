<?php

namespace Tests\Feature;

use App\Models\CustomDomain;
use App\Models\User;
use App\Models\Workspace;
use App\Support\Ids;
use App\Support\SessionManager;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * `GET /domains/{id}/activity` projects the outbox payload instead of
 * exposing it. The raw payload is internal — cross-tenant workspace ids travel
 * in it during a claim transfer — and the timeline a member reads is a
 * documented surface: only the catalogued keys survive, per event, and a
 * viewer can never see another tenant's ids. Regression contracts: run only
 * with the isolated *_test DB guard.
 */
final class DomainActivityProjectionTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp(); // Refuses non-*_test databases before fixture writes.
        DB::statement('TRUNCATE users, sessions, workspaces, memberships, quotas, custom_domains, custom_domain_claims, domain_events, audit_events RESTART IDENTITY CASCADE');
        $this->disableCookieEncryption();
        $this->withCredentials();
    }

    public function test_only_the_documented_payload_keys_reach_the_timeline(): void
    {
        [$viewer, $workspace] = $this->workspace();
        $domain = $this->row((int) $workspace->id);
        $grace = now()->addHour()->toIso8601String();
        $notAfter = now()->addDays(9)->toIso8601String();
        $this->event((int) $workspace->id, (int) $domain->id, 'domain.degraded', [
            'domainId' => (int) $domain->id, 'domain' => $domain->domain,
            'reason' => 'routing_missing', 'failureCount' => 2, 'graceExpiresAt' => $grace,
            // Internal fields a producer may carry.
            'previousWorkspaceId' => 7, 'newWorkspaceId' => 9,
            'internalNote' => 'never leaves the platform',
        ]);
        $this->event((int) $workspace->id, (int) $domain->id, 'domain.claim_transferred', [
            'domainId' => 41, 'domain' => $domain->domain, 'reason' => 'claim_transferred',
            'previousWorkspaceId' => 5, 'newWorkspaceId' => 6,
        ]);
        $this->event((int) $workspace->id, (int) $domain->id, 'domain.tls_expiring', [
            'domainId' => (int) $domain->id, 'domain' => $domain->domain,
            'notAfter' => $notAfter, 'daysRemaining' => 9,
        ]);
        $this->event((int) $workspace->id, (int) $domain->id, 'domain.verified', [
            'domainId' => (int) $domain->id, 'domain' => $domain->domain,
        ]);

        $this->signIn($viewer, $workspace);
        $response = $this->getJson('/api/v1/domains/'.$domain->id.'/activity')->assertOk();
        $events = collect($response->json('events'))->keyBy('event');

        $this->assertSame(
            ['reason' => 'routing_missing', 'failureCount' => 2, 'graceExpiresAt' => $grace],
            $events['domain.degraded']['payload'],
        );
        $this->assertSame(['reason' => 'claim_transferred'], $events['domain.claim_transferred']['payload']);
        $this->assertSame(
            ['notAfter' => $notAfter, 'daysRemaining' => 9],
            $events['domain.tls_expiring']['payload'],
        );
        $this->assertSame([], $events['domain.verified']['payload']);

        $body = $response->getContent();
        foreach (['previousWorkspaceId', 'newWorkspaceId', 'internalNote', 'never leaves'] as $forbidden) {
            $this->assertStringNotContainsString($forbidden, $body);
        }
    }

    public function test_a_viewer_cannot_read_another_workspaces_timeline(): void
    {
        [$viewer, $workspace] = $this->workspace();
        [, $other] = $this->workspace();
        $foreign = $this->row((int) $other->id);

        $this->signIn($viewer, $workspace);
        $this->getJson('/api/v1/domains/'.$foreign->id.'/activity')->assertNotFound();
    }

    /** @return array{User, Workspace} */
    private function workspace(): array
    {
        $user = User::factory()->create(['email_verified_at' => now()]);
        $workspace = $user->ownedWorkspaces()->create([
            'name' => 'Activity', 'slug' => 'activity-'.strtolower(Ids::randomToken(8)),
        ]);
        $workspace->memberships()->create(['user_id' => $user->id, 'role' => 'owner']);
        $workspace->quota()->create(['links_limit' => 100]);

        return [$user, $workspace];
    }

    private function row(int $workspaceId): CustomDomain
    {
        return CustomDomain::create([
            'workspace_id' => $workspaceId,
            'domain' => 'act-'.strtolower(Ids::randomToken(6)).'.example.test',
            'verification_token' => 'uvh-verify=Activity1234',
            'verification_version' => 1,
            'verification_scheme' => 2,
            'desired_state' => 'enabled',
            'ownership_status' => 'pending',
            'routing_status' => 'failed',
            'tls_status' => 'pending',
        ]);
    }

    /** @param  array<string, mixed>  $payload */
    private function event(int $workspaceId, int $domainId, string $event, array $payload): void
    {
        DB::table('domain_events')->insert([
            'workspace_id' => $workspaceId,
            'domain_id' => $domainId,
            'domain' => 'act.example.test',
            'event' => $event,
            'event_uuid' => (string) Str::uuid(),
            'payload' => json_encode($payload),
            'created_at' => now(),
            'next_attempt_at' => now(),
        ]);
    }

    private function signIn(User $user, Workspace $workspace): void
    {
        $this->withCookie('uvh_session', SessionManager::create($user->id, Request::create('/'), (int) $user->security_version, true));
        $this->withHeader('X-Workspace-Id', (string) $workspace->id);
    }
}
