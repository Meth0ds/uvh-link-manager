<?php

namespace App\Http\Controllers;

use App\Models\Tag;
use App\Support\Audit;
use App\Support\UvhRequest;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Gestor de etiquetas (F7): listarlas con su uso, renombrarlas y fusionarlas.
 *
 * Una etiqueta es sólo un nombre colgando de enlaces: renombrar cambia el
 * nombre donde quiera que aparezca y fusionar funde varias en una. Ninguna de
 * las dos operaciones toca enlaces ni pierde agrupaciones: la fusión mueve las
 * adhesiones antes de borrar las etiquetas de origen, en una sola transacción.
 */
class TagController
{
    public function index(Request $request): JsonResponse
    {
        $workspaceId = UvhRequest::workspaceId($request);

        $tags = Tag::where('workspace_id', $workspaceId)
            ->orderBy('name')->orderBy('id')
            ->get(['id', 'name'])
            ->map(function (Tag $tag) use ($workspaceId): array {
                $links = DB::table('link_tags')
                    ->join('links', 'links.id', '=', 'link_tags.link_id')
                    ->where('link_tags.tag_id', $tag->id)
                    ->where('links.workspace_id', $workspaceId)
                    ->whereNull('links.deleted_at')
                    ->count();

                return ['id' => (int) $tag->id, 'name' => $tag->name, 'links' => $links];
            });

        return response()->json(['tags' => $tags->values()->all()]);
    }

    public function rename(Request $request, int $id): JsonResponse
    {
        $workspaceId = UvhRequest::workspaceId($request);
        $user = UvhRequest::user($request);

        $name = $request->input('name');
        $invalid = $this->invalidName($name);
        if ($invalid !== null) {
            return response()->json(['error' => $invalid], 422);
        }
        $name = trim((string) $name);

        $tag = Tag::where('id', $id)->where('workspace_id', $workspaceId)->first();
        if (! $tag) {
            return response()->json(['error' => 'Etiqueta no encontrada'], 404);
        }
        if ($this->nameTaken($workspaceId, $name, $id)) {
            return response()->json(['error' => 'Ya existe una etiqueta con ese nombre'], 409);
        }

        $from = $tag->name;
        $tag->update(['name' => $name]);

        Audit::write($user->id, 'tag.rename', 'tag', $id, ['from' => $from, 'to' => $name], UvhRequest::ip($request), workspaceId: $workspaceId);

        return response()->json(['ok' => true, 'id' => $id, 'name' => $name]);
    }

    /**
     * Fusiona etiquetas de origen en una destino: las adhesiones se mueven
     * (sin duplicar las que ya tenían ambas) y las de origen desaparecen. Un
     * enlace nunca pierde ni gana grupos por una fusión.
     */
    public function merge(Request $request): JsonResponse
    {
        $workspaceId = UvhRequest::workspaceId($request);
        $user = UvhRequest::user($request);

        $sourceIds = $request->input('sourceIds');
        $targetId = $request->input('targetId');
        if (! is_array($sourceIds) || $sourceIds === [] || count($sourceIds) > 50) {
            return response()->json(['error' => 'Etiquetas de origen inválidas'], 422);
        }
        $sources = [];
        foreach ($sourceIds as $sourceId) {
            if (! is_int($sourceId) || $sourceId < 1 || isset($sources[$sourceId]) || $sourceId === $targetId) {
                return response()->json(['error' => 'Etiquetas de origen inválidas'], 422);
            }
            $sources[$sourceId] = true;
        }
        if (! is_int($targetId) || $targetId < 1) {
            return response()->json(['error' => 'Etiqueta destino inválida'], 422);
        }

        $target = Tag::where('id', $targetId)->where('workspace_id', $workspaceId)->first();
        if (! $target) {
            return response()->json(['error' => 'Etiqueta destino no encontrada'], 404);
        }
        $found = Tag::where('workspace_id', $workspaceId)->whereIn('id', array_keys($sources))->count();
        if ($found !== count($sources)) {
            return response()->json(['error' => 'Etiqueta de origen no encontrada'], 404);
        }

        $merged = DB::transaction(function () use ($workspaceId, $sources, $targetId): int {
            $moved = 0;
            foreach (array_keys($sources) as $sourceId) {
                // El pivote es (link_id, tag_id): primero se retira la
                // adhesión redundante del destino, luego se mueve el resto.
                DB::table('link_tags')->where('tag_id', $sourceId)
                    ->whereExists(function ($query) use ($targetId): void {
                        $query->select(DB::raw(1))->from('link_tags as kept')
                            ->whereColumn('kept.link_id', 'link_tags.link_id')
                            ->where('kept.tag_id', $targetId);
                    })->delete();
                $moved += DB::table('link_tags')->where('tag_id', $sourceId)->update(['tag_id' => $targetId]);
                Tag::where('id', $sourceId)->where('workspace_id', $workspaceId)->delete();
            }

            return $moved;
        });

        Audit::write($user->id, 'tag.merge', 'tag', $targetId, [
            'sourceIds' => array_keys($sources),
            'moved' => $merged,
        ], UvhRequest::ip($request), workspaceId: $workspaceId);

        return response()->json(['ok' => true, 'id' => $targetId, 'name' => $target->name, 'moved' => $merged]);
    }

    private function invalidName(mixed $name): ?string
    {
        if (! is_string($name) || ! mb_check_encoding($name, 'UTF-8')
            || mb_strlen(trim($name)) < 1 || mb_strlen($name) > 40
            || preg_match('/[\x00-\x1f\x7f]/', $name)) {
            return 'Nombre de etiqueta inválido';
        }

        return null;
    }

    private function nameTaken(int $workspaceId, string $name, ?int $exceptId): bool
    {
        return Tag::where('workspace_id', $workspaceId)
            ->whereRaw('lower(name) = lower(?)', [$name])
            ->when($exceptId !== null, fn ($q) => $q->where('id', '!=', $exceptId))
            ->exists();
    }
}
