<?php

namespace Tests\Feature;

use App\Models\Invitation;
use App\Models\User;
use App\Support\Ids;
use App\Support\PendingHandoff;
use App\Support\SessionManager;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Symfony\Component\HttpFoundation\Cookie;
use Tests\TestCase;

/**
 * The two handoff bearers no longer live in JS-readable storage.
 *
 * The invitation link and the public "prepare this link" flow used to keep a
 * bearer in `localStorage` for up to seven days and one day respectively, where
 * any script on the origin could read it. They are now parked in an HttpOnly
 * cookie minted by the server, which means the properties that matter are
 * cookie properties: the browser must not expose the value to script, the
 * server must not trust the expiry the client advertises, and a tampered value
 * must not be treated as a pending bearer.
 *
 * `withCookie` is the whole cookie jar: a `Set-Cookie` in a response does not
 * reach the next request by itself, so every helper below keeps the jar in sync
 * the way a browser would.
 */
final class PendingHandoffTest extends TestCase
{
    private const CSRF = 'pending-handoff-csrf';

    protected function setUp(): void
    {
        parent::setUp();
        DB::statement('TRUNCATE users, sessions, workspaces, memberships, invitations, audit_events RESTART IDENTITY CASCADE');
        config(['cache.default' => 'array']);
        $this->travelTo(now()->startOfSecond());
        $this->disableCookieEncryption();
        $this->withCredentials();
        $this->withCookie('uvh_csrf', self::CSRF)->withHeader('X-CSRF-Token', self::CSRF);
    }

    public function test_parking_keeps_the_bearer_out_of_script_reach(): void
    {
        $token = Ids::randomToken(32);

        $response = $this->park(PendingHandoff::INVITATION, $token);
        $response->assertCreated()->assertJsonPath('pending', true);

        $cookie = $this->cookieOf($response, PendingHandoff::cookieName(PendingHandoff::INVITATION));
        $this->assertNotNull($cookie, 'parking must set the handoff cookie');
        $this->assertTrue($cookie->isHttpOnly(), 'a bearer readable by script is the defect this removes');
        $this->assertSame('/', $cookie->getPath());
        $this->assertNull($cookie->getDomain(), 'a handoff bearer must stay host-only');
        $this->assertSame('lax', $cookie->getSameSite());
        // The value is a signed envelope, so the raw bearer never appears on
        // its own; what matters is that no response body echoes it.
        $this->assertStringNotContainsString($token, (string) $response->getContent());
    }

    public function test_the_parked_cookie_is_secure_when_the_deployment_says_so(): void
    {
        config(['uvh.cookie_secure' => true]);

        $response = $this->postJson('/api/v1/pending/'.PendingHandoff::INTENT, ['token' => Ids::randomToken(32)]);
        $cookie = $this->cookieOf($response, PendingHandoff::cookieName(PendingHandoff::INTENT));

        $this->assertNotNull($cookie);
        $this->assertTrue($cookie->isSecure());
    }

    public function test_a_malformed_or_oversized_bearer_is_never_parked(): void
    {
        foreach (['', 'short', str_repeat('a', 257), 'has spaces and punctuation!'] as $token) {
            $response = $this->postJson('/api/v1/pending/'.PendingHandoff::INVITATION, ['token' => $token]);
            $response->assertStatus(422);
            $this->assertNull(
                $this->cookieOf($response, PendingHandoff::cookieName(PendingHandoff::INVITATION)),
                'an unacceptable bearer must not be stored at all',
            );
        }
    }

    public function test_the_server_caps_the_deadline_the_client_advertises(): void
    {
        $response = $this->postJson('/api/v1/pending/'.PendingHandoff::INVITATION, [
            'token' => Ids::randomToken(32),
            'expiresAt' => now()->addDays(30)->toIso8601String(),
        ]);

        $cookie = $this->cookieOf($response, PendingHandoff::cookieName(PendingHandoff::INVITATION));
        $this->assertNotNull($cookie);
        $this->assertLessThanOrEqual(
            now()->addDays(7)->addMinute()->getTimestamp(),
            $cookie->getExpiresTime(),
            'a client-advertised deadline must never extend the server cap',
        );
        $this->assertGreaterThan(now()->addDays(6)->getTimestamp(), $cookie->getExpiresTime());
    }

    public function test_a_shorter_client_deadline_is_honoured(): void
    {
        $response = $this->postJson('/api/v1/pending/'.PendingHandoff::INTENT, [
            'token' => Ids::randomToken(32),
            'expiresAt' => now()->addMinutes(30)->toIso8601String(),
        ]);

        $cookie = $this->cookieOf($response, PendingHandoff::cookieName(PendingHandoff::INTENT));
        $this->assertNotNull($cookie);
        $this->assertLessThanOrEqual(now()->addMinutes(31)->getTimestamp(), $cookie->getExpiresTime());
    }

