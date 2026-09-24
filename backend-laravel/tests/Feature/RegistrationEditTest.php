<?php

namespace Tests\Feature;

use App\Models\PendingRegistration;
use App\Support\Ids;
use App\Support\RegistrationEdit;
use App\Support\SealedToken;
use App\Support\SignedToken;
use Illuminate\Http\Request;
use Tests\TestCase;

/**
 * The registration edit secret must be OPAQUE, and that is testable from the
 * outside of the cookie.
 *
 * The first version signed a readable claim: `{"v":1,"uid":"0000000127",
 * "sv":"001"}` base64url'd in the clear. A real registration's uid is small and
 * sequential while a decoy's was `random_int(1, 999_999_999)`, so any HTTP
 * client could decode `Set-Cookie` and statistically separate free from
 * occupied destinations — the enumeration oracle the byte-identical `register`
 * body exists to close. `HttpOnly` never helped: it only stops page JavaScript.
 *
 * These tests pin the property the readable claim violated: whatever the
 * outcome, the value handed out is one opaque fixed-length blob that carries no
 * uid, no generation and no branch, and a decoy authorises no account at all.
 */
final class RegistrationEditTest extends TestCase
{
    public function test_the_secret_round_trips_and_binds_one_account_at_one_generation(): void
    {
        $request = $this->requestCarryingValue((string) RegistrationEdit::secret(127, 1)->getValue());

        $this->assertTrue(RegistrationEdit::authorizes($request, $this->pending(127, 1)));
        // Same account, later generation: the secret that authorised the move
        // was spent by it.
        $this->assertFalse(RegistrationEdit::authorizes($request, $this->pending(127, 2)));
        // Same generation, another account.
        $this->assertFalse(RegistrationEdit::authorizes($request, $this->pending(128, 1)));
    }

    public function test_every_wrong_shape_is_the_same_false(): void
    {
        $valid = (string) RegistrationEdit::secret(127, 1)->getValue();
        $flipped = ($valid[0] === 'A' ? 'B' : 'A').substr($valid, 1);

        foreach ([
            'absent' => '',
            'tampered first byte' => $flipped,
            'truncated' => substr($valid, 1),
            'signed-token shape' => 'a.b.c',
            'not base64url' => '!!!!',
            'another deployment' => str_repeat('A', strlen($valid)),
        ] as $label => $wrong) {
            $this->assertFalse(
                RegistrationEdit::authorizes($this->requestCarryingValue($wrong), $this->pending(127, 1)),
                "a secret that is {$label} must refuse, exactly like every other way of being wrong",
            );
        }
    }

    public function test_an_expired_claim_is_refused_even_with_an_authentic_seal(): void
    {
        // One second in the past, sealed with the live keyring: only the
        // expiration says no, and it says the same `false` as everything else.
        $stale = SealedToken::seal(sprintf(
            '{"e":%013d,"v":2,"pid":"%010d","sv":"%03d"}',
            (int) (microtime(true) * 1000) - 1000,
            127,
            1,
        ));

        $this->assertFalse(RegistrationEdit::authorizes($this->requestCarryingValue($stale), $this->pending(127, 1)));
    }

    public function test_a_secret_sealed_under_the_previous_key_still_opens(): void
    {
        config(['uvh.secret' => str_repeat('a', 40), 'uvh.secret_previous' => []]);
        $value = (string) RegistrationEdit::secret(5, 1)->getValue();

        config(['uvh.secret' => str_repeat('b', 40), 'uvh.secret_previous' => [str_repeat('a', 40)]]);
        $this->assertTrue(RegistrationEdit::authorizes($this->requestCarryingValue($value), $this->pending(5, 1)));

        config(['uvh.secret' => str_repeat('c', 40), 'uvh.secret_previous' => []]);
        $this->assertFalse(RegistrationEdit::authorizes($this->requestCarryingValue($value), $this->pending(5, 1)));
    }

    public function test_real_and_decoy_secrets_are_indistinguishable_from_the_outside(): void
    {
        // Same length whatever the outcome: the size of the secret must not say
        // which branch answered.
        $lengths = [];
        foreach (range(1, 20) as $uid) {
            $lengths[] = strlen((string) RegistrationEdit::secret($uid, $uid % 3 + 1)->getValue());
        }
        foreach (range(1, 20) as $_) {
            $lengths[] = strlen((string) RegistrationEdit::decoy()->getValue());
        }
        $this->assertCount(1, array_unique($lengths));

        $real = (string) RegistrationEdit::secret(127, 1)->getValue();

        // One opaque base64url segment: no `SignedToken` structure to decode,
        // no expiration to read, no version to compare between outcomes.
        $this->assertMatchesRegularExpression('/^[A-Za-z0-9_-]+$/D', $real);
        $this->assertStringNotContainsString('.', $real);
        $this->assertNull(SignedToken::verify($real), 'the secret must not be a readable signed claim');

        // Neither the visible value nor its decoded bytes carry the claim.
        $this->assertStringNotContainsString(sprintf('%010d', 127), $real);
        $raw = Ids::base64urlDecode($real);
        $this->assertStringNotContainsString('pid', $raw);
        $this->assertStringNotContainsString('"sv"', $raw);
    }

    public function test_the_decoy_authorises_no_account_at_all(): void
    {
        $decoy = $this->requestCarryingValue((string) RegistrationEdit::decoy()->getValue());

        foreach ([[1, 1], [127, 1], [999_999_999, 1], [127, 2]] as [$id, $generation]) {
            $this->assertFalse(RegistrationEdit::authorizes($decoy, $this->pending($id, $generation)));
        }
    }

    private function pending(int $id, int $securityVersion): PendingRegistration
    {
        return (new PendingRegistration)->forceFill(['id' => $id, 'security_version' => $securityVersion]);
    }

    private function requestCarryingValue(string $value): Request
    {
        return Request::create('/', 'GET', [], [RegistrationEdit::cookieName() => $value]);
    }
}
