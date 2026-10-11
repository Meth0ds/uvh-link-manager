<?php

namespace App\Support;

use App\Models\Link;
use Illuminate\Database\Eloquent\Builder;

/** Literal matching shared by the library, trash and command palette. */
final class LinkSearch
{
    public const DISPLAY_NAME_SQL = 'lower(COALESCE(name, alias))';

    /** @param Builder<Link> $query */
    public static function matching(Builder $query, string $pattern): void
    {
        if ($pattern === '') {
            return;
        }
        $query->where(fn ($q) => $q->where('links.name', 'ilike', $pattern)
            ->orWhere('links.alias', 'ilike', $pattern)->orWhere('links.destination', 'ilike', $pattern)
            ->orWhere('links.notes', 'ilike', $pattern));
    }

    /** @param Builder<Link> $query */
    public static function rank(Builder $query, string $term): void
    {
        $exact = SearchTerm::escape($term);
        $prefix = $exact.'%';
        $query->orderByRaw('CASE WHEN links.name ILIKE ? OR links.alias ILIKE ? THEN 0 WHEN links.name ILIKE ? OR links.alias ILIKE ? THEN 1 ELSE 2 END', [$exact, $exact, $prefix, $prefix])
            ->orderByDesc('links.id');
    }
}
