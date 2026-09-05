<?php

namespace App\Http\Controllers;

use App\Exceptions\LinkException;
use App\Models\Link;
use App\Support\Audit;
use App\Support\LinkService;
use App\Support\UrlUtil;
use App\Support\UvhRequest;
use App\Support\WebhookService;
use App\Support\WorkspaceAccess;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

class LinkController
{
    public function index(Request $request)
    {
        $workspaceId = UvhRequest::workspaceId($request);

        $search = mb_substr(trim(UvhRequest::queryString($request, 'q')), 0, 200);
        $state = UvhRequest::queryString($request, 'state');
        $tag = UvhRequest::queryString($request, 'tag');
        $domainId = UvhRequest::queryString($request, 'domainId');
        $sort = UvhRequest::queryString($request, 'sort', 'created_at_desc');
        $page = $this->positiveQueryInteger($request->query('page'), 1, 10_000);
        $perPage = $this->positiveQueryInteger($request->query('perPage'), 20, 100);

        if ($state !== '' && ! in_array($state, ['scheduled', 'active', 'paused', 'expired', 'archived', 'blocked'], true)) {
            return response()->json(['error' => 'Filtro de estado inválido'], 422);
        }
        if ($tag !== '' && (! mb_check_encoding($tag, 'UTF-8') || mb_strlen($tag) > 40 || preg_match('/[\x00-\x1f\x7f]/', $tag))) {
            return response()->json(['error' => 'Filtro de etiqueta inválido'], 422);
        }
        if ($domainId !== '' && $this->positiveQueryInteger($domainId, 0, PHP_INT_MAX) === 0) {
            return response()->json(['error' => 'Filtro de dominio inválido'], 422);
        }

        $query = Link::with(['domain', 'tags'])
            ->where('workspace_id', $workspaceId)
            ->whereNull('deleted_at');

        if ($search !== '') {
            $like = "%{$search}%";
            $query->where(fn ($q) => $q
                ->where('alias', 'ilike', $like)
                ->orWhere('destination', 'ilike', $like)
                ->orWhere('notes', 'ilike', $like));
        }
        if ($state !== '') {
            $query->where('state', $state);
        }
        if ($domainId !== '') {
            $query->where('domain_id', $this->positiveQueryInteger($domainId, 0, PHP_INT_MAX));
        }
        if ($tag !== '') {
            $query->whereHas('tags', fn ($q) => $q->where('name', $tag));
        }

        $orderMap = [
            'created_at_desc' => ['created_at', 'desc'],
            'created_at_asc' => ['created_at', 'asc'],
            'clicks_desc' => ['click_count', 'desc'],
            'alias_asc' => ['alias', 'asc'],
        ];
        [$col, $dir] = $orderMap[$sort] ?? $orderMap['created_at_desc'];
        $query->orderBy($col, $dir);

        $total = (clone $query)->count();
        $rows = $query->offset(($page - 1) * $perPage)->limit($perPage)->get();

        return response()->json([
            'links' => $rows->map(fn ($l) => LinkService::dto($l))->values(),
            'total' => $total,
            'page' => $page,
            'perPage' => $perPage,
        ]);
    }

    public function checkAlias(Request $request)
    {
        $workspaceId = UvhRequest::workspaceId($request);
        $alias = UvhRequest::inputString($request, 'alias');
        $domainId = $request->input('domainId');

        if ($alias === '' || mb_strlen($alias) > 64) {
            return response()->json(['error' => 'Alias inválido'], 422);
        }

        $alias = UrlUtil::normalizeAlias($alias);
        if (UrlUtil::isReservedAlias($alias)) {
            return response()->json(['available' => false, 'reason' => 'reserved']);
        }
        if (! UrlUtil::isValidCustomAlias($alias)) {
            return response()->json(['available' => false, 'reason' => 'invalid']);
        }

        if ($domainId !== null && (! is_int($domainId) || $domainId < 1)) {
            return response()->json(['error' => 'Dominio inválido'], 422);
        }
        if ($domainId !== null) {
            $dom = DB::table('custom_domains')
                ->where('id', $domainId)
                ->where('workspace_id', $workspaceId)
                ->where('state', 'active')
                ->exists();
            if (! $dom) {
                return response()->json(['available' => false, 'reason' => 'domain']);
            }
        }

        $exists = Link::whereNull('deleted_at')->where('alias', $alias)
            ->when($domainId === null, fn ($q) => $q->whereNull('domain_id'))
            ->when($domainId !== null, fn ($q) => $q->where('domain_id', $domainId))
            ->exists();

        return response()->json(['available' => ! $exists]);
    }

