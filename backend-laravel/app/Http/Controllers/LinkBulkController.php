<?php

namespace App\Http\Controllers;

use App\Exceptions\LinkException;
use App\Models\Collection;
use App\Models\Link;
use App\Models\Tag;
use App\Models\User;
use App\Support\Audit;
use App\Support\Idempotency;
use App\Support\LinkService;
use App\Support\UvhRequest;
use App\Support\WebhookService;
use App\Support\WorkspaceAccess;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Acciones masivas sobre enlaces (F7), protegidas por una `Idempotency-Key`.
 *
 * Un navegador puede repetir la misma petición (doble clic, reintento, red
 * inestable) y una acción masiva aplicada dos veces duplica su efecto: la
 * clave identifica la intención y las repeticiones reciben la respuesta
 * original sin volver a aplicar nada. Ver `App\Support\Idempotency`.
 *
 * La acción es atómica: se aplica a todos los enlaces seleccionados o a
 * ninguno. Un identificador ajeno, ausente o en un estado que impide la
 * transición rechaza la operación entera con el motivo, en vez de dejar una
 * selección a medio aplicar que nadie auditó.
 */
class LinkBulkController
{
    private const MAX_LINKS = 100;

    private const MAX_TAGS = 20;

    private const ACTIONS = ['pause', 'activate', 'archive', 'trash', 'restore', 'tag', 'untag', 'move'];

    private const STATES = ['pause' => 'paused', 'activate' => 'active', 'archive' => 'archived'];

    private const SCOPE = 'links.bulk';

    public function bulk(Request $request): JsonResponse
    {
        $workspaceId = UvhRequest::workspaceId($request);
        $user = UvhRequest::user($request);

        $key = $request->header('Idempotency-Key');
        $keyCheck = Idempotency::validateKey($key);
        if (! $keyCheck['ok']) {
            return response()->json(['error' => $keyCheck['error']], 422);
        }
        $key = (string) $key;

        $action = $request->input('action', '');
        if (! is_string($action) || ! in_array($action, self::ACTIONS, true)) {
            return response()->json(['error' => 'Acción inválida'], 422);
        }

        $ids = $this->parseLinkIds($request->input('linkIds'));
        if ($ids === null) {
            return response()->json(['error' => 'Selecciona entre 1 y '.self::MAX_LINKS.' enlaces'], 422);
        }

        $tags = $request->input('tags');
        if (in_array($action, ['tag', 'untag'], true)) {
            if (! is_array($tags) || $tags === [] || count($tags) > self::MAX_TAGS) {
                return response()->json(['error' => 'Etiquetas inválidas'], 422);
            }
            foreach ($tags as $tag) {
                if (! is_string($tag) || ! mb_check_encoding($tag, 'UTF-8') || mb_strlen($tag) > 40 || preg_match('/[\x00-\x1f\x7f]/', $tag)) {
                    return response()->json(['error' => 'Etiquetas inválidas'], 422);
                }
            }
        }

        $collectionId = $request->input('collectionId');
        if ($action === 'move') {
            if ($collectionId !== null && (! is_int($collectionId) || $collectionId < 1)) {
                return response()->json(['error' => 'Colección inválida'], 422);
            }
            if ($collectionId !== null && ! Collection::where('id', $collectionId)->where('workspace_id', $workspaceId)->exists()) {
                return response()->json(['error' => 'Colección no encontrada'], 422);
            }
        }

        $hash = Idempotency::hash($request->getContent());
        $begin = Idempotency::begin((int) $user->id, self::SCOPE, $key, $hash);
        if ($begin['state'] === 'replay') {
            return response()->json($begin['body'], $begin['status'])->header('Idempotent-Replay', 'true');
        }
        if ($begin['state'] === 'mismatch') {
            return response()->json(['error' => 'Esta Idempotency-Key ya se usó con otra petición'], 409);
        }
        if ($begin['state'] === 'in_progress') {
            return response()->json(['error' => 'Ya hay una operación en curso con esta clave. Espera a que termine.'], 409);
        }

        $apiTokenContext = UvhRequest::apiToken($request);
        try {
            $body = DB::transaction(function () use ($workspaceId, $user, $action, $ids, $tags, $collectionId, $key, $hash, $apiTokenContext): array {
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

                $applied = $this->apply($workspaceId, $user, $action, $ids, $tags ?? [], $collectionId);

                $body = ['ok' => true, 'action' => $action, 'applied' => $applied];
                // La respuesta se sella en la misma transacción que el efecto:
                // o quedan ambos o ninguno, y una repetición nunca ve «hecho»
                // sobre un efecto que se revirtió.
                Idempotency::commit((int) $user->id, self::SCOPE, $key, $hash, 200, $body);

                return $body;
            });
        } catch (LinkException $e) {
            Idempotency::release((int) $user->id, self::SCOPE, $key);

            return response()->json(['error' => $e->getMessage()], $e->status);
        } catch (QueryException $e) {
            Idempotency::release((int) $user->id, self::SCOPE, $key);
            if (($e->errorInfo[0] ?? null) === '23505') {
                return response()->json(['error' => 'No se puede restaurar: el alias ya está en uso'], 409);
            }
            throw $e;
        }

        Audit::write($user->id, 'link.bulk', 'link', null, [
            'action' => $action,
            'count' => $body['applied'],
            'linkIds' => $ids,
        ], UvhRequest::ip($request), workspaceId: $workspaceId);

        return response()->json($body);
    }

