<?php

namespace App\Support;

use Illuminate\Database\Query\Builder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Destinations the platform refuses to redirect to.
 *
 * Moderation used to act on the link, never on the destination: blocking a
 * phishing link left the same URL one click away, reachable through a second
 * link or through a redirect rule. This is the destination half of that
 * decision, and it is deliberately local and deterministic — a denylist entry
 * needs no provider, no network call and no threshold.
 *
 * Matching is by label, never by substring: an entry for `evil.example` covers
 * `evil.example` and its subdomains, because an abuser rotates subdomains, and
 * it can never cover `notevil.example`. The walk stops above the public suffix
 * (`co.uk`, `github.io`): see `PublicSuffixes` for why the last label is the
 * wrong place to stop. URLs are compared as a canonical form — lowercased
 * scheme/host, default port, empty query and fragment removed, dot segments
 * resolved, unreserved escapes decoded — hashed with SHA-256, so the denylist
 * never stores a browsing target in clear text.
 */
final class DestinationDenylist
{
    public const KIND_HOST = 'host';

    public const KIND_URL = 'url';

    public const SOURCE_MANUAL = 'manual';

    public const SOURCE_PROVIDER = 'provider';

    public const SOURCE_REPORT = 'report';

    /**
     * Canonical host: lowercased, trailing dot removed, IPv6 brackets stripped,
     * IDN converted to ASCII. Mirrors what `UrlUtil::validateDestination`
     * accepts, so a destination that passes validation always has a host this
     * can compare.
     */
    public static function normalizeHost(string $raw): ?string
    {
        $host = trim($raw);
        if ($host === '' || preg_match('/[^\x20-\x7e]/', $host)) {
            if ($host === '' || ! function_exists('idn_to_ascii')) {
                return null;
            }
            $converted = idn_to_ascii($host, IDNA_DEFAULT);
            if (! is_string($converted) || $converted === '') {
                return null;
            }
            $host = $converted;
        }

        if (str_starts_with($host, '[') && str_ends_with($host, ']')) {
            $host = substr($host, 1, -1);
        }
        $host = strtolower(rtrim($host, '.'));
        if ($host === '' || strlen($host) > 253) {
            return null;
        }

        // A host that names an address must be stored in the single spelling
        // every other spelling of that address reaches. `filter_var` accepts
        // only the dotted quad and a full IPv6 form, while a browser resolves
        // `127.1`, `0177.0.0.1`, `0x7f000001` and `2130706433` to the very same
        // loopback address: an entry written for `127.0.0.1` would be walked
        // around with a shorter spelling of the address it names.
        $address = self::canonicalAddress($host);
        if ($address !== null) {
            return $address;
        }

        return $host;
    }

    /**
     * Canonical spelling of an IP literal, or null when the host is not one.
     *
     * `inet_pton` is strict and refuses the legacy IPv4 forms a browser still
     * resolves; those are parsed here with `inet_aton` semantics and printed
     * back by `inet_ntop`, which also normalises IPv6 (`0:0:0:0:0:0:0:1` and
     * `::1` are one address, and so are `::ffff:127.0.0.1` and its full form).
     */
    private static function canonicalAddress(string $host): ?string
    {
        $packed = @inet_pton($host);
        if (! is_string($packed)) {
            $packed = self::packLegacyIpv4($host);
        }
        if (! is_string($packed)) {
            return null;
        }
        $printed = @inet_ntop($packed);

        return is_string($printed) && $printed !== '' ? strtolower($printed) : null;
    }

    /**
     * Pack the IPv4 spellings `inet_pton` rejects but a resolver accepts.
     *
     * `inet_aton` reads up to four dot-separated parts left to right and gives
     * the last one every byte that remains, so `127.1` is 127.0.0.1 and so is
     * `127.0.1`; a single part is the whole 32-bit address (`2130706433`). Each
     * part is hexadecimal with a `0x` prefix, octal with a leading zero, or
     * decimal.
     */
    private static function packLegacyIpv4(string $host): ?string
    {
        if ($host === '' || preg_match('/^[0-9a-fx.]+$/D', $host) !== 1) {
            return null;
        }

        $parts = explode('.', $host);
        $count = count($parts);
        if ($count > 4) {
            return null;
        }
        $values = [];
        foreach ($parts as $part) {
            $value = self::legacyIpv4Part($part);
            if ($value === null) {
                return null;
            }
            $values[] = $value;
        }

        $address = match ($count) {
            1 => $values[0] > 0xFFFFFFFF ? null : $values[0],
            2 => $values[0] > 0xFF || $values[1] > 0xFFFFFF
                ? null
                : ($values[0] << 24) | $values[1],
            3 => $values[0] > 0xFF || $values[1] > 0xFF || $values[2] > 0xFFFF
                ? null
                : ($values[0] << 24) | ($values[1] << 16) | $values[2],
            default => $values[0] > 0xFF || $values[1] > 0xFF || $values[2] > 0xFF || $values[3] > 0xFF
                ? null
                : ($values[0] << 24) | ($values[1] << 16) | ($values[2] << 8) | $values[3],
        };
        if ($address === null) {
            return null;
        }

        return pack('N', $address & 0xFFFFFFFF);
    }

