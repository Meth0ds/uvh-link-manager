<?php

namespace Tests\Feature;

use App\Models\ApiToken;
use App\Models\User;
use App\Models\Workspace;
use App\Support\Ids;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * The `Authorization` scheme is a case-insensitive token (RFC 9110 §11.1), and
 * the two places in this application that read it disagreed about that:
 * `OperationsController` went through Laravel's own `bearerToken()` (matched
 * case-insensitively) while `RequireApiToken` compared the literal string
 * `Bearer `, so the same header that opened `/internal/metrics` was rejected as
 * missing on every public API route.
 *
 * A client that sends `bearer` is not malformed, and the answer it received —
 * "Token de API requerido" — described a missing header rather than a token the
 * server refused to read.
 */
final class ApiTokenSchemeTest extends TestCase
{
    private const TOKEN = 'fixture-api-token-not-a-secret';

    private Workspace $workspace;

    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users RESTART IDENTITY CASCADE');
        // RateLimiter spends from the configured cache and user IDs restart at
        // one in every method; without this a test inherits another's budget.
        Cache::flush();

        $owner = User::factory()->create();
        $this->workspace = $owner->ownedWorkspaces()->create([
            'name' => 'API scheme', 'slug' => 'api-scheme-'.Ids::randomToken(8),
        ]);
        $this->workspace->memberships()->create(['user_id' => $owner->id, 'role' => 'owner']);
        $this->workspace->quota()->create(['links_limit' => 7]);

        ApiToken::create([
            'workspace_id' => $this->workspace->id,
            'name' => 'scheme fixture',
            'token_hash' => Ids::sha256Hex(self::TOKEN),
            'scopes' => ['links:read'],
            'created_by' => $owner->id,
        ]);
    }

    public function test_the_documented_scheme_authenticates(): void
    {
        $this->withHeader('Authorization', 'Bearer '.self::TOKEN)
            ->getJson('/api/v1/public/links')
            ->assertOk();
    }

    public function test_the_scheme_is_read_whatever_its_case(): void
    {
        foreach (['bearer', 'BEARER', 'BeArEr'] as $scheme) {
            $this->withHeader('Authorization', $scheme.' '.self::TOKEN)
                ->getJson('/api/v1/public/links')
                ->assertOk();
        }

        // The separator is not the scheme: one space is required, and more than
        // one is still one header value.
        $this->withHeader('Authorization', "Bearer\t".self::TOKEN)
            ->getJson('/api/v1/public/links')
            ->assertOk();
    }

    public function test_a_wrong_scheme_is_still_no_credential_at_all(): void
    {
        foreach (['Token '.self::TOKEN, 'Basic '.self::TOKEN, self::TOKEN] as $header) {
            $this->withHeader('Authorization', $header)
                ->getJson('/api/v1/public/links')
                ->assertStatus(401)
                ->assertJsonPath('error', 'Token de API requerido');
        }

        $this->withHeader('Authorization', 'Bearer')
            ->getJson('/api/v1/public/links')
            ->assertStatus(401)
            ->assertJsonPath('error', 'Token de API requerido');

        $this->getJson('/api/v1/public/links')
            ->assertStatus(401)
            ->assertJsonPath('error', 'Token de API requerido');
    }

    public function test_a_real_but_unknown_token_is_reported_as_invalid_not_missing(): void
    {
        $this->withHeader('Authorization', 'bearer '.self::TOKEN.'-wrong')
            ->getJson('/api/v1/public/links')
            ->assertStatus(401)
            ->assertJsonPath('error', 'Token inválido o revocado');
    }
}
