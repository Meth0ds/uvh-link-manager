<?php

namespace App\Support;

use App\Exceptions\LinkException;
use App\Models\Link;
use App\Models\Tag;
use Illuminate\Support\Facades\DB;

class LinkService
{
    /**
     * @return array{ok: bool, error?: string}
     */    public static function validate(array $input): array
    {
        if (! is_string($input['destination'] ?? null)) {
            return ['ok' => false, 'error' => 'URL de destino inválida'];
        }
        $dest = UrlUtil::validateDestination($input['destination']);
        if (! $dest['ok']) {
            return ['ok' => false, 'error' => $dest['error']];
        }

        $fallback = $input['fallback_destination'] ?? null;
        if ($fallback !== null && ! is_string($fallback)) {
            return ['ok' => false, 'error' => 'Destino fallback inválido'];
        }
        if (is_string($fallback) && $fallback !== '') {
            $fb = UrlUtil::validateDestination($fallback);
            if (! $fb['ok']) {
                return ['ok' => false, 'error' => "Destino fallback: {$fb['error']}"];
            }
        }

        $alias = $input['alias'] ?? null;
        if ($alias !== null && ! is_string($alias)) {
            return ['ok' => false, 'error' => 'Alias inválido'];
        }
        if (is_string($alias) && $alias !== '') {
            $normalizedAlias = UrlUtil::normalizeAlias($alias);
            if (UrlUtil::isReservedAlias($normalizedAlias)) {
                return ['ok' => false, 'error' => 'Este alias está reservado'];
            }
            if (! UrlUtil::isValidCustomAlias($normalizedAlias)) {
                return ['ok' => false, 'error' => 'Alias inválido (solo letras, números, - y _)'];
            }
        }

        $domainId = $input['domain_id'] ?? null;
        if ($domainId !== null && (! is_int($domainId) || $domainId < 1)) {
            return ['ok' => false, 'error' => 'Dominio inválido'];
        }
        $maxClicks = $input['max_clicks'] ?? null;
        if ($maxClicks !== null && (! is_int($maxClicks) || $maxClicks < 1 || $maxClicks > 10_000_000)) {
            return ['ok' => false, 'error' => 'Máximo de clics inválido'];
        }
        if (isset($input['single_use']) && ! is_bool($input['single_use'])) {
            return ['ok' => false, 'error' => 'Uso único inválido'];
        }

        foreach (['scheduled_at', 'expires_at'] as $field) {
            $value = $input[$field] ?? null;
            if ($value === '') {
                continue;
            }
            if ($value !== null && (! is_string($value) || strlen($value) > 64)) {
                return ['ok' => false, 'error' => 'Fecha inválida'];
            }
            if (is_string($value)) {
                try {
                    \Illuminate\Support\Carbon::parse($value);
                } catch (\Throwable) {
                    return ['ok' => false, 'error' => 'Fecha inválida'];
                }
            }
        }

        $notes = $input['notes'] ?? null;
        if ($notes !== null && (! is_string($notes) || mb_strlen($notes) > 1000 || preg_match('/[\\x00-\\x1f\\x7f]/', $notes))) {
            return ['ok' => false, 'error' => 'Notas inválidas'];
        }

        $utm = $input['utm'] ?? [];
        if ($utm !== null && ! is_array($utm)) {
            return ['ok' => false, 'error' => 'UTM inválido'];
        }
        foreach (['source', 'medium', 'campaign', 'term', 'content'] as $key) {
            $value = is_array($utm) ? ($utm[$key] ?? null) : null;
            if ($value !== null && (! is_string($value) || mb_strlen($value) > 100 || preg_match('/[\\x00-\\x1f\\x7f]/', $value))) {
                return ['ok' => false, 'error' => 'UTM inválido'];
            }
        }

        $tags = $input['tags'] ?? null;
        if ($tags !== null) {
            if (! is_array($tags) || count($tags) > 20) {
                return ['ok' => false, 'error' => 'Etiquetas inválidas'];
            }
            foreach ($tags as $tag) {
                if (! is_string($tag) || mb_strlen($tag) > 40 || preg_match('/[\\x00-\\x1f\\x7f]/', $tag)) {
                    return ['ok' => false, 'error' => 'Etiquetas inválidas'];
                }
            }
        }

        $rules = $input['rules'] ?? null;
        if ($rules !== null) {
            if (! is_array($rules) || count($rules) > 20) {
                return ['ok' => false, 'error' => 'Reglas inválidas'];
            }
            foreach ($rules as $rule) {
                $normalized = self::normalizeRule($rule);
                if ($normalized === null) {
                    return ['ok' => false, 'error' => 'Regla inválida'];
                }
                $result = UrlUtil::validateDestination($normalized['destination']);
                if (! $result['ok']) {
                    return ['ok' => false, 'error' => "Regla inválida: {$result['error']}" ];
                }
            }
        }

        return ['ok' => true];
    }