    /**
     * Aplica la acción a todos los enlaces o a ninguno. Devuelve cuántos
     * cambiaron realmente (un enlace ya en el estado pedido no cuenta).
     *
     * @param  list<int>  $ids
     * @param  list<mixed>  $tags
     */
    private function apply(int $workspaceId, User $user, string $action, array $ids, array $tags, mixed $collectionId): int
    {
        // Link usa SoftDeletes: sin withTrashed() el alcance global metería
        // su propio whereNull('deleted_at') y la restauración nunca vería la
        // papelera. Los filtros explícitos son los que deciden aquí.
        $query = Link::withTrashed()->where('workspace_id', $workspaceId);
        if ($action === 'restore') {
            $query->whereNotNull('deleted_at');
        } else {
            $query->whereNull('deleted_at');
        }
        /** @var \Illuminate\Support\Collection<int, Link> $found */
        $found = $query->whereIn('id', $ids)->orderBy('id')->lockForUpdate()->get()->keyBy('id');

        foreach ($ids as $id) {
            if (! isset($found[$id])) {
                throw new LinkException('Enlace no encontrado: #'.$id, 404);
            }
        }

        if (isset(self::STATES[$action])) {
            $target = self::STATES[$action];
            foreach ($found as $link) {
                if ($link->state === 'blocked') {
                    throw new LinkException('El bloqueo de enlaces solo se gestiona desde la administración de la plataforma', 403);
                }
                if ($target === 'active' && $link->scheduled_at && $link->scheduled_at->isFuture()) {
                    throw new LinkException("El enlace {$link->alias} sigue programado. Modifica su fecha de activación antes de activarlo.", 409);
                }
                if ($target === 'active' && $link->expires_at && $link->expires_at->isPast()) {
                    throw new LinkException("El enlace {$link->alias} ya ha caducado. Amplía su fecha de caducidad antes de activarlo.", 409);
                }
            }
            $applied = 0;
            foreach ($found as $link) {
                if ($link->state === $target) {
                    continue;
                }
                $link->update(['state' => $target, 'version' => (int) $link->version + 1, 'updated_at' => now()]);
                WebhookService::dispatch($workspaceId, 'link.updated', [
                    'linkId' => (int) $link->id,
                    'alias' => (string) $link->alias,
                    'state' => $target,
                ]);
                $applied++;
            }

            return $applied;
        }

        if ($action === 'trash') {
            foreach ($found as $link) {
                if ($link->state === 'blocked' && ! $user->is_admin) {
                    throw new LinkException('Un enlace bloqueado solo puede eliminarlo un administrador de la plataforma', 403);
                }
            }
            foreach ($found as $link) {
                $link->update([
                    'state_before_delete' => $link->state,
                    'deleted_at' => now(),
                    'state' => 'deleted',
                    'version' => (int) $link->version + 1,
                    'updated_at' => now(),
                ]);
                WebhookService::dispatch($workspaceId, 'link.deleted', ['linkId' => (int) $link->id]);
            }

            return count($ids);
        }

        if ($action === 'restore') {
            $quota = DB::table('quotas')->where('workspace_id', $workspaceId)->lockForUpdate()->value('links_limit');
            $used = Link::where('workspace_id', $workspaceId)->whereNull('deleted_at')->count();
            if ($quota !== null && $used + count($ids) > (int) $quota) {
                throw new LinkException('Cuota de enlaces alcanzada. Elimina otro enlace antes de restaurar.', 429);
            }
            foreach ($found as $link) {
                if ($link->state_before_delete === 'blocked' && ! $user->is_admin) {
                    throw new LinkException('Un enlace bloqueado solo puede restaurarlo un administrador de la plataforma', 403);
                }
            }
            foreach ($found as $link) {
                // Expiry wins over scheduling, exactly like the single restore.
                $next = $link->state_before_delete === 'blocked'
                    ? 'blocked'
                    : (($link->expires_at && $link->expires_at->isPast())
                        ? 'expired'
                        : (($link->scheduled_at && $link->scheduled_at->isFuture()) ? 'scheduled' : 'active'));
                $link->update([
                    'deleted_at' => null,
                    'state' => $next,
                    'state_before_delete' => null,
                    'version' => (int) $link->version + 1,
                    'updated_at' => now(),
                ]);
                WebhookService::dispatch($workspaceId, 'link.updated', [
                    'linkId' => (int) $link->id,
                    'alias' => (string) $link->alias,
                    'state' => $next,
                ]);
            }

            return count($ids);
        }

        if ($action === 'tag' || $action === 'untag') {
            $tagIds = $action === 'tag'
                ? LinkService::tagIdsFor($workspaceId, $tags)
                : $this->existingTagIds($workspaceId, $tags);
            $applied = 0;
            foreach ($found as $link) {
                if ($action === 'tag') {
                    $before = $link->tags()->count();
                    $link->tags()->syncWithoutDetaching($tagIds);
                    $changed = $link->tags()->count() !== $before;
                } else {
                    $changed = $tagIds !== [];
                    if ($changed) {
                        $link->tags()->detach($tagIds);
                    }
                }
                if (! $changed) {
                    continue;
                }
                $link->update(['version' => (int) $link->version + 1, 'updated_at' => now()]);
                WebhookService::dispatch($workspaceId, 'link.updated', [
                    'linkId' => (int) $link->id,
                    'alias' => (string) $link->alias,
                ]);
                $applied++;
            }

            return $applied;
        }

        // move: agrupa o desagrupa, nunca borra la colección.
        $applied = 0;
        foreach ($found as $link) {
            if ((int) $link->collection_id === (int) $collectionId) {
                continue;
            }
            $link->update([
                'collection_id' => $collectionId,
                'version' => (int) $link->version + 1,
                'updated_at' => now(),
            ]);
            WebhookService::dispatch($workspaceId, 'link.updated', [
                'linkId' => (int) $link->id,
                'alias' => (string) $link->alias,
            ]);
            $applied++;
        }

        return $applied;
    }

    /**
     * @param  list<mixed>  $tags
     * @return list<int>
     */
    private function existingTagIds(int $workspaceId, array $tags): array
    {
        $wanted = [];
        foreach ($tags as $raw) {
            $wanted[] = mb_strtolower(trim((string) $raw));
        }

        return Tag::where('workspace_id', $workspaceId)->get(['id', 'name'])
            ->filter(fn (Tag $tag): bool => in_array(mb_strtolower($tag->name), $wanted, true))
            ->pluck('id')
            ->map(fn ($id): int => (int) $id)
            ->values()
            ->all();
    }

    /**
     * @return list<int>|null
     */
    private function parseLinkIds(mixed $input): ?array
    {
        if (! is_array($input) || $input === [] || count($input) > self::MAX_LINKS) {
            return null;
        }
        $ids = [];
        foreach ($input as $id) {
            if (! is_int($id) || $id < 1 || isset($ids[$id])) {
                return null;
            }
            $ids[$id] = true;
        }

        return array_keys($ids);
    }
}
