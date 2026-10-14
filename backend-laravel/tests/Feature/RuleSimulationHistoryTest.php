<?php

namespace Tests\Feature;

use App\Models\User;
use App\Models\Workspace;
use App\Support\Ids;
use App\Support\RuleConflictAnalyzer;
use App\Support\SessionManager;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

final class RuleSimulationHistoryTest extends TestCase
{
    private User $owner;

    private Workspace $workspace;

    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, sessions, workspaces, memberships, audit_events RESTART IDENTITY CASCADE');
        Queue::fake();
        config(['workflows.enabled' => true]);
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', 'history-csrf')->withHeader('X-CSRF-Token', 'history-csrf');
        $this->owner = User::factory()->create(['email_verified_at' => now()]);
        $this->workspace = $this->owner->ownedWorkspaces()->create(['name' => 'History', 'slug' => Ids::randomToken(12)]);
        $this->workspace->memberships()->create(['user_id' => $this->owner->id, 'role' => 'owner']);
        $this->withCookie((string) config('uvh.session_cookie'), SessionManager::create($this->owner->id, Request::create('/'), (int) $this->owner->security_version, true));
        $this->withHeader('X-Workspace-Id', (string) $this->workspace->id);
    }

    public function test_simulation_uses_rule_order_and_does_not_consume_clicks(): void
    {
        $created = $this->withHeader('Idempotency-Key', 'history-create-001')->postJson('/api/v1/links', [
            'destination' => 'https://example.org/main',
            'fallbackDestination' => 'https://example.org/fallback',
            'utm' => ['source' => 'newsletter'],
            'rules' => [[
                'priority' => 1, 'country' => 'ES', 'destination' => 'https://example.org/es',
            ]],
        ])->assertCreated();
        $id = $created->json('link.id');
        $this->postJson('/api/v1/link-rule-simulations', [
            'linkId' => $id, 'country' => 'ES', 'timezone' => 'Europe/Madrid',
        ])->assertOk()->assertJsonPath('source', 'rule')->assertJsonPath('destinationWithUtm', 'https://example.org/es?utm_source=newsletter');
        self::assertSame(0, $created->json('link.clickCount'));
        self::assertSame(0, DB::table('links')->where('id', $id)->value('click_count'));
    }

    public function test_saved_link_simulation_does_not_accept_overridden_configuration(): void
    {
        $created = $this->withHeader('Idempotency-Key', 'history-create-003')->postJson('/api/v1/links', [
            'destination' => 'https://example.org/saved',
            'rules' => [['priority' => 2, 'country' => 'ES', 'destination' => 'https://example.org/saved-rule']],
        ])->assertCreated();
        $id = $created->json('link.id');

        $this->postJson('/api/v1/link-rule-simulations', [
            'linkId' => $id,
            'destination' => 'https://attacker.invalid/override',
            'rules' => [['priority' => 0, 'destination' => 'https://attacker.invalid/rule']],
            'country' => 'ES',
        ])->assertOk()->assertJsonPath('destination', 'https://example.org/saved-rule');
    }

    public function test_simulation_exposes_daylight_saving_ambiguity_and_rejects_missing_local_times(): void
    {
        CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-11-01 12:00:00', 'UTC'));
        try {
            $created = $this->withHeader('Idempotency-Key', 'history-create-dst')->postJson('/api/v1/links', [
                'destination' => 'https://example.org/dst',
            ])->assertCreated();
            $id = $created->json('link.id');

            $this->postJson('/api/v1/link-rule-simulations', [
                'linkId' => $id,
                'localTime' => '01:30',
                'timezone' => 'America/New_York',
            ])->assertOk()->assertJsonPath('warnings.timezoneWarnings.0', 'ambiguous_local_time');

            CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-03-08 12:00:00', 'UTC'));
            $this->postJson('/api/v1/link-rule-simulations', [
                'linkId' => $id,
                'localTime' => '02:30',
                'timezone' => 'America/New_York',
            ])->assertStatus(422);
        } finally {
            CarbonImmutable::setTestNow();
        }
    }

    public function test_conflict_analyzer_marks_malformed_rules_as_impossible_without_flagging_overnight_ranges(): void
    {
        $warnings = RuleConflictAnalyzer::analyze([
            ['priority' => 1, 'time_from' => '22:00', 'time_to' => '02:00', 'destination' => 'https://example.org/night'],
            ['priority' => 2, 'time_from' => '99:00', 'destination' => 'https://example.org/bad'],
        ]);

        self::assertSame([1], $warnings['impossibleRules']);
    }

    public function test_history_captures_changes_and_restores_without_touching_url_or_stats(): void
    {
        $created = $this->withHeader('Idempotency-Key', 'history-create-002')->postJson('/api/v1/links', ['destination' => 'https://example.org/one', 'name' => 'Primero', 'rules' => [['priority' => 1, 'destination' => 'https://example.org/one-rule']]])->assertCreated();
        $id = $created->json('link.id');
        $alias = $created->json('link.alias');
        $version = $created->json('link.version');
        $updated = $this->patchJson('/api/v1/links/'.$id, ['version' => $version, 'destination' => 'https://example.org/two', 'name' => 'Segundo', 'rules' => [['priority' => 1, 'destination' => 'https://example.org/two-rule']]])->assertOk();
        $history = $this->getJson('/api/v1/links/'.$id.'/history')->assertOk();
        self::assertSame(2, $history->json('versions.0.revision'));
        $history->assertJsonPath('versions.0.changedFields.0', 'name');
        $this->getJson('/api/v1/links/'.$id.'/history/2')->assertOk()->assertJsonPath('configuration.rules.0.destination', 'https://example.org/two-rule');
        $this->getJson('/api/v1/links/'.$id.'/history/compare?from=1&to=2')->assertOk()->assertJsonPath('changes.0.field', 'name');
        $this->withHeader('Idempotency-Key', 'history-restore-001')->postJson('/api/v1/links/'.$id.'/history/1/restore', ['expectedVersion' => $updated->json('link.version')])->assertOk()->assertJsonPath('restoredRevision', 1);
        $restored = $this->getJson('/api/v1/links/'.$id)->assertOk();
        self::assertSame('https://example.org/one', $restored->json('link.destination'));
        $this->getJson('/api/v1/links/'.$id)->assertJsonPath('rules.0.destination', 'https://example.org/one-rule');
        self::assertSame($alias, $restored->json('link.alias'));
        self::assertSame(0, $restored->json('link.clickCount'));
        self::assertSame(3, DB::table('link_versions')->where('link_id', $id)->count());
    }

    public function test_restore_rejects_stale_version_without_writing(): void
    {
        $created = $this->withHeader('Idempotency-Key', 'history-create-004')->postJson('/api/v1/links', ['destination' => 'https://example.org/one'])->assertCreated();
        $id = $created->json('link.id');
        $before = DB::table('link_versions')->where('link_id', $id)->count();

        $this->withHeader('Idempotency-Key', 'history-restore-004')->postJson('/api/v1/links/'.$id.'/history/1/restore', ['expectedVersion' => 999])->assertStatus(409);

        self::assertSame($before, DB::table('link_versions')->where('link_id', $id)->count());
    }
}