    /**
     * @return array{id: int, alias: string, state: string}
     */
    public static function create(int $workspaceId, int $userId, array $input): array
    {
        $domainId = $input['domain_id'] ?? null;

        if (! empty($input['alias'])) {
            $alias = UrlUtil::normalizeAlias($input['alias']);
            if (self::aliasExists($domainId, $alias)) {
                throw new LinkException('Este alias ya está en uso', 409);
            }
        } else {
            $alias = self::generateUniqueAlias($domainId);
        }

        $state = self::deriveState($input);
        $utm = $input['utm'] ?? [];

        return DB::transaction(function () use ($workspaceId, $userId, $domainId, $alias, $state, $utm, $input) {
            // Quota enforcement inside the transaction (no TOCTOU window). The
            // quota row is locked so concurrent creates serialize per workspace
            // (PostgreSQL read-committed would otherwise allow a race between
            // the count and the insert).
            $quota = DB::table('quotas')->where('workspace_id', $workspaceId)->lockForUpdate()->value('links_limit');
            $used = Link::where('workspace_id', $workspaceId)->whereNull('deleted_at')->count();
            if ($quota !== null && $used >= (int) $quota) {
                throw new LinkException('Cuota de enlaces alcanzada', 429);
            }

            $link = Link::create([
                'workspace_id' => $workspaceId,
                'created_by' => $userId,
                'domain_id' => $domainId,
                'alias' => $alias,
                'destination' => $input['destination'],
                'fallback_destination' => $input['fallback_destination'] ?? null,
                'state' => $state,
                'password_hash' => $input['password_hash'] ?? null,
                'max_clicks' => $input['max_clicks'] ?? null,
                'single_use' => ! empty($input['single_use']),
                'scheduled_at' => self::toDateTime($input['scheduled_at'] ?? null),
                'expires_at' => self::toDateTime($input['expires_at'] ?? null),
                'notes' => $input['notes'] ?? null,
                'utm_source' => $utm['source'] ?? null,
                'utm_medium' => $utm['medium'] ?? null,
                'utm_campaign' => $utm['campaign'] ?? null,
                'utm_term' => $utm['term'] ?? null,
                'utm_content' => $utm['content'] ?? null,
            ]);

            self::applyTags($link, $workspaceId, $input['tags'] ?? []);
            self::applyRules($link, $input['rules'] ?? []);

            return ['id' => $link->id, 'alias' => $alias, 'state' => $state];
        });
    }

