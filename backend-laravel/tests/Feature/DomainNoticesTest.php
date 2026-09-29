<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\DomainNotices;
use App\Support\Ids;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Domain notices obey each recipient's notification preferences, exactly:
 * `immediate` mails now, `daily_digest` waits for the digest, `in_app_only`
 * never mails and `disabled` is silence — while mandatory kinds reach
 * everyone. The re-delivery of one event (same stable event identity) must
 * never duplicate an inbox row or a mail. Regression contracts: run only with
 * the isolated *_test DB guard.
 */
final class DomainNoticesTest extends TestCase
{
    private User $owner;

    private int $workspaceId;

    protected function setUp(): void
    {
        parent::setUp(); // Refuses non-*_test databases before fixture writes.
        DB::statement('TRUNCATE users, sessions, workspaces, memberships, quotas, custom_domains, custom_domain_claims, domain_events, notifications, notification_preferences, mail_outbox, audit_events RESTART IDENTITY CASCADE');
        $this->owner = User::factory()->create();
        $workspace = $this->owner->ownedWorkspaces()->create([
            'name' => 'Notices', 'slug' => 'notices-'.Ids::randomToken(8),
        ]);
        $workspace->memberships()->create(['user_id' => $this->owner->id, 'role' => 'owner']);
        $this->workspaceId = (int) $workspace->id;
    }

    public function test_an_immediate_preference_gets_the_inbox_row_and_the_mail_now(): void
    {
        DomainNotices::deliver($this->event('domain.tls_failed'), ['reason' => 'certificate_probe_failed']);

        $this->assertSame(1, DB::table('notifications')->where('user_id', $this->owner->id)->where('kind', 'domain_tls_failed')->count());
        $this->assertSame(1, DB::table('mail_outbox')->where('kind', 'domain_tls_failed')->count());
    }

    public function test_a_daily_digest_preference_gets_the_row_but_no_mail_now(): void
    {
        $this->prefer($this->owner->id, 'domain_tls_failed', 'daily_digest');

        DomainNotices::deliver($this->event('domain.tls_failed'), ['reason' => 'certificate_probe_failed']);

        $row = DB::table('notifications')->where('user_id', $this->owner->id)->where('kind', 'domain_tls_failed')->first();
        $this->assertNotNull($row);
        // Still digestible: the daily digest is the deferred mail channel.
        $this->assertNull($row->digested_at);
        $this->assertSame(0, DB::table('mail_outbox')->count());
    }

    public function test_an_in_app_only_preference_never_mails(): void
    {
        $this->prefer($this->owner->id, 'domain_tls_failed', 'in_app_only');

        DomainNotices::deliver($this->event('domain.tls_failed'), ['reason' => 'certificate_probe_failed']);

        $row = DB::table('notifications')->where('user_id', $this->owner->id)->where('kind', 'domain_tls_failed')->first();
        $this->assertNotNull($row);
        $this->assertNotNull($row->digested_at); // sealed: not digestible either
        $this->assertSame(0, DB::table('mail_outbox')->count());
    }

    public function test_a_disabled_preference_gets_nothing(): void
    {
        $this->prefer($this->owner->id, 'domain_tls_failed', 'disabled');

        DomainNotices::deliver($this->event('domain.tls_failed'), ['reason' => 'certificate_probe_failed']);

        $this->assertSame(0, DB::table('notifications')->where('user_id', $this->owner->id)->count());
        $this->assertSame(0, DB::table('mail_outbox')->count());
    }

    public function test_mandatory_domain_offline_reaches_everyone_even_when_silenced(): void
    {
        // The user tried to silence everything operational; a domain going
        // down is a mandatory notice and preferences cannot disable it.
        $this->prefer($this->owner->id, 'domain_offline', 'disabled');

        DomainNotices::deliver($this->event('domain.offline'), ['reason' => 'routing_missing']);

        $this->assertSame(1, DB::table('notifications')->where('user_id', $this->owner->id)->where('kind', 'domain_offline')->count());
        $this->assertSame(1, DB::table('mail_outbox')->where('kind', 'domain_offline')->count());
    }

    public function test_each_recipient_gets_their_own_row_and_mail(): void
    {
        $admin = $this->member('admin');

        DomainNotices::deliver($this->event('domain.tls_failed'), ['reason' => 'certificate_probe_failed']);

        $this->assertSame(2, DB::table('notifications')->where('kind', 'domain_tls_failed')->count());
        $this->assertSame(2, DB::table('mail_outbox')->where('kind', 'domain_tls_failed')->count());
        $generations = DB::table('mail_outbox')->where('kind', 'domain_tls_failed')->pluck('resource_generation')->all();
        $this->assertCount(2, array_unique($generations));
        $joined = implode('|', array_map('strval', $generations));
        $this->assertStringContainsString((string) $this->owner->id.':', $joined);
        $this->assertStringContainsString((string) $admin->id.':', $joined);
    }

    public function test_a_redelivered_event_never_duplicates_rows_or_mail(): void
    {
        $event = $this->event('domain.offline', ['reason' => 'routing_missing']);

        DomainNotices::deliver($event, ['reason' => 'routing_missing']);
        DomainNotices::deliver($event, ['reason' => 'routing_missing']);

        $this->assertSame(1, DB::table('notifications')->where('kind', 'domain_offline')->count());
        $this->assertSame(1, DB::table('mail_outbox')->where('kind', 'domain_offline')->count());
    }

    private function member(string $role): User
    {
        $user = User::factory()->create();
        DB::table('memberships')->insert([
            'workspace_id' => $this->workspaceId,
            'user_id' => $user->id,
            'role' => $role,
        ]);

        return $user;
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function event(string $eventName, array $payload = []): object
    {
        return (object) [
            'workspace_id' => $this->workspaceId,
            'domain_id' => 42,
            'domain' => 'shop.example.test',
            'event' => $eventName,
            'event_uuid' => (string) Str::uuid(),
            'payload' => json_encode($payload),
            'created_at' => Carbon::now(),
        ];
    }

    private function prefer(int $userId, string $kind, string $delivery): void
    {
        DB::table('notification_preferences')->insert([
            'user_id' => $userId,
            'kind' => $kind,
            'delivery' => $delivery,
            'updated_at' => now(),
        ]);
    }
}
