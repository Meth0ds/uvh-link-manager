<?php

namespace Tests\Feature;

use App\Support\SessionManager;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/** SQL budget for a public relation, together with its unchanged HTTP fields. */
final class LinkListingCollectionQueriesTest extends TestCase
{
    public static function listingPages(): array
    {
        $cases = [];
        foreach (['index', 'public', 'trash'] as $surface) {
            foreach (['shared', 'mixed', 'none'] as $shape) {
                foreach ([20, 100] as $perPage) {
                    $cases[] = [$surface, $shape, $perPage];
                }
            }
        }

        return $cases;
    }

    #[DataProvider('listingPages')]
    public function test_collection_queries_are_bounded_by_page_not_link_count(string $surface, string $shape, int $perPage): void
    {
        $fixture = (require base_path('tests/Support/link-list-fixture.php'))($shape);
        $this->disableCookieEncryption();
        $this->withCredentials();
        $owner = $fixture['owner'];
        $workspace = $fixture['workspace'];
        $this->withCookie((string) config('uvh.session_cookie'), SessionManager::create($owner->id, Request::create('/'), (int) $owner->security_version, true));
        $this->withHeader('X-Workspace-Id', (string) $workspace->id);
        if ($surface === 'public') {
            $this->withHeader('Authorization', 'Bearer list-fixture-bearer');
        }
        $queries = [];
        DB::listen(static function (QueryExecuted $query) use (&$queries): void {
            if (str_starts_with(strtolower($query->sql), 'select') && str_contains($query->sql, 'from "collections"')) {
                $queries[] = $query->sql;
            }
        });
        $path = match ($surface) {
            'public' => '/api/v1/public/links', 'trash' => '/api/v1/links/trash', default => '/api/v1/links'
        };
        $response = $this->getJson($path.'?page=1&perPage='.$perPage)->assertOk()->assertJsonPath('total', 120)->assertJsonPath('page', 1)->assertJsonPath('perPage', $perPage)->assertJsonCount($perPage, 'links');
        $seen = [];
        foreach ($response->json('links') as $row) {
            $link = $surface === 'trash' ? $row['link'] : $row;
            $expected = $fixture['links'][$link['id']] ?? null;
            $this->assertNotNull($expected);
            $this->assertSame($surface === 'trash' ? 'trash' : 'live', $expected['surface']);
            foreach (['collectionId', 'collection', 'alias', 'domain', 'tags', 'passwordProtected'] as $key) {
                $this->assertSame($expected[$key], $link[$key]);
            }
            $this->assertArrayNotHasKey('password_hash', $link);
            $seen[] = $link['id'];
        }
        $this->assertCount($perPage, array_unique($seen));
        $this->assertCount($shape === 'none' ? 0 : 1, $queries, 'Collection SQL must not grow with link count, including a shared collection');
        $queries = [];
        $this->getJson($path.'?page=999&perPage='.$perPage)->assertOk()->assertJsonPath('total', 120)->assertJsonCount(0, 'links');
        $this->assertCount(0, $queries, 'An empty page has no collection to load');
    }
}