    public function store(Request $request)
    {
        $workspaceId = UvhRequest::workspaceId($request);
        $user = UvhRequest::user($request);

        if (! $this->validLinkBody($request)) {
            return response()->json(['error' => 'Datos inválidos'], 422);
        }
        $input = $this->inputFromRequest($request);

        if ($input['domain_id'] !== null) {
            $dom = DB::table('custom_domains')
                ->where('id', $input['domain_id'])
                ->where('workspace_id', $workspaceId)
                ->where('state', 'active')
                ->exists();
            if (! $dom) {
                return response()->json(['error' => 'Dominio no activado o sin acceso'], 403);
            }
        }

        if ($request->has('password') && is_string($request->input('password')) && $request->input('password') !== '') {
            $input['password_hash'] = Hash::make($request->input('password'));
        }

        $valid = LinkService::validate($input);
        if (! $valid['ok']) {
            return response()->json(['error' => $valid['error']], 422);
        }

        try {
            $created = LinkService::create(
                $workspaceId,
                $user->id,
                $input,
                UvhRequest::apiToken($request),
                (int) $user->security_version,
            );
        } catch (LinkException $e) {
            return response()->json(['error' => $e->getMessage()], $e->status);
        }

        Audit::write($user->id, 'link.create', 'link', $created['id'], null, UvhRequest::ip($request), workspaceId: $workspaceId);

        $link = Link::with(['domain', 'tags'])
            ->where('id', $created['id'])->where('workspace_id', $workspaceId)->first();
        if (! $link) {
            return response()->json(['error' => 'El enlace dejó de estar disponible al finalizar la creación'], 409);
        }

        return response()->json(['link' => LinkService::dto($link)], 201);
    }

    public function show(Request $request, int $id)
    {
        $workspaceId = UvhRequest::workspaceId($request);
        $link = Link::with(['domain', 'tags'])
            ->where('id', $id)->where('workspace_id', $workspaceId)->whereNull('deleted_at')
            ->first();

        if (! $link) {
            return response()->json(['error' => 'Enlace no encontrado'], 404);
        }

        $rules = $link->rules()->orderBy('priority')->orderBy('id')->get()->map(fn ($r) => [
            'id' => $r->id,
            'priority' => (int) $r->priority,
            'country' => $r->country,
            'language' => $r->language,
            'device' => $r->device,
            'os' => $r->os,
            'timeFrom' => $r->time_from,
            'timeTo' => $r->time_to,
            'referrer' => $r->referrer,
            'campaign' => $r->campaign,
            'destination' => $r->destination,
            'createdAt' => $this->iso($r->created_at),
        ]);

        return response()->json(['link' => LinkService::dto($link), 'rules' => $rules]);
    }

    public function update(Request $request, int $id)
    {
        $workspaceId = UvhRequest::workspaceId($request);
        $user = UvhRequest::user($request);

        $current = Link::where('id', $id)->where('workspace_id', $workspaceId)->whereNull('deleted_at')->first();
        if (! $current) {
            return response()->json(['error' => 'Enlace no encontrado'], 404);
        }

        if (! $this->validLinkBody($request, true)) {
            return response()->json(['error' => 'Datos inválidos'], 422);
        }
        $expectedVersion = $request->input('version');
        if (! is_int($expectedVersion) || $expectedVersion < 1) {
            return response()->json(['error' => 'Falta la versión actual del enlace. Recárgalo e inténtalo de nuevo.'], 428);
        }
        $input = $this->inputFromRequest($request, $current);
        // `inputFromRequest` omits collection keys on PATCH unless the client
        // supplied them. An explicit empty array clears; absence preserves.
        $input['lifecycle_dates_changed'] = $request->has('scheduledAt') || $request->has('expiresAt');

        if ($request->has('domainId') && $request->input('domainId') !== null) {
            $dom = DB::table('custom_domains')
                ->where('id', (int) $request->input('domainId'))
                ->where('workspace_id', $workspaceId)
                ->where('state', 'active')
                ->exists();
            if (! $dom) {
                return response()->json(['error' => 'Dominio no activado o sin acceso'], 403);
            }
        }

        if ($request->has('password')) {
            $input['password_hash'] = $request->input('password') !== null && $request->input('password') !== ''
                ? Hash::make(UvhRequest::inputString($request, 'password'))
                : null;
            $input['password_changed'] = true;
        }

        $valid = LinkService::validate($input);
        if (! $valid['ok']) {
            return response()->json(['error' => $valid['error']], 422);
        }

        try {
            $updated = LinkService::update(
                $id,
                $workspaceId,
                $user->id,
                $input,
                $expectedVersion,
                UvhRequest::apiToken($request),
                (int) $user->security_version,
            );
        } catch (LinkException $e) {
            return response()->json(['error' => $e->getMessage()], $e->status);
        }

        Audit::write($user->id, 'link.update', 'link', $id, null, UvhRequest::ip($request), workspaceId: $workspaceId);

        $link = Link::with(['domain', 'tags'])
            ->where('id', $id)->where('workspace_id', $workspaceId)->first();
        if (! $link) {
            return response()->json(['error' => 'El enlace dejó de estar disponible al finalizar la actualización'], 409);
        }

        return response()->json(['link' => LinkService::dto($link)]);
    }