    /**
     * @return array{id: int, alias: string, state: string}
     */
    public static function update(int $linkId, int $workspaceId, array $input): array
    {
        $link = Link::where('id', $linkId)->where('workspace_id', $workspaceId)->whereNull('deleted_at')->first();
        if (! $link) {
            throw new LinkException('Enlace no encontrado', 404);
        }

        $domainId = array_key_exists('domain_id', $input) ? $input['domain_id'] : $link->domain_id;
        $alias = ! empty($input['alias']) ? UrlUtil::normalizeAlias($input['alias']) : $link->alias;

        if (! empty($input['alias'])) {
            if (UrlUtil::isReservedAlias($alias)) {
                throw new LinkException('Este alias está reservado', 422);
            }
            if (! UrlUtil::isValidCustomAlias($alias)) {
                throw new LinkException('Alias inválido', 422);
            }
            if (self::aliasExists($domainId, $alias, $linkId)) {
                throw new LinkException('Este alias ya está en uso', 409);
            }
        }

        // Editing never changes lifecycle state.
        $state = $link->state ?? 'active';
        $utm = $input['utm'] ?? [];

        DB::transaction(function () use ($link, $domainId, $alias, $input, $utm, $workspaceId) {
            $link->update([
                'domain_id' => $domainId,
                'alias' => $alias,
                'destination' => $input['destination'],
                'fallback_destination' => $input['fallback_destination'] ?? null,
                'password_hash' => array_key_exists('password_hash', $input) ? $input['password_hash'] : $link->password_hash,
                'max_clicks' => $input['max_clicks'] ?? null,
                'single_use' => ! empty($input['single_use']),
                'scheduled_at' => self::toDateTime($input['scheduled_at'] ?? null),
                'expires_at' => self::toDateTime($input['expires_at'] ?? null),
                'notes' => $input['notes'] ?? null,
                'utm_source' => $utm['source'] ?? null,
                'utm_medium' => $utm['medium'] ?? null,
                'utm_campaign' => $utm['campaign'] ?? null,
                'utm_term' => $utm['term'] ?? null,
                'utm_content' => $utm['content'] ?? null,
            ]);

            if (array_key_exists('tags', $input)) {
                self::applyTags($link, $workspaceId, $input['tags'] ?? []);
            }
            if (array_key_exists('rules', $input)) {
                self::applyRules($link, $input['rules'] ?? []);
            }
        });

        return ['id' => $linkId, 'alias' => $alias, 'state' => $state];
    }

    public static function setState(int $linkId, int $workspaceId, string $next): void
    {
        DB::transaction(function () use ($linkId, $workspaceId, $next) {
            $link = Link::where('id', $linkId)->where('workspace_id', $workspaceId)->whereNull('deleted_at')->first();
            if (! $link) {
                throw new LinkException('Enlace no encontrado', 404);
            }
            if ($link->state === $next) {
                return;
            }
            $link->update(['state' => $next]);
        });
    }

    /**
     * @return array<string, mixed>
     */
    public static function dto(Link $link): array
    {
        $link->loadMissing('domain', 'tags');

        return [
            'id' => $link->id,
            'alias' => $link->alias,
            'destination' => $link->destination,
            'fallbackDestination' => $link->fallback_destination,
            'state' => $link->state,
            'clickCount' => (int) $link->click_count,
            'maxClicks' => $link->max_clicks,
            'singleUse' => (bool) $link->single_use,
            'usedAt' => self::iso($link->used_at),
            'scheduledAt' => self::iso($link->scheduled_at),
            'expiresAt' => self::iso($link->expires_at),
            'notes' => $link->notes,
            'passwordProtected' => (bool) $link->password_hash,
            'utm' => [
                'source' => $link->utm_source,
                'medium' => $link->utm_medium,
                'campaign' => $link->utm_campaign,
                'term' => $link->utm_term,
                'content' => $link->utm_content,
            ],
            'domainId' => $link->domain_id,
            'domain' => $link->domain?->domain,
            'tags' => $link->tags->pluck('name')->values()->all(),
            'createdAt' => self::iso($link->created_at),
            'updatedAt' => self::iso($link->updated_at),
            'shortUrl' => self::shortUrl($link->domain?->domain, $link->alias),
        ];
    }

    public static function shortUrl(?string $domain, string $alias): string
    {
        $host = $domain ?? (string) config('uvh.public_host');

        return "https://{$host}/{$alias}";
    }

    private static function deriveState(array $input): string
    {
        $scheduled = self::toDateTime($input['scheduled_at'] ?? null);
        $expires = self::toDateTime($input['expires_at'] ?? null);
        if ($scheduled && $scheduled->isFuture()) {
            return 'scheduled';
        }
        if ($expires && $expires->isPast()) {
            return 'expired';
        }

        return 'active';
    }

    private static function generateUniqueAlias(?int $domainId): string
    {
        for ($i = 0; $i < 10; $i++) {
            $alias = Ids::randomAlias(8);
            if (! self::aliasExists($domainId, $alias)) {
                return $alias;
            }
        }
        throw new LinkException('No se pudo generar un alias único', 500);
    }