    public function test_a_deadline_already_in_the_past_is_not_parked(): void
    {
        $response = $this->postJson('/api/v1/pending/'.PendingHandoff::INVITATION, [
            'token' => Ids::randomToken(32),
            'expiresAt' => now()->subHour()->toIso8601String(),
        ]);

        $response->assertStatus(422);
        $this->assertNull($this->cookieOf($response, PendingHandoff::cookieName(PendingHandoff::INVITATION)));
    }

    public function test_a_tampered_cookie_is_not_a_pending_bearer(): void
    {
        $token = Ids::randomToken(32);
        $cookie = $this->cookieOf(
            $this->park(PendingHandoff::INVITATION, $token),
            PendingHandoff::cookieName(PendingHandoff::INVITATION),
        );
        $this->assertNotNull($cookie);

        $value = (string) $cookie->getValue();
        $tampered = substr($value, 0, -1).($value[-1] === 'A' ? 'B' : 'A');
        $this->withUnencryptedCookie(PendingHandoff::cookieName(PendingHandoff::INVITATION), $tampered)
            ->getJson('/api/v1/pending')
            ->assertOk()
            ->assertJsonPath('invitation.pending', false);
    }

    public function test_the_kind_cannot_be_swapped_between_the_two_cookies(): void
    {
        $cookie = $this->cookieOf(
            $this->park(PendingHandoff::INVITATION, Ids::randomToken(32)),
            PendingHandoff::cookieName(PendingHandoff::INVITATION),
        );
        $this->assertNotNull($cookie);

        // The invitation payload parked under the intent cookie name must not
        // become a pending link intent: the kind travels inside the signature.
        $this->withUnencryptedCookie(PendingHandoff::cookieName(PendingHandoff::INTENT), (string) $cookie->getValue())
            ->getJson('/api/v1/pending')
            ->assertOk()
            ->assertJsonPath('linkIntent.pending', false);
    }

    public function test_both_kinds_are_reported_independently(): void
    {
        $this->park(PendingHandoff::INVITATION, Ids::randomToken(32));
        $this->park(PendingHandoff::INTENT, Ids::randomToken(32));

        $this->getJson('/api/v1/pending')
            ->assertOk()
            ->assertJsonPath('invitation.pending', true)
            ->assertJsonPath('linkIntent.pending', true);

        $this->forget(PendingHandoff::INVITATION)->assertOk();

        $this->getJson('/api/v1/pending')
            ->assertOk()
            ->assertJsonPath('invitation.pending', false)
            ->assertJsonPath('linkIntent.pending', true);
    }

    public function test_forgetting_clears_the_cookie(): void
    {
        $response = $this->park(PendingHandoff::INTENT, Ids::randomToken(32));
        $this->assertNotNull($this->cookieOf($response, PendingHandoff::cookieName(PendingHandoff::INTENT)));

        $forgotten = $this->forget(PendingHandoff::INTENT)->assertOk();
        $cleared = $this->cookieOf($forgotten, PendingHandoff::cookieName(PendingHandoff::INTENT));

        $this->assertNotNull($cleared);
        $this->assertSame('', $cleared->getValue());
        $this->assertLessThan(now()->getTimestamp(), $cleared->getExpiresTime());
    }

    public function test_an_invitation_is_accepted_from_the_parked_cookie_alone(): void
    {
        [$target, $token] = $this->invitationFixture();

        // The frontend no longer sends the bearer: it parks it and forgets it.
        $this->park(PendingHandoff::INVITATION, $token);
        $this->signIn($target);

        $response = $this->postJson('/api/v1/workspaces/invitations/accept', []);
        $response->assertOk();

        $this->assertDatabaseHas('memberships', [
            'user_id' => $target->id,
            'role' => 'viewer',
        ]);

        $cleared = $this->cookieOf($response, PendingHandoff::cookieName(PendingHandoff::INVITATION));
        $this->assertNotNull($cleared, 'a consumed invitation must not stay parked');
        $this->assertSame('', $cleared->getValue());
    }

    public function test_the_documented_body_bearer_still_works(): void
    {
        [$target, $token] = $this->invitationFixture();
        $this->signIn($target);

        $this->postJson('/api/v1/workspaces/invitations/accept', ['token' => $token])->assertOk();

        $this->assertDatabaseHas('memberships', ['user_id' => $target->id]);
    }

    public function test_a_rejected_invitation_is_unparked(): void
    {
        [$target, $token] = $this->invitationFixture();

        $this->park(PendingHandoff::INVITATION, $token);
        $this->signIn($target);

        $response = $this->postJson('/api/v1/workspaces/invitations/reject', []);
        $response->assertOk();

        $cleared = $this->cookieOf($response, PendingHandoff::cookieName(PendingHandoff::INVITATION));
        $this->assertNotNull($cleared);
        $this->assertSame('', $cleared->getValue());
    }