    public function state(Request $request, int $id)
    {
        $workspaceId = UvhRequest::workspaceId($request);
        $user = UvhRequest::user($request);

        $state = $request->input('state', '');
        $reason = $request->input('reason');
        $allowed = ['active', 'paused', 'archived'];

        if (! is_string($state) || ! in_array($state, $allowed, true)) {
            return response()->json(['error' => 'Estado inválido'], 422);
        }

        if ($reason !== null && (! is_string($reason) || ! mb_check_encoding($reason, 'UTF-8') || mb_strlen($reason) > 500 || preg_match('/[\x00-\x1f\x7f]/', $reason))) {
            return response()->json(['error' => 'Motivo inválido'], 422);
        }

        try {
            $apiTokenContext = UvhRequest::apiToken($request);
            $transition = DB::transaction(function () use ($workspaceId, $user, $id, $state, $apiTokenContext): array {
                if (! WorkspaceAccess::getMembershipLocked(
                    $user->id,
                    $workspaceId,
                    'editor',
                    $apiTokenContext,
                    'links:write',
                    (int) $user->security_version,
                )) {
                    throw new LinkException('Tu acceso al workspace cambió. Recarga antes de continuar.', 403);
                }
                $link = Link::where('id', $id)->where('workspace_id', $workspaceId)
                    ->whereNull('deleted_at')->lockForUpdate()->first();
                if (! $link) {
                    throw new LinkException('Enlace no encontrado', 404);
                }
                if ($link->state === 'blocked') {
                    throw new LinkException('El bloqueo de enlaces solo se gestiona desde la administración de la plataforma', 403);
                }
                if ($state === 'active' && $link->scheduled_at && $link->scheduled_at->isFuture()) {
                    throw new LinkException('El enlace sigue programado. Modifica su fecha de activación antes de activarlo.', 409);
                }
                if ($state === 'active' && $link->expires_at && $link->expires_at->isPast()) {
                    throw new LinkException('El enlace ya ha caducado. Amplía su fecha de caducidad antes de activarlo.', 409);
                }
                $from = $link->state;
                if ($from !== $state) {
                    $link->update(['state' => $state, 'version' => (int) $link->version + 1, 'updated_at' => now()]);
                    WebhookService::dispatch($workspaceId, 'link.updated', [
                        'linkId' => $id,
                        'alias' => (string) $link->alias,
                        'state' => $state,
                    ]);
                }

                return ['from' => $from, 'to' => $state];
            });
        } catch (LinkException $e) {
            return response()->json(['error' => $e->getMessage()], $e->status);
        }

        Audit::write($user->id, 'link.state_change', 'link', $id, [
            'from' => $transition['from'],
            'to' => $transition['to'],
            'reason' => is_string($reason) ? $reason : null,
        ], UvhRequest::ip($request), workspaceId: $workspaceId);

        return response()->json(['ok' => true, 'state' => $transition['to']]);
    }

