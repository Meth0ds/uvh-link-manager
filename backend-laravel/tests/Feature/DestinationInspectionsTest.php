<?php

namespace Tests\Feature;

use App\Jobs\InspectDestinationJob;
use App\Models\Link;
use App\Models\User;
use App\Models\Workspace;
use App\Support\DestinationHttpTransport;
use App\Support\DestinationInspections;
use App\Support\DestinationInspector;
use App\Support\Ids;
use App\Support\SessionManager;
use App\Support\Ssrf;
use App\Support\UvhCrypto;
use Illuminate\Contracts\Queue\ShouldBeEncrypted;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Mockery;
use Symfony\Component\Process\Process;
use Tests\TestCase;

final class DestinationInspectionsTest extends TestCase
{
    private User $owner;

    private Workspace $workspace;

    private Link $link;

    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, sessions, workspaces, memberships, audit_events RESTART IDENTITY CASCADE');
        config(['workflows.enabled' => true]);
        DB::table('operational_metrics')->where('metric', 'like', 'destination_inspection.%')->delete();
        Queue::fake();
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', 'inspection-csrf')->withHeader('X-CSRF-Token', 'inspection-csrf');
        $this->owner = User::factory()->create(['email_verified_at' => now()]);
        $this->workspace = $this->owner->ownedWorkspaces()->create(['name' => 'Inspection', 'slug' => 'inspection-'.Ids::randomToken(8)]);
        $this->workspace->memberships()->create(['user_id' => $this->owner->id, 'role' => 'owner']);
        $this->link = Link::create(['workspace_id' => $this->workspace->id, 'created_by' => $this->owner->id, 'alias' => 'inspection', 'destination' => 'https://example.org/private?token=secret', 'state' => 'active', 'version' => 1]);
        $this->signIn($this->owner);
    }

    private function signIn(User $user): void
    {
        $this->withCookie((string) config('uvh.session_cookie'), SessionManager::create($user->id, Request::create('/'), (int) $user->security_version, true));
        $this->withHeader('X-Workspace-Id', (string) $this->workspace->id);
    }

    private function start(): string
    {
        return $this->postJson('/api/v1/links/'.$this->link->id.'/destination-inspection', ['linkVersion' => (int) $this->link->version])->assertStatus(202)->json('inspection.id');
    }

    private function response(int $status = 200, string $body = '', array $headers = []): array
    {
        return ['status' => $status, 'body' => $body, 'headers' => $headers, 'truncated' => false];
    }

    private function inspector(array $responses): DestinationInspector
    {
        $transport = Mockery::mock(DestinationHttpTransport::class);
        foreach ($responses as [$url, $method, $response]) {
            $transport->shouldReceive('request')->once()->with($url, $method, Mockery::on(fn ($time) => $time > 0 && $time <= 8000), Mockery::type('int'))->andReturn($response);
        }

        return new DestinationInspector($transport);
    }

    public function test_manual_requests_are_private_encrypted_cached_and_do_not_change_visits(): void
    {
        $id = $this->start();
        $this->postJson('/api/v1/links/'.$this->link->id.'/destination-inspection', ['linkVersion' => 1])->assertStatus(202)->assertJsonPath('inspection.id', $id);
        Queue::assertPushed(InspectDestinationJob::class, 1);
        $row = DB::table('destination_inspections')->where('id', $id)->first();
        $this->assertStringNotContainsString('token=secret', $row->url_ciphertext);
        $this->assertSame($this->link->destination, UvhCrypto::decryptAtRest($row->url_ciphertext));
        $job = new InspectDestinationJob($id);
        $this->assertInstanceOf(ShouldBeEncrypted::class, $job);
        $this->assertSame('destinations', $job->queue);
        DestinationInspections::execute($id, $this->inspector([[$this->link->destination, 'HEAD', $this->response()]]));
        $this->getJson('/api/v1/destination-inspections/'.$id)->assertOk()->assertJsonPath('inspection.result.status', 'reachable')->assertJsonPath('inspection.result.domain', 'example.org');
        $this->postJson('/api/v1/links/'.$this->link->id.'/destination-inspection', ['linkVersion' => 1])->assertOk()->assertJsonPath('inspection.id', $id);
        $this->assertSame(0, (int) $this->link->fresh()->click_count);
        $this->assertSame(0, DB::table('click_events')->count());
        $this->assertSame(1, (int) DB::table('operational_metrics')->where('metric', 'destination_inspection.completed')->sum('count'));
        $this->assertSame(2, (int) DB::table('operational_metrics')->where('metric', 'destination_inspection.cache_hit')->sum('count'));
    }

    public function test_viewers_can_check_links_but_not_drafts_or_others_private_results(): void
    {
        $ownerResult = $this->start();
        $viewer = User::factory()->create(['email_verified_at' => now()]);
        $this->workspace->memberships()->create(['user_id' => $viewer->id, 'role' => 'viewer']);
        $this->signIn($viewer);
        $this->start();
        $this->postJson('/api/v1/destination-previews', ['url' => 'https://example.org'])->assertForbidden();
        $this->getJson('/api/v1/destination-inspections/'.$ownerResult)->assertNotFound();
        $this->get('/api/v1/destination-inspections/'.$ownerResult.'/icon')->assertNotFound();
    }

    public function test_context_changes_and_stale_link_versions_discard_late_results(): void
    {
        $id = $this->start();
        $this->link->update(['version' => 2, 'destination' => 'https://example.net']);
        $transport = Mockery::mock(DestinationHttpTransport::class);
        $transport->shouldNotReceive('request');
        DestinationInspections::execute($id, new DestinationInspector($transport));
        $this->getJson('/api/v1/destination-inspections/'.$id)->assertOk()->assertJsonPath('inspection.status', 'stale')->assertJsonPath('inspection.result', null);
        $this->postJson('/api/v1/links/'.$this->link->id.'/destination-inspection', ['linkVersion' => 1])->assertStatus(409);
    }

    public function test_membership_revocation_during_remote_read_prevents_result_publication(): void
    {
        $id = $this->start();
        $transport = Mockery::mock(DestinationHttpTransport::class);
        $transport->shouldReceive('request')->once()->andReturnUsing(function () {
            DB::table('memberships')->where('workspace_id', $this->workspace->id)->where('user_id', $this->owner->id)->delete();

            return $this->response();
        });
        DestinationInspections::execute($id, new DestinationInspector($transport));
        $this->assertFalse(DB::table('destination_inspections')->where('id', $id)->exists());
    }

    public function test_health_uses_head_and_falls_back_only_when_not_supported(): void
    {
        $inspector = $this->inspector([
            ['https://example.org', 'HEAD', $this->response(405)],
            ['https://example.org', 'GET', $this->response(503)],
        ]);
        $this->assertSame('http_error', $inspector->inspect('https://example.org', 'health')['result']['status']);
        foreach ([401, 403, 407, 429] as $status) {
            $out = $this->inspector([['https://example.org', 'HEAD', $this->response($status)]])->inspect('https://example.org', 'health');
            $this->assertSame('restricted', $out['result']['status']);
        }
    }

    public function test_redirects_are_explicit_bounded_and_never_downgrade_tls(): void
    {
        $out = $this->inspector([
            ['https://example.org/start', 'HEAD', $this->response(302, '', ['location' => '/next'])],
            ['https://example.org/next', 'HEAD', $this->response()],
        ])->inspect('https://example.org/start', 'health');
        $this->assertSame('reachable', $out['result']['status']);
        $out = $this->inspector([
            ['https://example.org', 'HEAD', $this->response(302, '', ['location' => 'http://example.org'])],
        ])->inspect('https://example.org', 'health');
        $this->assertSame('not_checkable', $out['result']['status']);
        $out = $this->inspector([
            ['https://example.org/a', 'HEAD', $this->response(302, '', ['location' => '/b'])],
            ['https://example.org/b', 'HEAD', $this->response(302, '', ['location' => '/c'])],
            ['https://example.org/c', 'HEAD', $this->response(302, '', ['location' => '/d'])],
            ['https://example.org/d', 'HEAD', $this->response(302, '', ['location' => '/e'])],
        ])->inspect('https://example.org/a', 'health');
        $this->assertSame('policy', $out['result']['reason']);
    }

    public function test_uvh_owned_hosts_are_never_fetched_even_through_a_redirect(): void
    {
        $transport = Mockery::mock(DestinationHttpTransport::class);
        $transport->shouldNotReceive('request');
        $out = (new DestinationInspector($transport))->inspect('https://uvh.es/printed-qr', 'health');
        $this->assertSame('not_checkable', $out['result']['status']);
        $out = $this->inspector([['https://example.org', 'HEAD', $this->response(302, '', ['location' => 'https://uvh.es/a?qr=token'])]])->inspect('https://example.org', 'health');
        $this->assertSame('policy', $out['result']['reason']);
    }

    public function test_preview_extracts_plain_text_and_serves_only_normalized_private_png(): void
    {
        $id = $this->postJson('/api/v1/destination-previews', ['url' => 'https://example.org/page'])->assertStatus(202)->json('inspection.id');
        $image = imagecreatetruecolor(300, 150);
        ob_start();
        imagejpeg($image);
        $jpeg = ob_get_clean();
        imagedestroy($image);
        $html = '<!DOCTYPE html><title>Tienda &amp; ofertas</title><script>fetch("https://internal")</script><link rel="shortcut icon" href="/icon.jpg">';
        DestinationInspections::execute($id, $this->inspector([
            ['https://example.org/page', 'GET', $this->response(200, $html, ['content-type' => 'text/html; charset=utf-8'])],
            ['https://example.org/icon.jpg', 'GET', $this->response(200, $jpeg, ['content-type' => 'image/jpeg'])],
        ]));
        $this->getJson('/api/v1/destination-inspections/'.$id)->assertOk()->assertJsonPath('inspection.result.title', 'Tienda & ofertas')->assertJsonPath('inspection.result.iconUrl', '/api/v1/destination-inspections/'.$id.'/icon');
        $png = $this->get('/api/v1/destination-inspections/'.$id.'/icon')->assertOk()->assertHeader('Content-Type', 'image/png')->assertHeader('Cache-Control', 'no-store, private')->getContent();
        $this->assertSame([128, 64], array_slice(getimagesizefromstring($png), 0, 2));
        $row = DB::table('destination_inspections')->where('id', $id)->first();
        $this->assertStringStartsWith('enc:v1:', $row->icon_ciphertext);
        $this->assertSame($png, base64_decode(UvhCrypto::decryptAtRest($row->icon_ciphertext), true));
    }

    public function test_svg_icon_and_external_entities_are_not_rendered(): void
    {
        $html = '<!DOCTYPE html [<!ENTITY secret SYSTEM "file:///etc/passwd">]><title>&secret; normal</title><link rel="icon" href="/evil.svg">';
        $out = $this->inspector([
            ['https://example.org', 'GET', $this->response(200, $html, ['content-type' => 'text/html'])],
            ['https://example.org/evil.svg', 'GET', $this->response(200, '<svg onload="alert(1)"/>', ['content-type' => 'image/svg+xml'])],
        ])->inspect('https://example.org', 'preview');
        $this->assertNull($out['icon']);
        $this->assertStringNotContainsString('root:', $out['result']['title']);
    }

    public function test_malformed_optional_icons_do_not_change_a_successful_preview(): void
    {
        $html = '<title>Mi tienda</title><link rel="icon" href="http://example.org:invalid/icon.png">';
        $out = $this->inspector([
            ['https://example.org', 'GET', $this->response(200, $html, ['content-type' => 'text/html'])],
        ])->inspect('https://example.org', 'preview');
        $this->assertSame('reachable', $out['result']['status']);
        $this->assertSame(200, $out['result']['httpStatus']);
        $this->assertSame('Mi tienda', $out['result']['title']);
        $this->assertNull($out['result']['reason']);
        $this->assertNull($out['icon']);
    }

    public function test_empty_html_is_reachable_without_metadata(): void
    {
        $out = $this->inspector([
            ['https://example.org', 'GET', $this->response(200, '', ['content-type' => 'text/html'])],
        ])->inspect('https://example.org', 'preview');
        $this->assertSame('reachable', $out['result']['status']);
        $this->assertNull($out['result']['title']);
        $this->assertNull($out['icon']);
    }

    public function test_input_role_and_rate_limits_are_checked_before_admission(): void
    {
        foreach (['ftp://example.org', 'https://user:pass@example.org', "https://example.org/a\nb"] as $url) {
            $this->postJson('/api/v1/destination-previews', ['url' => $url])->assertStatus(422);
        }
        $this->postJson('/api/v1/destination-previews', ['url' => 'https://example.org', 'html' => '<svg/>'])->assertStatus(422);
        config(['destination-inspections.user_per_minute' => 1]);
        $this->start();
        $this->postJson('/api/v1/destination-previews', ['url' => 'https://example.net'])->assertStatus(429);
    }

    public function test_expired_results_are_inaccessible_pruned_and_cascade_with_workspace(): void
    {
        $id = $this->start();
        $this->travel(11)->minutes();
        $this->getJson('/api/v1/destination-inspections/'.$id)->assertNotFound();
        $this->artisan('uvh:destination-inspections-prune')->assertSuccessful();
        $this->assertSame(0, DB::table('destination_inspections')->count());
        $this->travelBack();
        $this->start();
        $this->workspace->delete();
        $this->assertSame(0, DB::table('destination_inspections')->count());
    }

    public function test_feature_flag_disables_new_requests_and_reads(): void
    {
        $id = $this->start();
        config(['workflows.enabled' => false]);
        $this->postJson('/api/v1/destination-previews', ['url' => 'https://example.org'])->assertNotFound();
        $this->getJson('/api/v1/destination-inspections/'.$id)->assertNotFound();
    }

    public function test_additive_read_transport_rejects_private_ips_ports_and_credentials(): void
    {
        foreach (['http://127.0.0.1', 'http://169.254.169.254', 'http://[::1]', 'http://[64:ff9b::a00:1]', 'http://example.org:25', 'https://user:password@example.org'] as $url) {
            try {
                Ssrf::safeRead($url, 'GET', 100, 100);
                $this->fail('Unsafe inspection target was accepted');
            } catch (\RuntimeException $error) {
                $this->assertStringStartsWith('SSRF:', $error->getMessage());
            }
        }
    }

    public function test_transport_dns_pinning_byte_deadline_and_header_bounds_in_an_isolated_process(): void
    {
        $process = new Process([PHP_BINARY, base_path('tests/Support/destination-transport-probe.php')]);
        $process->setTimeout(10);
        $process->mustRun();
        $checks = json_decode($process->getOutput(), true, 16, JSON_THROW_ON_ERROR);
        $this->assertCount(12, $checks);
        foreach ($checks as $name => $passed) {
            $this->assertTrue($passed, $name);
        }
    }

    public function test_workspace_limit_is_shared_by_members_but_cached_requests_do_not_consume_it(): void
    {
        config(['destination-inspections.workspace_per_minute' => 1]);
        $id = $this->start();
        $this->postJson('/api/v1/links/'.$this->link->id.'/destination-inspection', ['linkVersion' => 1])->assertStatus(202)->assertJsonPath('inspection.id', $id);
        $viewer = User::factory()->create(['email_verified_at' => now()]);
        $this->workspace->memberships()->create(['user_id' => $viewer->id, 'role' => 'viewer']);
        $this->signIn($viewer);
        $this->postJson('/api/v1/links/'.$this->link->id.'/destination-inspection', ['linkVersion' => 1])->assertStatus(429);
        Queue::assertPushed(InspectDestinationJob::class, 1);
        $this->assertSame(1, (int) DB::table('operational_metrics')->where('metric', 'destination_inspection.rate_limited')->sum('count'));
    }

    public function test_broker_redelivery_does_not_run_the_same_remote_inspection_twice(): void
    {
        $id = $this->start();
        $second = Mockery::mock(DestinationHttpTransport::class);
        $second->shouldNotReceive('request');
        $first = Mockery::mock(DestinationHttpTransport::class);
        $first->shouldReceive('request')->once()->andReturnUsing(function () use ($id, $second) {
            $this->assertSame('running', DB::table('destination_inspections')->where('id', $id)->value('status'));
            $this->getJson('/api/v1/destination-inspections/'.$id)->assertOk()->assertJsonPath('inspection.status', 'pending');
            DestinationInspections::execute($id, new DestinationInspector($second));

            return $this->response();
        });
        DestinationInspections::execute($id, new DestinationInspector($first));
        $this->getJson('/api/v1/destination-inspections/'.$id)->assertOk()->assertJsonPath('inspection.status', 'ready');
    }

    public function test_excessive_document_nodes_preserve_health_without_allocating_remote_metadata(): void
    {
        $html = '<title>Should not parse</title>'.str_repeat('<i>', 10001);
        $out = $this->inspector([['https://example.org', 'GET', $this->response(200, $html, ['content-type' => 'text/html'])]])->inspect('https://example.org', 'preview');
        $this->assertSame('reachable', $out['result']['status']);
        $this->assertNull($out['result']['title']);
        $this->assertNull($out['icon']);
    }
}
