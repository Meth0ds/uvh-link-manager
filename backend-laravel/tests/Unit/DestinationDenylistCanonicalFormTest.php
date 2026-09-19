<?php

namespace Tests\Unit;

use App\Support\DestinationDenylist;
use App\Support\PublicSuffixes;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * The denylist only works if two URLs that reach the same page compare equal,
 * and only if one entry cannot be turned into a block of an entire public
 * suffix.
 *
 * Both are pure functions, so they are pinned here rather than through the
 * database: a canonicalisation bug shows up as one failing string, not as a
 * moderation decision nobody can explain later.
 */
final class DestinationDenylistCanonicalFormTest extends TestCase
{
    /**
     * @return list<array{string, string}>
     */
    public static function equivalentForms(): array
    {
        return [
            // Dot segments: a browser resolves these before it sends anything,
            // so an entry for the resolved path must match the unresolved one.
            ['https://example.com/a/../b', 'https://example.com/b'],
            ['https://example.com/a/./b', 'https://example.com/a/b'],
            ['https://example.com/a/%2e%2e/b', 'https://example.com/b'],
            ['https://example.com/%2E%2E/b', 'https://example.com/b'],
            ['https://example.com/a/b/../../c', 'https://example.com/c'],
            ['https://example.com/../x', 'https://example.com/x'],
            // Percent-escapes of unreserved characters name the character
            // itself, and hex digits are case-insensitive.
            ['https://example.com/%7Euser', 'https://example.com/~user'],
            ['https://example.com/%41', 'https://example.com/A'],
            // ...but a reserved escape is never decoded; only its hex digits
            // are normalised: `%2F` is one segment, `//` is two, and the server
            // sees the difference.
            ['https://example.com/a%2fb', 'https://example.com/a%2Fb'],
            ['https://example.com/%2f', 'https://example.com/%2F'],
            // Scheme, host, default port, empty query and the fragment.
            ['HTTPS://EXAMPLE.COM/x', 'https://example.com/x'],
            ['https://example.com:443/x', 'https://example.com/x'],
            ['https://example.com/x?', 'https://example.com/x'],
            ['https://example.com/x#anchor', 'https://example.com/x'],
            ['https://example.com', 'https://example.com/'],
            ['https://example.com?a=%7e', 'https://example.com/?a=~'],
        ];
    }

    #[DataProvider('equivalentForms')]
    public function test_a_url_is_canonicalised_the_way_a_browser_resolves_it(string $raw, string $expected): void
    {
        $this->assertSame($expected, DestinationDenylist::normalizeUrl($raw));
    }

    public function test_two_forms_of_the_same_page_share_a_hash(): void
    {
        $entry = DestinationDenylist::key('https://example.com/blocked');
        $evasion = DestinationDenylist::key('https://evil.example/x/../blocked');

        $this->assertNotNull($entry);
        $this->assertNotNull($evasion);
        // The paths differ, so the hosts are what must not be conflated here:
        // the same host is the property under test.
        $samePage = DestinationDenylist::key('https://example.com/a/../blocked');
        $this->assertNotNull($samePage);
        $this->assertSame($entry['url_hash'], $samePage['url_hash']);
        $this->assertNotSame($entry['url_hash'], $evasion['url_hash']);
    }

    public function test_a_reserved_escape_is_not_a_separator(): void
    {
        // Decoding `%2F` would merge two different paths into one, which would
        // make an entry for one of them cover the other.
        $this->assertNotSame(
            DestinationDenylist::normalizeUrl('https://example.com/a%2Fb'),
            DestinationDenylist::normalizeUrl('https://example.com/a/b'),
        );
    }

    public function test_a_url_that_cannot_be_a_destination_has_no_canonical_form(): void
    {
        $this->assertNull(DestinationDenylist::normalizeUrl('javascript:alert(1)'));
        $this->assertNull(DestinationDenylist::normalizeUrl('https://user:pass@example.com/x'));
        $this->assertNull(DestinationDenylist::normalizeUrl(''));
    }

    /**
     * @return list<array{string, list<string>}>
     */
    public static function candidateLists(): array
    {
        return [
            // Without a public suffix the walk stops above the last label:
            // `example` alone is not a registrable host.
            ['evil.example', ['evil.example']],
            ['a.b.evil.example', ['a.b.evil.example', 'b.evil.example', 'evil.example']],
            // With one, the floor moves: `co.uk` and `github.io` are never
            // candidates, because blocking either would take down everything
            // hosted under it.
            ['evil.co.uk', ['evil.co.uk']],
            ['a.evil.co.uk', ['a.evil.co.uk', 'evil.co.uk']],
            ['x.github.io', ['x.github.io']],
            ['a.b.github.io', ['a.b.github.io', 'b.github.io']],
            // A host that *is* a suffix matches only itself: nothing can be
            // registered under it, and a legacy row names that exact string.
            ['co.uk', ['co.uk']],
            ['github.io', ['github.io']],
            ['localhost', ['localhost']],
            ['203.0.113.7', ['203.0.113.7']],
        ];
    }

    /**
     * @param  list<string>  $expected
     */
    #[DataProvider('candidateLists')]
    public function test_host_matching_stops_above_the_public_suffix(string $host, array $expected): void
    {
        $this->assertSame($expected, DestinationDenylist::hostCandidates($host));
    }

    public function test_the_subset_is_longest_suffix_aware_and_versioned(): void
    {
        $this->assertTrue(PublicSuffixes::isPublicSuffix('co.uk'));
        $this->assertTrue(PublicSuffixes::isPublicSuffix('github.io'));
        $this->assertFalse(PublicSuffixes::isPublicSuffix('evil.co.uk'));
        $this->assertFalse(PublicSuffixes::isPublicSuffix('x.github.io'));
        $this->assertFalse(PublicSuffixes::isPublicSuffix('example.com'));
        $this->assertFalse(PublicSuffixes::isPublicSuffix('com'));
        $this->assertSame('co.uk', PublicSuffixes::suffixOf('a.b.co.uk'));
        $this->assertSame(2, PublicSuffixes::suffixLabels('evil.co.uk'));
        $this->assertSame(0, PublicSuffixes::suffixLabels('example.com'));
        // The list is data that ages; the date is how a reviewer sees how far.
        $this->assertMatchesRegularExpression('/^\d{4}-\d{2}-\d{2}$/', PublicSuffixes::REVISED_AT);
    }
}