    public function destroy(Request $request, int $id)
    {
        $workspaceId = UvhRequest::workspaceId($request);
        $user = UvhRequest::user($request);

        try {
            $apiTokenContext = UvhRequest::apiToken($request);
            DB::transaction(function () use ($workspaceId, $user, $id, $apiTokenContext): void {
                if (! WorkspaceAccess::getMembershipLocked(
                    $user->id,
                    $workspaceId,
                    'editor',
                    $apiTokenContext,
                    'links:write',
                    (int) $user->security_version,
                )) {
                    throw new LinkException('Tu acceso al workspace cambió. Recarga antes de continuar.', 403);
                }
                $link = Link::where('id', $id)->where('workspace_id', $workspaceId)
                    ->whereNull('deleted_at')->lockForUpdate()->first();
                if (! $link) {
                    throw new LinkException('Enlace no encontrado', 404);
                }
                if ($link->state === 'blocked' && ! $user->is_admin) {
                    throw new LinkException('Un enlace bloqueado solo puede eliminarlo un administrador de la plataforma', 403);
                }
                $link->update([
                    'state_before_delete' => $link->state,
                    'deleted_at' => now(),
                    'state' => 'deleted',
                    'version' => (int) $link->version + 1,
                    'updated_at' => now(),
                ]);
                WebhookService::dispatch($workspaceId, 'link.deleted', ['linkId' => $id]);
            });
        } catch (LinkException $e) {
            return response()->json(['error' => $e->getMessage()], $e->status);
        }

        Audit::write($user->id, 'link.delete', 'link', $id, null, UvhRequest::ip($request), workspaceId: $workspaceId);
        return response()->json(['ok' => true]);
    }

    public function restore(Request $request, int $id)
    {
        $workspaceId = UvhRequest::workspaceId($request);
        $user = UvhRequest::user($request);

        try {
            $apiTokenContext = UvhRequest::apiToken($request);
            DB::transaction(function () use ($id, $workspaceId, $user, $apiTokenContext): void {
                if (! WorkspaceAccess::getMembershipLocked(
                    $user->id,
                    $workspaceId,
                    'editor',
                    $apiTokenContext,
                    'links:write',
                    (int) $user->security_version,
                )) {
                    throw new LinkException('Tu acceso al workspace cambió. Recarga antes de continuar.', 403);
                }
                $link = Link::withTrashed()->where('id', $id)->where('workspace_id', $workspaceId)
                    ->whereNotNull('deleted_at')->lockForUpdate()->first();
                if (! $link) {
                    throw new LinkException('Enlace no encontrado', 404);
                }
                if ($link->state_before_delete === 'blocked' && ! $user->is_admin) {
                    throw new LinkException('Un enlace bloqueado solo puede restaurarlo un administrador de la plataforma', 403);
                }

                $quota = DB::table('quotas')->where('workspace_id', $workspaceId)->lockForUpdate()->value('links_limit');
                $used = Link::where('workspace_id', $workspaceId)->whereNull('deleted_at')->count();
                if ($quota !== null && $used >= (int) $quota) {
                    throw new LinkException('Cuota de enlaces alcanzada. Elimina otro enlace antes de restaurar este.', 429);
                }

                $next = $link->state_before_delete === 'blocked'
                    ? 'blocked'
                    : (($link->scheduled_at && $link->scheduled_at->isFuture())
                        ? 'scheduled'
                        : (($link->expires_at && $link->expires_at->isPast()) ? 'expired' : 'active'));
                $link->update([
                    'deleted_at' => null,
                    'state' => $next,
                    'state_before_delete' => null,
                    'version' => (int) $link->version + 1,
                    'updated_at' => now(),
                ]);
                WebhookService::dispatch($workspaceId, 'link.updated', [
                    'linkId' => $id,
                    'alias' => (string) $link->alias,
                    'state' => $next,
                ]);
            });
        } catch (LinkException $e) {
            return response()->json(['error' => $e->getMessage()], $e->status);
        } catch (QueryException $e) {
            if (($e->errorInfo[0] ?? null) === '23505') {
                return response()->json(['error' => 'No se puede restaurar: el alias ya está en uso'], 409);
            }
            throw $e;
        }

        Audit::write($user->id, 'link.restore', 'link', $id, null, UvhRequest::ip($request), workspaceId: $workspaceId);

        return response()->json(['ok' => true]);
    }

    public function activity(Request $request, int $id)
    {
        $workspaceId = UvhRequest::workspaceId($request);

        $link = Link::where('id', $id)->where('workspace_id', $workspaceId)->first();
        if (! $link) {
            return response()->json(['error' => 'Enlace no encontrado'], 404);
        }

        $events = DB::table('audit_events')
            ->select(['id', 'action', 'metadata', 'created_at'])
            ->where('resource_type', 'link')
            ->where('resource_id', (string) $id)
            ->orderByDesc('created_at')
            ->limit(50)
            ->get();

        return response()->json(['events' => $events]);
    }

