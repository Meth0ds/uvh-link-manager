<?php

namespace App\Support;

use App\Exceptions\LinkException;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

final class LinkPreferences
{
    public static function enabled(): void
    {
        if (! config('workflows.enabled')) {
            throw new LinkException('Las mejoras de enlaces todavía no están activadas.', 404);
        }
    }

    public static function mutate(Request $request, callable $callback): mixed
    {
        self::enabled();

        return DB::transaction(function () use ($request, $callback) {
            $user = UvhRequest::user($request);
            $context = SecurityContext::lock($user, UvhRequest::sessionId($request), requireVerifiedEmail: true);
            if (! $context || ! WorkspaceAccess::getMembershipForContext($context, UvhRequest::workspaceId($request))) {
                throw new LinkException('Tu acceso al workspace cambió.', 403);
            }

            return $callback();
        });
    }

    public static function validateSpec(mixed $spec): void
    {
        if (! is_array($spec) || ($spec['version'] ?? null) !== 1
            || array_diff(array_keys($spec), ['version', 'q', 'state', 'tag', 'domainId', 'collectionId', 'utmCampaign', 'favorites', 'sort']) !== []) {
            throw new LinkException('Filtro inválido.', 422);
        }
        foreach (['q' => 300, 'tag' => 40, 'utmCampaign' => 100] as $key => $limit) {
            $value = $spec[$key] ?? '';
            if (! is_string($value) || ! mb_check_encoding($value, 'UTF-8') || mb_strlen($value) > $limit || preg_match('/[\p{Cc}\p{Cf}]/u', $value)) {
                throw new LinkException('Filtro inválido.', 422);
            }
        }
        foreach (['domainId', 'collectionId'] as $key) {
            $value = $spec[$key] ?? null;
            if ($value !== null && (! is_int($value) || $value < 1)) {
                throw new LinkException('Referencia del filtro inválida.', 422);
            }
        }
        if (! in_array($spec['state'] ?? '', ['', 'active', 'scheduled', 'paused', 'expired', 'archived', 'blocked'], true)
            || ! in_array($spec['sort'] ?? 'created_at_desc', ['created_at_desc', 'created_at_asc', 'clicks_desc', 'alias_asc'], true)
            || (isset($spec['favorites']) && ! is_bool($spec['favorites']))) {
            throw new LinkException('Filtro inválido.', 422);
        }
    }

    /** @param array<string, mixed> $spec
     * @return array<string, mixed>
     */
    public static function canonicalSpec(array $spec): array
    {
        foreach (['q', 'state', 'tag', 'utmCampaign'] as $field) {
            $spec[$field] = $spec[$field] ?? '';
        }
        $spec['sort'] = $spec['sort'] ?? 'created_at_desc';
        $spec['favorites'] = $spec['favorites'] ?? false;

        return array_replace(['version' => 1, 'q' => '', 'state' => '', 'tag' => '',
            'domainId' => null, 'collectionId' => null, 'utmCampaign' => '',
            'favorites' => false, 'sort' => 'created_at_desc'], $spec);
    }

    /** @param array<string, mixed> $spec
     * @return list<string>
     */
    public static function missingReferences(array $spec, int $workspaceId): array
    {
        $missing = [];
        foreach (['domainId' => 'custom_domains', 'collectionId' => 'collections'] as $key => $table) {
            if (! empty($spec[$key]) && ! DB::table($table)->where('workspace_id', $workspaceId)->where('id', $spec[$key])->exists()) {
                $missing[] = $key;
            }
        }
        if (isset($spec['tag']) && $spec['tag'] !== '' && ! DB::table('tags')->where('workspace_id', $workspaceId)->where('name', $spec['tag'])->exists()) {
            $missing[] = 'tag';
        }

        return $missing;
    }

    /**
     * Resolve references once per resource kind, never once per saved filter.
     *
     * @param  Collection<int, \stdClass>  $rows
     * @return list<array<string, mixed>>
     */
    public static function presentMany(Collection $rows, int $workspaceId): array
    {
        $specs = $rows->map(static fn (object $row): array => json_decode($row->spec, true, 32, JSON_THROW_ON_ERROR));
        $references = [];
        foreach (['domainId' => ['custom_domains', 'id'], 'collectionId' => ['collections', 'id'], 'tag' => ['tags', 'name']] as $key => [$table, $column]) {
            $requested = $specs->pluck($key)->filter(static fn ($value): bool => $value !== null && $value !== '')->unique()->values()->all();
            $references[$key] = $requested === [] ? [] : DB::table($table)->where('workspace_id', $workspaceId)->whereIn($column, $requested)->pluck($column)->all();
        }

        return $rows->map(static function (object $row, int $index) use ($specs, $references): array {
            $spec = $specs[$index];
            $missing = [];
            foreach ($references as $key => $values) {
                if (isset($spec[$key]) && $spec[$key] !== '' && ! in_array($spec[$key], $values, true)) {
                    $missing[] = $key;
                }
            }

            return self::present($row, $missing);
        })->values()->all();
    }

    /** @param list<string>|null $missing
     * @return array<string, mixed>
     */
    public static function present(object $row, ?array $missing = null): array
    {
        $spec = self::canonicalSpec(json_decode($row->spec, true, 32, JSON_THROW_ON_ERROR));
        $missing ??= self::missingReferences($spec, (int) $row->workspace_id);

        return ['id' => (int) $row->id, 'name' => $row->name, 'spec' => $spec,
            'version' => (int) $row->version, 'valid' => $missing === [], 'invalidReferences' => $missing];
    }
}
