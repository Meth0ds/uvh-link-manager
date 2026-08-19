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
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

class LinkController
{
    public function index(Request $request)
    {
        $workspaceId = UvhRequest::workspaceId($request);

        $search = (string) $request->query('q', '');
        $state = (string) $request->query('state', '');
        $tag = (string) $request->query('tag', '');
        $domainId = (string) $request->query('domainId', '');
        $sort = (string) $request->query('sort', 'created_at_desc');
        $page = max(1, (int) $request->query('page', 1));
        $perPage = min(100, max(1, (int) $request->query('perPage', 20)));

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
            $query->where('domain_id', (int) $domainId);
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
        $alias = (string) $request->input('alias', '');
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

        $domainId = $domainId !== null ? (int) $domainId : null;
        if ($domainId !== null) {
            $dom = DB::table('custom_domains')
                ->where('id', $domainId)
                ->where('workspace_id', $workspaceId)
                ->whereIn('state', ['verified', 'active'])
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
                ->whereIn('state', ['verified', 'active'])
                ->exists();
            if (! $dom) {
                return response()->json(['error' => 'Dominio no verificado o sin acceso'], 403);
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
            $created = LinkService::create($workspaceId, $user->id, $input);
        } catch (LinkException $e) {
            return response()->json(['error' => $e->getMessage()], $e->status);
        }

        Audit::write($user->id, 'link.create', 'link', $created['id'], null, UvhRequest::ip($request));
        WebhookService::dispatch($workspaceId, 'link.created', ['linkId' => $created['id'], 'alias' => $created['alias']]);

        $link = Link::with(['domain', 'tags'])->find($created['id']);

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
        $input = $this->inputFromRequest($request, $current);
        // A partial PATCH must preserve tags/rules when those fields are not
        // present. Null means "clear"; absence means "leave unchanged".
        if (! $request->has('tags')) {
            unset($input['tags']);
        }
        if (! $request->has('rules')) {
            unset($input['rules']);
        }

        if ($request->has('domainId') && $request->input('domainId') !== null) {
            $dom = DB::table('custom_domains')
                ->where('id', (int) $request->input('domainId'))
                ->where('workspace_id', $workspaceId)
                ->whereIn('state', ['verified', 'active'])
                ->exists();
            if (! $dom) {
                return response()->json(['error' => 'Dominio no verificado o sin acceso'], 403);
            }
        }

        if ($request->has('password')) {
            $input['password_hash'] = $request->input('password') !== null && $request->input('password') !== ''
                ? Hash::make((string) $request->input('password'))
                : null;
        }

        $valid = LinkService::validate($input);
        if (! $valid['ok']) {
            return response()->json(['error' => $valid['error']], 422);
        }

        try {
            $updated = LinkService::update($id, $workspaceId, $input);
        } catch (LinkException $e) {
            return response()->json(['error' => $e->getMessage()], $e->status);
        }

        Audit::write($user->id, 'link.update', 'link', $id, null, UvhRequest::ip($request));
        WebhookService::dispatch($workspaceId, 'link.updated', ['linkId' => $id, 'alias' => $updated['alias']]);

        $link = Link::with(['domain', 'tags'])->find($id);

        return response()->json(['link' => LinkService::dto($link)]);
    }

    public function state(Request $request, int $id)
    {
        $workspaceId = UvhRequest::workspaceId($request);
        $user = UvhRequest::user($request);

        $state = $request->input('state', '');
        $reason = $request->input('reason');
        $allowed = ['active', 'paused', 'archived', 'blocked', 'expired'];

        if (! is_string($state) || ! in_array($state, $allowed, true)) {
            return response()->json(['error' => 'Estado inválido'], 422);
        }

        $link = Link::where('id', $id)->where('workspace_id', $workspaceId)->whereNull('deleted_at')->first();
        if (! $link) {
            return response()->json(['error' => 'Enlace no encontrado'], 404);
        }

        if ($reason !== null && (! is_string($reason) || mb_strlen($reason) > 500)) {
            return response()->json(['error' => 'Motivo inválido'], 422);
        }

        if (($state === 'blocked' || $link->state === 'blocked') && ! $user->is_admin) {
            return response()->json(['error' => 'Solo un administrador de la plataforma puede bloquear o desbloquear enlaces'], 403);
        }

        $link->update(['state' => $state, 'updated_at' => now()]);

        Audit::write($user->id, 'link.state_change', 'link', $id, [
            'from' => $link->getOriginal('state'),
            'to' => $state,
            'reason' => is_string($reason) ? $reason : null,
        ], UvhRequest::ip($request));

        return response()->json(['ok' => true, 'state' => $state]);
    }

    public function destroy(Request $request, int $id)
    {
        $workspaceId = UvhRequest::workspaceId($request);
        $user = UvhRequest::user($request);

        $link = Link::where('id', $id)->where('workspace_id', $workspaceId)->whereNull('deleted_at')->first();
        if (! $link) {
            return response()->json(['error' => 'Enlace no encontrado'], 404);
        }

        $link->update(['deleted_at' => now(), 'state' => 'deleted', 'updated_at' => now()]);

        Audit::write($user->id, 'link.delete', 'link', $id, null, UvhRequest::ip($request));
        WebhookService::dispatch($workspaceId, 'link.deleted', ['linkId' => $id]);

        return response()->json(['ok' => true]);
    }

    public function restore(Request $request, int $id)
    {
        $workspaceId = UvhRequest::workspaceId($request);
        $user = UvhRequest::user($request);

        $link = Link::withTrashed()->where('id', $id)->where('workspace_id', $workspaceId)->whereNotNull('deleted_at')->first();
        if (! $link) {
            return response()->json(['error' => 'Enlace no encontrado'], 404);
        }

        $next = ($link->expires_at && $link->expires_at->isPast()) ? 'expired' : 'active';
        $link->update(['deleted_at' => null, 'state' => $next, 'updated_at' => now()]);

        Audit::write($user->id, 'link.restore', 'link', $id, null, UvhRequest::ip($request));

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
            && (! is_string($request->input('password')) || strlen($request->input('password')) > 256)) {
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
            'destination' => (string) $request->input('destination', $current->destination ?? ''),
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
            'tags' => $request->has('tags') ? $request->input('tags') : null,
            'rules' => $request->has('rules') ? $request->input('rules') : null,
        ];

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
}