    public function role(Request $request)
    {
        $role = UvhRequest::role($request);

        return response()->json(['role' => $role, 'canWrite' => WorkspaceAccess::roleAtLeast((string) $role, 'editor')]);
    }

    // ---------------- helpers ----------------

    private function validLinkBody(Request $request, bool $partial = false): bool
    {
        if (! $partial || $request->has('destination')) {
            $destination = $request->input('destination');
            if (! is_string($destination) || $destination === '' || strlen($destination) > 2048) {
                return false;
            }
        }

        $stringOrNull = ['alias', 'fallbackDestination', 'scheduledAt', 'expiresAt', 'notes'];
        foreach ($stringOrNull as $field) {
            if ($request->has($field) && $request->input($field) !== null && ! is_string($request->input($field))) {
                return false;
            }
        }
        if ($request->has('password') && $request->input('password') !== null
            && (! is_string($request->input('password')) || strlen($request->input('password')) > 72)) {
            return false;
        }
        if ($request->has('domainId') && $request->input('domainId') !== null
            && (! is_int($request->input('domainId')) || $request->input('domainId') < 1)) {
            return false;
        }
        if ($request->has('maxClicks') && $request->input('maxClicks') !== null
            && (! is_int($request->input('maxClicks')) || $request->input('maxClicks') < 1)) {
            return false;
        }
        if ($request->has('singleUse') && ! is_bool($request->input('singleUse'))) {
            return false;
        }
        foreach (['utm', 'tags', 'rules'] as $field) {
            if ($request->has($field) && $request->input($field) !== null && ! is_array($request->input($field))) {
                return false;
            }
        }

        return true;
    }

    private function inputFromRequest(Request $request, ?Link $current = null): array
    {
        $input = [
            'destination' => UvhRequest::inputString($request, 'destination', $current->destination ?? ''),
            'alias' => $request->has('alias') ? $request->input('alias') : ($current->alias ?? null),
            'domain_id' => $request->has('domainId') ? $request->input('domainId') : ($current->domain_id ?? null),
            'fallback_destination' => $request->has('fallbackDestination') ? $request->input('fallbackDestination') : ($current->fallback_destination ?? null),
            'max_clicks' => $request->has('maxClicks') ? $request->input('maxClicks') : ($current->max_clicks ?? null),
            'single_use' => $request->has('singleUse') ? (bool) $request->input('singleUse') : (bool) ($current->single_use ?? false),
            'scheduled_at' => $request->has('scheduledAt') ? $request->input('scheduledAt') : $this->iso($current->scheduled_at ?? null),
            'expires_at' => $request->has('expiresAt') ? $request->input('expiresAt') : $this->iso($current->expires_at ?? null),
            'notes' => $request->has('notes') ? $request->input('notes') : ($current->notes ?? null),
            'utm' => $request->has('utm')
                ? $request->input('utm')
                : [
                    'source' => $current->utm_source ?? null,
                    'medium' => $current->utm_medium ?? null,
                    'campaign' => $current->utm_campaign ?? null,
                    'term' => $current->utm_term ?? null,
                    'content' => $current->utm_content ?? null,
                ],
        ];

        // PATCH semantics: omitting a collection preserves it. Supplying an
        // explicit empty array clears it. Always adding null here made every
        // unrelated edit delete all tags and redirect rules downstream.
        if ($request->has('tags')) {
            $input['tags'] = $request->input('tags');
        }
        if ($request->has('rules')) {
            $input['rules'] = $request->input('rules');
        }

        // Normalize explicit-null scalars.
        foreach (['alias', 'domain_id', 'fallback_destination', 'max_clicks', 'scheduled_at', 'expires_at', 'notes'] as $k) {
            if ($input[$k] === '') {
                $input[$k] = null;
            }
        }

        return $input;
    }

    private function iso(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }

        return $value instanceof \DateTimeInterface
            ? $value->format('Y-m-d\TH:i:s.v\Z')
            : (string) $value;
    }

    private function positiveQueryInteger(mixed $value, int $default, int $max): int
    {
        if (is_string($value) && preg_match('/^[1-9][0-9]{0,18}$/D', $value)) {
            $validated = filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
            $value = $validated === false ? null : $validated;
        }
        if (! is_int($value) || $value < 1) {
            return $default;
        }

        return min($value, $max);
    }
}