    private static function legacyIpv4Part(string $part): ?int
    {
        if ($part === '') {
            return null;
        }
        if (preg_match('/^0x[0-9a-f]+$/D', $part) === 1) {
            return (int) hexdec(substr($part, 2));
        }
        if (preg_match('/^0[0-7]+$/D', $part) === 1) {
            return (int) octdec($part);
        }

        return ctype_digit($part) ? (int) $part : null;
    }

    /**
     * Canonical form of a destination: the URL as a browser would send it.
     *
     * Every rule here exists because the alternative lets an entry be walked
     * past by a URL that reaches the same page:
     *
     *  - the fragment is dropped, because it never reaches a server;
     *  - dot segments are resolved (RFC 3986 §5.2.4), because a browser sends
     *    `/x/../blocked` as `/blocked` — an entry for `/blocked` that ignores
     *    this is an entry that does not protect the page it names;
     *  - unreserved percent-escapes are decoded and the rest are upper-cased,
     *    so `%7E` and `~`, `%2e%2e` and `..`, `%2F` and `%2f` compare equal;
     *    a *reserved* escape is never decoded, because doing so would change
     *    what the server receives (`%2F` is a path segment, `/` is not);
     *  - the default port and an empty query are removed.
     *
     * Embedding credentials (`https://user:pass@host/`) is not normalised here
     * because `UrlUtil::validateDestination` refuses such a URL outright: it can
     * neither be stored as a destination nor as an entry.
     */
    public static function normalizeUrl(string $raw): ?string
    {
        $valid = UrlUtil::validateDestination($raw);
        if (! $valid['ok']) {
            return null;
        }

        $parts = parse_url(trim($raw));
        if ($parts === false || ! isset($parts['scheme'], $parts['host'])) {
            return null;
        }
        $host = self::normalizeHost((string) $parts['host']);
        if ($host === null) {
            return null;
        }

        $scheme = strtolower((string) $parts['scheme']);
        $port = isset($parts['port']) ? (int) $parts['port'] : null;
        $defaultPort = ($scheme === 'https' && $port === 443) || ($scheme === 'http' && $port === 80);
        // Decode before resolving dot segments, so `%2e%2e` becomes `..` and is
        // then removed exactly like the literal form.
        $path = self::removeDotSegments(self::normalizeEscapes((string) ($parts['path'] ?? '')));
        $rawQuery = (string) ($parts['query'] ?? '');
        $query = $rawQuery === '' ? '' : '?'.self::normalizeEscapes($rawQuery);

        return $scheme.'://'.(str_contains($host, ':') ? '['.$host.']' : $host)
            .($defaultPort || $port === null ? '' : ':'.$port)
            .($path === '' ? '/' : $path)
            .$query;
    }

    /**
     * Decode what RFC 3986 calls unreserved, upper-case every other escape.
     *
     * `%2F` and `%2f` name the same octet, but that octet is a reserved
     * character: decoding it would turn an encoded slash into a separator and
     * merge two different paths into one.
     */
    private static function normalizeEscapes(string $value): string
    {
        return (string) preg_replace_callback('/%([0-9A-Fa-f]{2})/', function (array $match): string {
            $character = chr((int) hexdec($match[1]));
            if (preg_match('/[A-Za-z0-9\-._~]/', $character) === 1) {
                return $character;
            }

            return '%'.strtoupper($match[1]);
        }, $value);
    }

    /** RFC 3986 §5.2.4: the path as a browser resolves it before sending. */
    private static function removeDotSegments(string $path): string
    {
        $input = $path;
        $output = '';
        while ($input !== '') {
            if (str_starts_with($input, '../')) {
                $input = substr($input, 3);
            } elseif (str_starts_with($input, './')) {
                $input = substr($input, 2);
            } elseif (str_starts_with($input, '/./')) {
                $input = '/'.substr($input, 3);
            } elseif ($input === '/.') {
                $input = '/';
            } elseif (str_starts_with($input, '/../')) {
                $input = '/'.substr($input, 4);
                $output = substr($output, 0, (int) strrpos($output, '/'));
            } elseif ($input === '/..') {
                $input = '/';
                $output = substr($output, 0, (int) strrpos($output, '/'));
            } elseif ($input === '.' || $input === '..') {
                $input = '';
            } else {
                $slash = strpos($input, '/', str_starts_with($input, '/') ? 1 : 0);
                if ($slash === false) {
                    $output .= $input;
                    $input = '';
                } else {
                    $output .= substr($input, 0, $slash);
                    $input = substr($input, $slash);
                }
            }
        }

        return $output;
    }