    public function test_an_unusable_parked_invitation_is_unparked_instead_of_retried_forever(): void
    {
        // Same browser, wrong account: the parked bearer belongs to an address
        // this user does not own, so the attempt is terminal (400) and the
        // cookie must not keep inviting the same dead end on every visit.
        [, $token] = $this->invitationFixture();
        $stranger = User::factory()->create();
        $this->park(PendingHandoff::INVITATION, $token);
        $this->signIn($stranger);

        $response = $this->postJson('/api/v1/workspaces/invitations/accept', []);
        $response->assertStatus(400);

        $cleared = $this->cookieOf($response, PendingHandoff::cookieName(PendingHandoff::INVITATION));
        $this->assertNotNull($cleared);
        $this->assertSame('', $cleared->getValue());
    }

    public function test_a_body_bearer_that_fails_does_not_unpark_another_one(): void
    {
        [$target, $parked] = $this->invitationFixture();
        $this->park(PendingHandoff::INVITATION, $parked);
        $this->signIn($target);

        $this->postJson('/api/v1/workspaces/invitations/accept', ['token' => Ids::randomToken(32)])
            ->assertStatus(400);

        $this->getJson('/api/v1/pending')->assertJsonPath('invitation.pending', true);
    }

    public function test_a_link_intent_is_claimed_from_the_parked_cookie_alone(): void
    {
        $issued = $this->postJson('/api/v1/link-intents', ['destination' => 'https://example.test/parked']);
        $issued->assertCreated();
        $intent = (string) $issued->json('intent');

        $this->carry($this->postJson('/api/v1/pending/'.PendingHandoff::INTENT, [
            'token' => $intent,
            'expiresAt' => $issued->json('expiresAt'),
        ]))->assertCreated();

        $user = User::factory()->create();
        $this->signIn($user);

        $this->postJson('/api/v1/link-intents/claim', [])
            ->assertOk()
            ->assertJsonPath('destination', 'https://example.test/parked');

        $response = $this->postJson('/api/v1/link-intents/complete', []);
        $response->assertOk();

        $cleared = $this->cookieOf($response, PendingHandoff::cookieName(PendingHandoff::INTENT));
        $this->assertNotNull($cleared);
        $this->assertSame('', $cleared->getValue());
    }

    public function test_parking_is_rate_limited(): void
    {
        $status = 200;
        for ($i = 0; $i < 40; $i++) {
            $status = $this->postJson('/api/v1/pending/'.PendingHandoff::INVITATION, ['token' => Ids::randomToken(32)])->getStatusCode();
            if ($status === 429) {
                break;
            }
        }

        $this->assertSame(429, $status, 'parking is public and must bound how often it is called');
    }

    public function test_the_accepted_shape_is_the_shape_the_application_issues(): void
    {
        // If a future change rotates the bearer length, parking silently starts
        // refusing every freshly issued token. This is the contract that would
        // otherwise only surface as "the invitation link stopped working".
        $this->assertMatchesRegularExpression('/^[A-Za-z0-9_-]{43}$/D', Ids::randomToken(32));
        $this->assertTrue(PendingHandoff::accepts(Ids::randomToken(32)));
        $this->assertFalse(PendingHandoff::accepts(Ids::randomToken(16)));
        $this->assertFalse(PendingHandoff::accepts(''));
    }

    private function park(string $kind, string $token): TestResponse
    {
        return $this->carry($this->postJson('/api/v1/pending/'.$kind, ['token' => $token]));
    }

    private function forget(string $kind): TestResponse
    {
        return $this->carry($this->deleteJson('/api/v1/pending/'.$kind));
    }

    /**
     * Send back whatever handoff cookies the response set, the way a browser
     * would, so the next request in the same test sees them.
     */
    private function carry(TestResponse $response): TestResponse
    {
        foreach (PendingHandoff::kinds() as $kind) {
            $name = PendingHandoff::cookieName($kind);
            $cookie = $this->cookieOf($response, $name);
            if ($cookie !== null) {
                $this->withUnencryptedCookie($name, (string) $cookie->getValue());
            }
        }

        return $response;
    }

    private function cookieOf(TestResponse $response, string $name): ?Cookie
    {
        foreach ($response->baseResponse->headers->getCookies() as $cookie) {
            if ($cookie->getName() === $name) {
                return $cookie;
            }
        }

        return null;
    }

    /**
     * @return array{0: User, 1: string}
     */
    private function invitationFixture(): array
    {
        $owner = User::factory()->create();
        $target = User::factory()->create();
        $workspace = $owner->ownedWorkspaces()->create(['name' => 'Handoff fixture', 'slug' => 'handoff-'.Ids::randomToken(6)]);
        $workspace->memberships()->create(['user_id' => $owner->id, 'role' => 'owner']);

        $token = Ids::randomToken(32);
        Invitation::create([
            'workspace_id' => $workspace->id,
            'invited_by' => $owner->id,
            'email' => $target->email,
            'role' => 'viewer',
            'status' => 'pending',
            'token' => Ids::sha256Hex($token),
            'expires_at' => now()->addDays(7),
        ]);

        return [$target, $token];
    }

    private function signIn(User $user): void
    {
        $this->withCookie('uvh_session', SessionManager::create(
            $user->id,
            Request::create('/'),
            (int) $user->refresh()->security_version,
        ));
    }
}
