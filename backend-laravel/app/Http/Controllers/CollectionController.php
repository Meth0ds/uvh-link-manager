<?php

namespace App\Http\Controllers;

use App\Models\Collection;
use App\Support\Audit;
use App\Support\UvhRequest;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Colecciones de un nivel (F7): agrupar enlaces sin anidamiento. Borrar una
 * colección nunca borra enlaces; quedan sin agrupar.
 */
class CollectionController
{
    public function index(Request $request): JsonResponse
    {
        $workspaceId = UvhRequest::workspaceId($request);

        $collections = Collection::where('workspace_id', $workspaceId)
            ->withCount(['links' => fn ($q) => $q->whereNull('deleted_at')])
            ->orderBy('name')->orderBy('id')
            ->get()
            ->map(fn (Collection $collection): array => [
                'id' => (int) $collection->id,
                'name' => $collection->name,
                'links' => (int) $collection->links_count,
            ]);

        return response()->json(['collections' => $collections->values()->all()]);
    }

    public function store(Request $request): JsonResponse
    {
        $workspaceId = UvhRequest::workspaceId($request);
        $user = UvhRequest::user($request);

        $invalid = $this->invalidName($request->input('name'));
        if ($invalid !== null) {
            return response()->json(['error' => $invalid], 422);
        }
        $name = trim((string) $request->input('name'));
        if ($this->nameTaken($workspaceId, $name)) {
            return response()->json(['error' => 'Ya existe una colección con ese nombre'], 409);
        }

        $collection = Collection::create(['workspace_id' => $workspaceId, 'name' => $name]);

        Audit::write($user->id, 'collection.create', 'collection', (int) $collection->id, ['name' => $name], UvhRequest::ip($request), workspaceId: $workspaceId);

        return response()->json(['collection' => ['id' => (int) $collection->id, 'name' => $collection->name, 'links' => 0]], 201);
    }

    public function rename(Request $request, int $id): JsonResponse
    {
        $workspaceId = UvhRequest::workspaceId($request);
        $user = UvhRequest::user($request);

        $invalid = $this->invalidName($request->input('name'));
        if ($invalid !== null) {
            return response()->json(['error' => $invalid], 422);
        }
        $name = trim((string) $request->input('name'));

        $collection = Collection::where('id', $id)->where('workspace_id', $workspaceId)->first();
        if (! $collection) {
            return response()->json(['error' => 'Colección no encontrada'], 404);
        }
        if ($this->nameTaken($workspaceId, $name, $id)) {
            return response()->json(['error' => 'Ya existe una colección con ese nombre'], 409);
        }

        $collection->update(['name' => $name]);

        Audit::write($user->id, 'collection.rename', 'collection', $id, ['name' => $name], UvhRequest::ip($request), workspaceId: $workspaceId);

        return response()->json(['ok' => true, 'id' => $id, 'name' => $name]);
    }

    public function destroy(Request $request, int $id): JsonResponse
    {
        $workspaceId = UvhRequest::workspaceId($request);
        $user = UvhRequest::user($request);

        $collection = Collection::where('id', $id)->where('workspace_id', $workspaceId)->first();
        if (! $collection) {
            return response()->json(['error' => 'Colección no encontrada'], 404);
        }

        // Los enlaces quedan sin agrupar: la colección es una comodidad, no
        // una propiedad de la que dependa la vida de ningún enlace.
        $moved = $collection->links()->update(['collection_id' => null]);
        $collection->delete();

        Audit::write($user->id, 'collection.delete', 'collection', $id, ['moved' => $moved], UvhRequest::ip($request), workspaceId: $workspaceId);

        return response()->json(['ok' => true, 'moved' => $moved]);
    }

    private function invalidName(mixed $name): ?string
    {
        if (! is_string($name) || ! mb_check_encoding($name, 'UTF-8')
            || mb_strlen(trim($name)) < 1 || mb_strlen($name) > 60
            || preg_match('/[\x00-\x1f\x7f]/', $name)) {
            return 'Nombre de colección inválido';
        }

        return null;
    }

    private function nameTaken(int $workspaceId, string $name, ?int $exceptId = null): bool
    {
        return Collection::where('workspace_id', $workspaceId)
            ->whereRaw('lower(name) = lower(?)', [$name])
            ->when($exceptId !== null, fn ($q) => $q->where('id', '!=', $exceptId))
            ->exists();
    }
}