    /**
     * @return array{host: string, url_hash: string}|null
     */
    public static function key(string $destination): ?array
    {
        $normalized = self::normalizeUrl($destination);
        if ($normalized === null) {
            return null;
        }
        $host = parse_url($normalized, PHP_URL_HOST);
        if (! is_string($host) || $host === '') {
            return null;
        }

        return [
            'host' => self::normalizeHost($host) ?? '',
            'url_hash' => hash('sha256', $normalized),
        ];
    }

    /**
     * Reason the destination is listed, or null when it is not.
     *
     * One indexed lookup per kind; a denied destination therefore costs two
     * point lookups on the write path and nothing at all on the redirect path.
     */
    public static function reason(string $destination): ?string
    {
        $key = self::key($destination);
        if ($key === null) {
            return null;
        }

        $url = self::active()
            ->where('match_kind', self::KIND_URL)
            ->where('match_value', $key['url_hash'])
            ->value('reason');
        if (is_string($url)) {
            return $url;
        }

        return self::hostReason($key['host']);
    }

    public static function hostReason(string $host): ?string
    {
        $candidates = self::hostCandidates($host);
        if ($candidates === []) {
            return null;
        }

        $reason = self::active()
            ->where('match_kind', self::KIND_HOST)
            ->whereIn('match_value', $candidates)
            ->orderByRaw('length(match_value) DESC')
            ->value('reason');

        return is_string($reason) ? $reason : null;
    }

    /**
     * The host and each of its parent names down to — but not including — its
     * public suffix. That is what makes an entry cover subdomains without a
     * substring match: `evil.example` yields `evil.example` and stops, never
     * `notevil.example`; `a.b.evil.example` also yields `b.evil.example`.
     *
     * The floor is one label above the public suffix rather than one label above
     * the end, so `evil.co.uk` yields `evil.co.uk` and not `co.uk`, and
     * `x.github.io` never yields `github.io`. A host that *is* a public suffix
     * yields only itself: nothing can be registered under it, and a legacy entry
     * for it should still match the exact string it names.
     *
     * @return list<string>
     */
    public static function hostCandidates(string $host): array
    {
        $normalized = self::normalizeHost($host);
        if ($normalized === null || filter_var($normalized, FILTER_VALIDATE_IP) !== false) {
            return $normalized === null ? [] : [$normalized];
        }

        $labels = explode('.', $normalized);
        $floor = PublicSuffixes::suffixLabels($normalized);
        $candidates = [];
        for ($i = 0; $i < count($labels); $i++) {
            // Stop before the public suffix (or, without one, before the last
            // label): a single trailing label is not a registrable host, and
            // keeping it would turn one entry into a TLD-wide block.
            if (count($labels) - $i <= max(1, $floor)) {
                break;
            }
            $candidates[] = implode('.', array_slice($labels, $i));
        }

        return $candidates === [] ? [$normalized] : $candidates;
    }

    public static function blockHost(string $host, string $reason, string $source = self::SOURCE_MANUAL, ?int $createdBy = null, ?Carbon $expiresAt = null): ?int
    {
        $normalized = self::normalizeHost($host);

        return $normalized === null ? null : self::add(self::KIND_HOST, $normalized, $reason, $source, $createdBy, $expiresAt);
    }

    public static function blockUrl(string $destination, string $reason, string $source = self::SOURCE_MANUAL, ?int $createdBy = null, ?Carbon $expiresAt = null): ?int
    {
        $key = self::key($destination);

        return $key === null ? null : self::add(self::KIND_URL, $key['url_hash'], $reason, $source, $createdBy, $expiresAt);
    }