    private static function aliasExists(?int $domainId, string $alias, ?int $exceptId = null): bool
    {
        $query = Link::query()
            ->where('alias', $alias)
            ->whereNull('deleted_at');

        if ($domainId === null) {
            $query->whereNull('domain_id');
        } else {
            $query->where('domain_id', $domainId);
        }
        if ($exceptId !== null) {
            $query->where('id', '!=', $exceptId);
        }

        return $query->exists();
    }

    private static function applyTags(Link $link, int $workspaceId, array $tags): void
    {
        $ids = [];
        foreach ($tags as $raw) {
            $name = substr(trim((string) $raw), 0, 40);
            if ($name === '') {
                continue;
            }
            $tag = Tag::where('workspace_id', $workspaceId)
                ->whereRaw('lower(name) = lower(?)', [$name])
                ->first();
            if (! $tag) {
                $tag = Tag::create(['workspace_id' => $workspaceId, 'name' => $name]);
            }
            $ids[] = $tag->id;
        }
        $link->tags()->sync($ids);
    }

    private static function applyRules(Link $link, array $rules): void
    {
        $link->rules()->delete();
        foreach ($rules as $rule) {
            $normalized = self::normalizeRule($rule);
            if ($normalized === null) {
                continue;
            }
            $link->rules()->create($normalized);
        }
    }

    /** @return array<string, mixed>|null */
    private static function normalizeRule(mixed $raw): ?array
    {
        if (! is_array($raw)) {
            return null;
        }

        $priority = $raw['priority'] ?? 0;
        $country = $raw['country'] ?? null;
        $language = $raw['language'] ?? null;
        $device = $raw['device'] ?? null;
        $os = $raw['os'] ?? null;
        $timeFrom = $raw['time_from'] ?? ($raw['timeFrom'] ?? null);
        $timeTo = $raw['time_to'] ?? ($raw['timeTo'] ?? null);
        $referrer = $raw['referrer'] ?? null;
        $campaign = $raw['campaign'] ?? null;
        $destination = $raw['destination'] ?? null;

        if (! is_int($priority) || $priority < 0 || $priority > 1000
            || ! is_string($destination) || $destination === '' || strlen($destination) > 2048) {
            return null;
        }
        if ($country !== null && (! is_string($country) || ! preg_match('/^[a-zA-Z]{2}$/', $country))) {
            return null;
        }
        if ($language !== null && (! is_string($language) || strlen($language) > 8 || ! preg_match('/^[a-zA-Z0-9-]+$/', $language))) {
            return null;
        }
        if ($device !== null && ! in_array($device, ['desktop', 'mobile', 'tablet'], true)) {
            return null;
        }
        if ($os !== null && (! is_string($os) || strlen($os) > 40 || preg_match('/[\\x00-\\x1f\\x7f]/', $os))) {
            return null;
        }
        foreach ([$timeFrom, $timeTo] as $time) {
            if ($time !== null && (! is_string($time) || ! preg_match('/^(?:[01]\\d|2[0-3]):[0-5]\\d$/', $time))) {
                return null;
            }
        }
        if ($referrer !== null && (! is_string($referrer) || strlen($referrer) > 200 || preg_match('/[\\x00-\\x1f\\x7f]/', $referrer))) {
            return null;
        }
        if ($campaign !== null && (! is_string($campaign) || strlen($campaign) > 100 || preg_match('/[\\x00-\\x1f\\x7f]/', $campaign))) {
            return null;
        }

        return [
            'priority' => $priority,
            'country' => $country,
            'language' => $language,
            'device' => $device,
            'os' => $os,
            'time_from' => $timeFrom,
            'time_to' => $timeTo,
            'referrer' => $referrer,
            'campaign' => $campaign,
            'destination' => $destination,
        ];
    }

    private static function toDateTime(?string $iso): ?\Illuminate\Support\Carbon
    {
        if ($iso === null || $iso === '') {
            return null;
        }

        return \Illuminate\Support\Carbon::parse($iso);
    }

    private static function iso(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }
        if ($value instanceof \DateTimeInterface) {
            return $value->format('Y-m-d\TH:i:s.v\Z');
        }

        return (string) $value;
    }
}
