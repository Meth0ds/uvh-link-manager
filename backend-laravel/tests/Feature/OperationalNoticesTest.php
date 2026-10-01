<?php

namespace Tests\Feature;

use App\Models\ApiToken;
use App\Models\Invitation;
use App\Models\Link;
use App\Models\User;
use App\Models\Webhook;
use App\Models\WebhookDelivery;
use App\Support\Ids;
use App\Support\NotificationKinds;
use App\Support\NotificationPreferences;
use App\Support\OperationalNotices;
use App\Support\RequestTrace;
use App\Support\WorkspaceLimits;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

final class OperationalNoticesTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, operational_notice_events, mail_outbox RESTART IDENTITY CASCADE');
    }

    public function test_all_reminders_are_replay_safe_and_respect_delivery_preferences(): void
    {
        $owner = User::factory()->create(['email_verified_at' => now()]);
        $workspace = $owner->ownedWorkspaces()->create(['name' => 'Notices', 'slug' => Ids::randomToken(12)]);
        $workspace->memberships()->create(['user_id' => $owner->id, 'role' => 'owner']);
        $kinds = [NotificationKinds::LINK_EXPIRING, NotificationKinds::LINK_LIMIT_APPROACHING,
            NotificationKinds::API_TOKEN_EXPIRING, NotificationKinds::INVITATION_EXPIRING, NotificationKinds::WEBHOOK_EXHAUSTED];
        NotificationPreferences::update($owner->id, array_fill_keys($kinds, 'in_app_only'));
        Link::create(['workspace_id' => $workspace->id, 'created_by' => $owner->id, 'alias' => 'expiring',
            'destination' => 'https://example.test', 'state' => 'active', 'expires_at' => now()->addHour(), 'max_clicks' => 10, 'click_count' => 9]);
        ApiToken::create(['workspace_id' => $workspace->id, 'created_by' => $owner->id, 'name' => 'Token',
            'token_hash' => hash('sha256', 'notices-token'), 'scopes' => ['links:read'], 'expires_at' => now()->addDay()]);
        Invitation::create(['workspace_id' => $workspace->id, 'invited_by' => $owner->id, 'email' => 'invite@example.test',
            'role' => 'viewer', 'token' => Ids::randomToken(48), 'status' => 'pending', 'expires_at' => now()->addHour()]);
        $hook = Webhook::create(['workspace_id' => $workspace->id, 'created_by' => $owner->id,
            'url' => 'https://example.test/hook', 'secret' => 'fixture', 'events' => ['link.created'], 'active' => true, 'config_version' => 1]);
        WebhookDelivery::create(['webhook_id' => $hook->id, 'config_version' => 1, 'event' => 'link.created',
            'event_id' => 'notice-failure', 'payload' => [], 'status' => 'failed', 'attempts' => 5]);
        OperationalNotices::sweep();
        OperationalNotices::sweep();
        $this->assertEqualsCanonicalizing($kinds, DB::table('notifications')->where('user_id', $owner->id)->pluck('kind')->all());
        $this->assertSame(5, DB::table('operational_notice_events')->count());
        $this->assertSame(0, DB::table('mail_outbox')->count());
        $this->assertSame(0, DB::table('notifications')->whereNull('digested_at')->count());
    }

    public function test_disabled_reminder_is_consumed_without_notification_or_mail(): void
    {
        $owner = User::factory()->create(['email_verified_at' => now()]);
        $workspace = $owner->ownedWorkspaces()->create(['name' => 'Disabled', 'slug' => Ids::randomToken(12)]);
        $workspace->memberships()->create(['user_id' => $owner->id, 'role' => 'owner']);
        NotificationPreferences::update($owner->id, [NotificationKinds::LINK_EXPIRING => 'disabled']);
        Link::create(['workspace_id' => $workspace->id, 'created_by' => $owner->id, 'alias' => 'disabled-notice',
            'destination' => 'https://example.test', 'state' => 'active', 'expires_at' => now()->addHour()]);
        OperationalNotices::sweep();
        $this->assertSame(1, DB::table('operational_notice_events')->count());
        $this->assertSame(0, DB::table('notifications')->count());
        $this->assertSame(0, DB::table('mail_outbox')->count());
    }

    public function test_admin_admitted_during_candidate_read_does_not_miss_a_consumed_reminder(): void
    {
        $owner = User::factory()->create(['email_verified_at' => now()]);
        $admin = User::factory()->create(['email_verified_at' => now()]);
        $workspace = $owner->ownedWorkspaces()->create(['name' => 'Race', 'slug' => Ids::randomToken(12)]);
        $workspace->memberships()->create(['user_id' => $owner->id, 'role' => 'owner']);
        foreach ([$owner, $admin] as $user) {
            NotificationPreferences::update($user->id, [NotificationKinds::LINK_EXPIRING => 'in_app_only']);
        }
        $link = Link::create(['workspace_id' => $workspace->id, 'created_by' => $owner->id, 'alias' => 'before-notice',
            'destination' => 'https://example.test', 'state' => 'active', 'expires_at' => now()->addHour()]);
        $injected = false;
        DB::listen(function ($query) use (&$injected, $workspace, $admin, $link): void {
            if (! $injected && str_starts_with($query->sql, 'select "user_id" from "memberships"')) {
                $injected = true;
                $workspace->memberships()->create(['user_id' => $admin->id, 'role' => 'admin']);
                $link->update(['alias' => 'after-notice']);
            }
        });
        OperationalNotices::sweep();
        $this->assertTrue($injected);
        $this->assertSame(0, DB::table('operational_notice_events')->count());
        $this->assertSame(0, DB::table('notifications')->count());
        OperationalNotices::sweep();
        $this->assertSame(1, DB::table('operational_notice_events')->count());
        $this->assertEqualsCanonicalizing([$owner->id, $admin->id], DB::table('notifications')->pluck('user_id')->all());
        $this->assertSame(['after-notice'], DB::table('notifications')->distinct()->pluck('subject')->all());
    }

    public function test_invalid_entitlement_is_rejected_instead_of_becoming_unlimited(): void
    {
        config(['entitlements.limits.members' => 0]);
        $this->expectException(\LogicException::class);
        WorkspaceLimits::limit('members');
    }

    public function test_nested_trace_restores_parent_and_rejects_untrusted_format(): void
    {
        $parent = RequestTrace::push(str_repeat('a', 32));
        try {
            $child = RequestTrace::push("header\nsecret");
            $this->assertMatchesRegularExpression('/^[a-f0-9]{32}$/D', $child);
            $this->assertNotSame($parent, $child);
            RequestTrace::pop();
            $this->assertSame($parent, RequestTrace::current());
        } finally {
            RequestTrace::pop();
        }
        $this->assertNull(RequestTrace::current());
    }
}