    /**
     * Store one entry, or refuse it.
     *
     * What lands in `match_value` is what the matcher compares against, so it
     * has to be the canonical form of its kind. Anything else is a row that the
     * moderation console shows as active protection and that no destination can
     * ever match: `evil.com.`, `evil.com:8080`, `[::1]` or an IDN left in UTF-8
     * never equal the host derived from a link, and a `KIND_URL` entry holding
     * a pasted link instead of the hash the matcher computes is dead the moment
     * it is written. Refusing here is the only honest answer; the callers that
     * matter (`blockHost`, `blockUrl`) already canonicalise and only ever see
     * the refusal when the input genuinely cannot be a destination.
     */
    public static function add(string $kind, string $value, string $reason, string $source, ?int $createdBy = null, ?Carbon $expiresAt = null): ?int
    {
        if (! in_array($kind, [self::KIND_HOST, self::KIND_URL], true)
            || ! in_array($source, [self::SOURCE_MANUAL, self::SOURCE_PROVIDER, self::SOURCE_REPORT], true)) {
            return null;
        }

        $matchValue = match ($kind) {
            self::KIND_HOST => self::canonicalHostEntry($value),
            self::KIND_URL => self::canonicalUrlHash($value),
        };
        if ($matchValue === null) {
            return null;
        }
        // A host entry for a public suffix is refused, not stored disabled: it
        // would come back as a match for *every* site under it. `KIND_URL`
        // carries a hash, so the rule only applies to hosts.
        if ($kind === self::KIND_HOST && PublicSuffixes::isPublicSuffix($matchValue)) {
            return null;
        }
        // The unique index covers (kind, value) without the expiry filter, so an
        // expired entry is revived and re-reasoned instead of colliding with it.
        // A repeated moderation action must not fail just because it already
        // happened once.
        $row = [
            'reason' => mb_substr(trim($reason), 0, 500),
            'source' => $source,
            'created_by' => $createdBy,
            'expires_at' => $expiresAt,
            'updated_at' => now(),
        ];

        DB::transaction(function () use ($kind, $matchValue, $row): void {
            $updated = DB::table('destination_denylist')
                ->where('match_kind', $kind)
                ->where('match_value', $matchValue)
                ->update($row);
            if ($updated === 0) {
                DB::table('destination_denylist')->insertOrIgnore([
                    ...$row,
                    'match_kind' => $kind,
                    'match_value' => $matchValue,
                    'created_at' => now(),
                ]);
            }
        });

        $id = DB::table('destination_denylist')
            ->where('match_kind', $kind)
            ->where('match_value', $matchValue)
            ->value('id');

        return is_numeric($id) ? (int) $id : null;
    }

    /**
     * Canonical host for an entry, from what a human or a job hands over.
     *
     * A pasted URL contributes its host, `host:port` loses the port (a host
     * entry is compared against hosts, which never carry one), and the result
     * must have the shape a validated destination could produce — otherwise the
     * entry would be dead on arrival.
     */
    private static function canonicalHostEntry(string $value): ?string
    {
        $candidate = trim($value);
        if (str_contains($candidate, '://')) {
            $host = parse_url($candidate, PHP_URL_HOST);
            if (! is_string($host) || $host === '') {
                return null;
            }
            $candidate = $host;
        }
        // One colon and a numeric tail is `host:port`; an IPv6 literal has more
        // colons than that (or arrives bracketed and is settled by
        // `normalizeHost` below).
        if (! str_starts_with($candidate, '[') && substr_count($candidate, ':') === 1) {
            [$host, $port] = explode(':', $candidate, 2);
            if ($host !== '' && ctype_digit($port)) {
                $candidate = $host;
            }
        }

        $host = self::normalizeHost($candidate);
        if ($host === null) {
            return null;
        }
        if ($host === 'localhost' || filter_var($host, FILTER_VALIDATE_IP) !== false) {
            return $host;
        }

        return UrlUtil::isValidHostname($host) ? $host : null;
    }

    /** A `KIND_URL` entry only ever holds the hash `key()` computes. */
    private static function canonicalUrlHash(string $value): ?string
    {
        $hash = strtolower(trim($value));

        return preg_match('/^[0-9a-f]{64}$/D', $hash) === 1 ? $hash : null;
    }

    /** @return int number of entries removed */
    public static function remove(int $id): int
    {
        return DB::table('destination_denylist')->where('id', $id)->delete();
    }

    public static function count(): int
    {
        return self::active()->count();
    }

    /**
     * Entries that apply to a destination, for a human to review.
     *
     * @return list<object>
     */
    public static function entriesFor(string $destination): array
    {
        $key = self::key($destination);
        if ($key === null) {
            return [];
        }

        return self::active()
            ->where(function ($query) use ($key) {
                $query->where(function ($inner) use ($key) {
                    $inner->where('match_kind', self::KIND_URL)->where('match_value', $key['url_hash']);
                })->orWhere(function ($inner) use ($key) {
                    $inner->where('match_kind', self::KIND_HOST)->whereIn('match_value', self::hostCandidates($key['host']));
                });
            })
            ->orderBy('id')
            ->get(['id', 'match_kind', 'match_value', 'reason', 'source', 'expires_at'])
            ->all();
    }

    /**
     * Entries that are in force right now.
     *
     * A write deliberately does not come through here: `add()` matches the row
     * directly so that reviving an expired entry updates it in place instead of
     * colliding with the unique index, which does not carry the expiry filter.
     */
    private static function active(): Builder
    {
        return DB::table('destination_denylist')->where(function ($inner) {
            $inner->whereNull('expires_at')->orWhere('expires_at', '>', now());
        });
    }
}
