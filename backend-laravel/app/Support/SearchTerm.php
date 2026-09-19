<?php

namespace App\Support;

/**
 * A search box is a search, not a pattern language.
 *
 * Every list endpoint in this application feeds `q` straight into `ILIKE`. The
 * operator types a word, but PostgreSQL reads `%` and `_` as wildcards, so an
 * email search for `a_b@example.test` also matched `axb@example.test`, a search
 * for `100%` matched everything starting with `100`, and a lone `%` turned the
 * pagination `count()` into a scan of the whole table.
 *
 * The escaping is the conventional one: the escape character itself first, then
 * the two wildcards. PostgreSQL uses `\` as the default escape for `LIKE` and
 * `ILIKE`, which is why the pattern can be bound as a plain parameter; the
 * recovery-requests endpoint in the admin console already did this by hand with
 * an explicit `ESCAPE` clause, and this class is that same rule in one place
 * instead of six.
 *
 * `contains()` returns `''` for an empty term so callers keep a single
 * `!== ''` guard rather than duplicating the trimming rule.
 */
final class SearchTerm
{
    /** Longest term any endpoint accepts; longer input is truncated, not refused. */
    public const MAX_LENGTH = 200;

    /**
     * `%term%` with `\`, `%` and `_` escaped, or `''` when there is no term.
     *
     * The bound parameter is what makes the escaping effective: it never
     * reaches the SQL text, so nothing is interpolated and nothing is
     * double-escaped by the driver.
     */
    public static function contains(?string $raw, int $maxLength = self::MAX_LENGTH): string
    {
        $term = self::clean($raw, $maxLength);
        if ($term === '') {
            return '';
        }

        return '%'.self::escape($term).'%';
    }

    /** The escaped term without wildcards, for callers that build their own pattern. */
    public static function escape(string $term): string
    {
        return str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $term);
    }

    private static function clean(?string $raw, int $maxLength): string
    {
        if ($raw === null) {
            return '';
        }

        $limit = $maxLength > 0 ? $maxLength : self::MAX_LENGTH;

        return mb_substr(trim($raw), 0, $limit);
    }
}
