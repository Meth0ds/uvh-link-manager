<?php

namespace Tests\Unit;

use App\Support\SearchTerm;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * A search box is a search, not a pattern language.
 *
 * `%` and `_` are wildcards inside `ILIKE`, so an unescaped term silently means
 * something other than what the operator typed: `a_b` also matched `axb`, `100%`
 * matched anything starting with `100`, and a lone `%` selected the whole table.
 * A trailing backslash was worse than imprecise — it is an incomplete escape
 * sequence and PostgreSQL refuses the query.
 */
final class SearchTermTest extends TestCase
{
    /**
     * @return list<array{string, string}>
     */
    public static function termsAndPatterns(): array
    {
        return [
            ['evil', '%evil%'],
            // The two wildcards, escaped so they mean themselves.
            ['a_b', '%a\\_b%'],
            ['100%', '%100\\%%'],
            ['%', '%\\%%'],
            ['_', '%\\_%'],
            // The escape character itself, doubled: once so it is literal, once
            // so a trailing one cannot make the pattern incomplete.
            ['back\\slash', '%back\\\\slash%'],
            ['back\\', '%back\\\\%'],
            // Surrounding whitespace is not part of a search term.
            ['  evil  ', '%evil%'],
            // Reserved characters are not special at all.
            ['a.b*c+d', '%a.b*c+d%'],
            ['O\'Brien', '%O\'Brien%'],
            ['%_\\', '%\\%\\_\\\\%'],
        ];
    }

    #[DataProvider('termsAndPatterns')]
    public function test_a_term_becomes_a_bound_pattern_with_the_metacharacters_escaped(string $term, string $expected): void
    {
        $this->assertSame($expected, SearchTerm::contains($term));
    }

    public function test_an_empty_term_has_no_pattern_so_callers_keep_one_guard(): void
    {
        $this->assertSame('', SearchTerm::contains(''));
        $this->assertSame('', SearchTerm::contains('   '));
        $this->assertSame('', SearchTerm::contains(null));
    }

    public function test_a_long_term_is_truncated_instead_of_refused(): void
    {
        $this->assertSame('%'.str_repeat('a', 100).'%', SearchTerm::contains(str_repeat('a', 500), 100));
        $this->assertSame('%'.str_repeat('a', 200).'%', SearchTerm::contains(str_repeat('a', 500)));
    }

    public function test_truncation_counts_characters_not_bytes(): void
    {
        // Cutting a multi-byte character in half would make PostgreSQL reject
        // the pattern as invalid UTF-8.
        $term = str_repeat('ñ', 150);
        $pattern = SearchTerm::contains($term, 100);

        $this->assertSame('%'.str_repeat('ñ', 100).'%', $pattern);
        $this->assertTrue(mb_check_encoding($pattern, 'UTF-8'));
    }
}
