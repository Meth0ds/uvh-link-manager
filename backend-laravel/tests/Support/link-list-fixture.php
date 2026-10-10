<?php

use App\Models\ApiToken;
use App\Models\User;
use App\Models\Workspace;
use App\Support\Ids;
use Illuminate\Support\Facades\DB;

// Deliberately synthetic. This helper never boots an app or selects a DB.
return static function (string $shape = 'mixed'): array {
    if (! app()->environment('testing') || ! str_ends_with(DB::connection()->getDatabaseName(), '_test')) {
        throw new RuntimeException('Owned testing schema required');
    }
    if (! in_array($shape, ['shared', 'mixed', 'none'], true)) {
        throw new InvalidArgumentException('Unknown listing fixture');
    }
    DB::statement('TRUNCATE users, operational_metrics RESTART IDENTITY CASCADE');
    $owner = User::factory()->create(['email_verified_at' => now()]);
    $workspace = $owner->ownedWorkspaces()->create(['name' => 'List fixture', 'slug' => 'list-fixture']);
    $workspace->memberships()->create(['user_id' => $owner->id, 'role' => 'owner']);
    $other = User::factory()->create(['email_verified_at' => now()]);
    $foreign = Workspace::forceCreate(['name' => 'Foreign', 'slug' => 'foreign', 'owner_user_id' => $other->id]);
    $collections = [];
    foreach (['Shared campaign', 'Second campaign', 'Third campaign'] as $name) {
        $id = DB::table('collections')->insertGetId(['workspace_id' => $workspace->id, 'name' => $name]);
        $collections[$id] = $name;
    }
    $ids = array_keys($collections);
    $foreignCollection = DB::table('collections')->insertGetId(['workspace_id' => $foreign->id, 'name' => 'Foreign campaign']);
    $domainId = DB::table('custom_domains')->insertGetId([
        'workspace_id' => $workspace->id, 'domain' => 'listing.uvh.test', 'verification_token' => 'list-fixture-only',
    ]);
    $tagId = DB::table('tags')->insertGetId(['workspace_id' => $workspace->id, 'name' => 'campaign']);
    $links = [];
    foreach (['live', 'trash'] as $surface) {
        for ($i = 0; $i < 120; $i++) {
            $collectionId = $shape === 'none' ? null : ($shape === 'shared' ? $ids[0] : ($i % 5 === 0 ? null : $ids[$i % 3]));
            $domain = $i % 2 === 0 ? $domainId : null;
            $alias = $surface.'-'.str_pad((string) $i, 3, '0', STR_PAD_LEFT);
            $id = DB::table('links')->insertGetId([
                'workspace_id' => $workspace->id, 'created_by' => $owner->id,
                'alias' => $alias, 'destination' => 'https://example.test/'.$alias,
                'fallback_destination' => 'https://example.test/fallback',
                'state' => $surface === 'trash' ? 'deleted' : ($i % 4 === 0 ? 'paused' : 'active'),
                'state_before_delete' => $surface === 'trash' ? 'active' : null,
                'deleted_at' => $surface === 'trash' ? '2026-10-08T10:00:00Z' : null,
                'collection_id' => $collectionId, 'domain_id' => $domain,
                'notes' => $i % 2 === 0 ? 'campaign needle' : 'other note',
                'click_count' => $i % 7, 'max_clicks' => 1000, 'version' => 3,
                'password_hash' => $i % 3 === 0 ? 'non-login-fixture-marker' : null,
                'utm_campaign' => 'autumn', 'single_use' => false,
                'scheduled_at' => '2026-10-01T08:00:00.123456Z',
                'expires_at' => '2026-12-01T08:00:00.654321Z',
                'created_at' => '2026-10-01T10:00:00Z', 'updated_at' => '2026-10-01T10:00:00Z',
            ]);
            $tagged = $i % 3 === 0;
            if ($tagged) {
                DB::table('link_tags')->insert(['link_id' => $id, 'tag_id' => $tagId]);
            }
            $links[$id] = ['collectionId' => $collectionId, 'collection' => $collectionId === null ? null : $collections[$collectionId], 'alias' => $alias, 'surface' => $surface, 'domain' => $domain === null ? null : 'listing.uvh.test', 'tags' => $tagged ? ['campaign'] : [], 'passwordProtected' => $i % 3 === 0];
        }
    }
    foreach (['live', 'trash'] as $surface) {
        DB::table('links')->insert([
            'workspace_id' => $foreign->id, 'created_by' => $other->id, 'alias' => 'foreign-'.$surface,
            'destination' => 'https://example.test/foreign', 'collection_id' => $foreignCollection,
            'state' => $surface === 'trash' ? 'deleted' : 'active',
            'deleted_at' => $surface === 'trash' ? '2026-10-08T10:00:00Z' : null,
            'state_before_delete' => $surface === 'trash' ? 'active' : null,
            'created_at' => '2026-10-01T10:00:00Z', 'updated_at' => '2026-10-01T10:00:00Z',
        ]);
    }
    ApiToken::forceCreate(['workspace_id' => $workspace->id, 'created_by' => $owner->id, 'name' => 'list fixture', 'token_hash' => Ids::sha256Hex('list-fixture-bearer'), 'scopes' => ['links:read']]);

    return compact('owner', 'workspace', 'foreign', 'domainId', 'links');
};
