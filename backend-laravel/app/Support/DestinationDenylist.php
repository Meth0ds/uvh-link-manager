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
 * it can never cover `notevil.example`. URLs are compared as a canonical form
 * (lowercased scheme/host, default port and fragment removed) hashed with
 * SHA-256, so the denylist never stores a browsing target in clear text.
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

        return $host;
    }

    /**
     * Canonical form of a destination. The fragment is dropped because it never
     * reaches a server: keeping it would let `#anything` walk past an entry.
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
        $path = (string) ($parts['path'] ?? '');
        $query = isset($parts['query']) ? '?'.$parts['query'] : '';

        return $scheme.'://'.(str_contains($host, ':') ? '['.$host.']' : $host)
            .($defaultPort || $port === null ? '' : ':'.$port)
            .($path === '' ? '/' : $path)
            .$query;
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
     * The host and each of its parent suffixes, which is what makes an entry
     * cover subdomains without a substring match: `evil.example` yields
     * `evil.example` and `example`+`evil.example`, never `notevil.example`.
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
        $candidates = [];
        for ($i = 0; $i < count($labels); $i++) {
            // A single trailing label (`example`) is not a registrable host on
            // its own; keeping it would turn one entry into a TLD-wide block.
            if ($i === count($labels) - 1 && count($labels) > 1) {
                continue;
            }
            $candidates[] = implode('.', array_slice($labels, $i));
        }

        return $candidates;
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

    public static function add(string $kind, string $value, string $reason, string $source, ?int $createdBy = null, ?Carbon $expiresAt = null): ?int
    {
        if (! in_array($kind, [self::KIND_HOST, self::KIND_URL], true)
            || ! in_array($source, [self::SOURCE_MANUAL, self::SOURCE_PROVIDER, self::SOURCE_REPORT], true)
            || trim($value) === '') {
            return null;
        }

        $matchValue = strtolower(trim($value));
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

    public static function blockHostId(string $host): ?int
    {
        $normalized = self::normalizeHost($host);
        if ($normalized === null) {
            return null;
        }
        $id = DB::table('destination_denylist')
            ->where('match_kind', self::KIND_HOST)
            ->where('match_value', $normalized)
            ->value('id');

        return is_numeric($id) ? (int) $id : null;
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
     * @param  bool  $forWrite  a write also matches an expired entry, so reviving
     *                          it updates the existing row instead of colliding
     *                          with the unique index
     */
    private static function active(bool $forWrite = false): Builder
    {
        $query = DB::table('destination_denylist');
        if (! $forWrite) {
            $query->where(function ($inner) {
                $inner->whereNull('expires_at')->orWhere('expires_at', '>', now());
            });
        }

        return $query;
    }
}
