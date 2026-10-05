<?php

namespace Tests\Feature;

use App\Exceptions\LinkException;
use App\Http\Controllers\CollectionController;
use App\Http\Controllers\LinkBulkController;
use App\Http\Controllers\LinkTemplateController;
use App\Http\Controllers\TagController;
use App\Models\Collection;
use App\Models\Link;
use App\Models\LinkTemplate;
use App\Models\Tag;
use App\Models\User;
use App\Models\Webhook;
use App\Support\Ids;
use App\Support\LinkService;
use App\Support\SessionManager;
use App\Support\UvhRequest;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

final class WorkspaceMutationTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, workspaces, audit_events RESTART IDENTITY CASCADE');
        Queue::fake();
    }

    public static function revokedMutations(): array
    {
        $cases = [];
        foreach (['removed', 'downgraded', 'security-version'] as $revocation) {
            foreach (['tag-rename', 'tag-merge', 'collection-store', 'collection-rename', 'collection-delete', 'template-store', 'template-delete'] as $mutation) {
                $cases[$revocation.' '.$mutation] = [$revocation, $mutation];
            }
        }

        return $cases;
    }

    #[DataProvider('revokedMutations')]
    public function test_pre_authorized_requests_cannot_write_after_revocation(string $revocation, string $mutation): void
    {
        [$user, $workspaceId, $collection, $source, $target, $template] = $this->fixtures();
        // Keep the request's original user/security generation, as middleware does.
        $request = $this->request($user, $workspaceId, [
            'name' => 'Changed', 'sourceIds' => [(int) $source->id], 'targetId' => (int) $target->id,
            'payload' => ['destination' => 'https://example.org/new'],
        ]);
        if ($revocation === 'removed') {
            DB::table('memberships')->where('user_id', $user->id)->delete();
        } elseif ($revocation === 'downgraded') {
            DB::table('memberships')->where('user_id', $user->id)->update(['role' => 'viewer']);
        } else {
            User::where('id', $user->id)->increment('security_version');
        }
        $response = match ($mutation) {
            'tag-rename' => (new TagController)->rename($request, $source->id),
            'tag-merge' => (new TagController)->merge($request),
            'collection-store' => (new CollectionController)->store($request),
            'collection-rename' => (new CollectionController)->rename($request, $collection->id),
            'collection-delete' => (new CollectionController)->destroy($request, $collection->id),
            'template-store' => (new LinkTemplateController)->store($request),
            'template-delete' => (new LinkTemplateController)->destroy($request, $template->id),
        };
        $this->assertSame(403, $response->getStatusCode());
        $this->assertDatabaseCount('tags', 2);
        $this->assertSame('Source', $source->fresh()->name);
        $this->assertDatabaseCount('collections', 1);
        $this->assertSame('Collection', $collection->fresh()->name);
        $this->assertDatabaseCount('link_templates', 1);
        $this->assertDatabaseCount('audit_events', 0);
    }

    public function test_related_changes_advance_each_link_once_and_reject_stale_edits(): void
    {
        [$user, $workspaceId, $collection, $source, $target] = $this->fixtures();
        Webhook::create([
            'workspace_id' => $workspaceId, 'created_by' => $user->id,
            'url' => 'https://example.org/webhook', 'secret' => 'test-secret',
            'events' => ['link.updated'], 'active' => true,
        ]);
        $link = Link::create([
            'workspace_id' => $workspaceId, 'created_by' => $user->id, 'collection_id' => $collection->id,
            'alias' => 'linked', 'destination' => 'https://example.org', 'state' => 'active',
            'version' => 1, 'updated_at' => now()->subDay(),
        ]);
        $link->tags()->attach([$source->id, $target->id]);
        $response = (new TagController)->rename($this->request($user, $workspaceId, ['name' => 'Renamed']), $source->id);
        $this->assertSame(200, $response->getStatusCode());
        $this->assertSame(2, $link->fresh()->version);
        $this->assertTrue($link->fresh()->updated_at->gt(now()->subMinute()));
        try {
            LinkService::update($link->id, $workspaceId, $user->id, ['notes' => 'stale', 'tags' => ['Source']], 1);
            $this->fail('Stale editor must not resurrect a renamed tag');
        } catch (LinkException $e) {
            $this->assertSame(409, $e->status);
        }
        $this->assertDatabaseMissing('tags', ['name' => 'Source']);
        $response = (new TagController)->merge($this->request($user, $workspaceId, [
            'sourceIds' => [(int) $source->id], 'targetId' => (int) $target->id,
        ]));
        $this->assertSame(200, $response->getStatusCode());
        $this->assertSame(3, $link->fresh()->version);
        $this->assertSame(1, $link->tags()->count());
        // Even trashed links need their representation updated before restoration.
        $link->delete();
        $response = (new CollectionController)->destroy($this->request($user, $workspaceId), $collection->id);
        $this->assertSame(200, $response->getStatusCode());
        $current = Link::withTrashed()->findOrFail($link->id);
        $this->assertNull($current->collection_id);
        $this->assertSame(4, $current->version);
        $this->assertSame(3, DB::table('webhook_deliveries')->where('event', 'link.updated')->count());
    }

    public function test_bulk_move_rechecks_a_collection_deleted_after_preflight(): void
    {
        [$user, $workspaceId, $collection] = $this->fixtures();
        $link = Link::create([
            'workspace_id' => $workspaceId, 'created_by' => $user->id,
            'alias' => 'moving', 'destination' => 'https://example.org', 'state' => 'active', 'version' => 1,
        ]);
        $request = $this->request($user, $workspaceId, [
            'action' => 'move', 'linkIds' => [(int) $link->id], 'collectionId' => (int) $collection->id,
        ]);
        $request->headers->set('Idempotency-Key', 'concurrent-collection-delete');
        $delete = true;
        DB::listen(function (QueryExecuted $event) use (&$delete, $collection): void {
            if ($delete && str_starts_with(strtolower($event->sql), 'select exists')
                && str_contains($event->sql, '"collections"')) {
                $delete = false;
                $collection->delete();
            }
        });
        $response = (new LinkBulkController)->bulk($request);
        $this->assertFalse($delete, 'The deletion must occur after the initial collection lookup');
        $this->assertSame(422, $response->getStatusCode());
        $this->assertNull($link->fresh()->collection_id);
        $this->assertSame(1, $link->fresh()->version);
        $this->assertDatabaseCount('idempotency_keys', 0);
    }

    private function fixtures(): array
    {
        $user = User::factory()->create(['email_verified_at' => now()]);
        $workspace = $user->ownedWorkspaces()->create(['name' => 'Authority', 'slug' => 'authority']);
        $workspace->memberships()->create(['user_id' => $user->id, 'role' => 'owner']);
        $collection = Collection::create(['workspace_id' => $workspace->id, 'name' => 'Collection']);
        $source = Tag::create(['workspace_id' => $workspace->id, 'name' => 'Source']);
        $target = Tag::create(['workspace_id' => $workspace->id, 'name' => 'Target']);
        $template = LinkTemplate::create([
            'workspace_id' => $workspace->id, 'created_by' => $user->id, 'name' => 'Template',
            'payload' => ['destination' => 'https://example.org', 'collection_id' => (int) $collection->id],
        ]);

        return [$user, (int) $workspace->id, $collection, $source, $target, $template];
    }

    private function request(User $user, int $workspaceId, array $input = []): Request
    {
        $request = Request::create('/', 'POST', $input);
        $request->attributes->set(UvhRequest::USER, $user);
        $request->attributes->set(UvhRequest::WORKSPACE_ID, $workspaceId);
        $token = SessionManager::create($user->id, $request, (int) $user->security_version);
        $request->attributes->set(UvhRequest::SESSION_ID, Ids::sha256Hex($token));

        return $request;
    }
}
