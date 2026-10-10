<?php

namespace App\Support;

use App\Exceptions\LinkException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** Shared admission rules for templates and immutable campaign design snapshots. */
final class QrResources
{
    /** @return array<string, mixed> */
    public static function present(object $row): array
    {
        $result = ['id' => (int) $row->id, 'name' => (string) $row->name,
            'spec' => json_decode($row->spec, true, 32, JSON_THROW_ON_ERROR),
            'version' => (int) $row->version, 'createdAt' => (string) $row->created_at, 'updatedAt' => (string) $row->updated_at];
        if (isset($row->public_id)) {
            $result['publicId'] = (string) $row->public_id;
            $result['linkId'] = (int) $row->link_id;
            $result['archived'] = $row->archived_at !== null;
        }

        return $result;
    }

    /** @param array<string, mixed> $spec */
    private static function asset(int $workspaceId, array $spec): ?int
    {
        if ($spec['logo']['kind'] !== 'custom') {
            return null;
        }
        $id = (int) $spec['logo']['assetId'];
        if (! DB::table('qr_assets')->where('workspace_id', $workspaceId)->where('id', $id)->where('status', 'ready')->lockForUpdate()->first()) {
            throw new LinkException('Logo no encontrado en este workspace.', 422);
        }

        return $id;
    }

    /** @param 'qr_designs'|'qr_variants' $table */
    public static function create(Request $request, string $table, ?int $linkId = null): object
    {
        $name = QrDesign::name($request->input('name'));
        $spec = QrDesign::validate($request->input('spec'));
        $key = QrDesign::requestKey($request->header('Idempotency-Key'));
        $hash = hash('sha256', json_encode([$name, $spec, $linkId], JSON_THROW_ON_ERROR));
        $workspaceId = UvhRequest::workspaceId($request);

        return WorkspaceMutation::run($request, function () use ($request, $table, $linkId, $name, $spec, $key, $hash, $workspaceId): object {
            $receipt = DB::table('qr_creation_receipts')->where('workspace_id', $workspaceId)->where('scope', $table)->where('request_key', $key)->first();
            if ($receipt) {
                if (! hash_equals($receipt->request_hash, $hash)) {
                    throw new LinkException('Esta clave de idempotencia corresponde a otra creación.', 409);
                }
                $previous = DB::table($table)->where('workspace_id', $workspaceId)->where('id', $receipt->resource_id)->first();
                if (! $previous) {
                    throw new LinkException('El diseño creado con esta clave fue eliminado.', 410);
                }

                return $previous;
            }
            if ($linkId !== null && ! DB::table('links')->where('workspace_id', $workspaceId)->where('id', $linkId)->whereNull('deleted_at')->lockForUpdate()->first()) {
                throw new LinkException('Enlace no encontrado.', 404);
            }
            $old = DB::table($table)->where('workspace_id', $workspaceId)->where('request_key', $key)->first();
            if ($old) {
                if (! hash_equals($old->request_hash, $hash)) {
                    throw new LinkException('Esta clave de idempotencia corresponde a otra creación.', 409);
                }

                return $old;
            }
            $limit = $table === 'qr_designs' ? (int) config('qr.designs_per_workspace', 50) : (int) config('qr.variants_per_link', 100);
            $count = DB::table($table)->where('workspace_id', $workspaceId)->when($linkId !== null, fn ($query) => $query->where('link_id', $linkId))->count();
            if ($count >= $limit) {
                throw new LinkException('Has alcanzado el límite de diseños o variantes.', 409);
            }
            $asset = self::asset($workspaceId, $spec);
            $values = ['workspace_id' => $workspaceId, 'created_by' => UvhRequest::user($request)->id,
                'name' => $name, 'spec' => json_encode($spec, JSON_THROW_ON_ERROR), 'asset_id' => $asset,
                'version' => 1, 'request_key' => $key, 'request_hash' => $hash, 'created_at' => now(), 'updated_at' => now()];
            if ($linkId !== null) {
                $values += ['link_id' => $linkId, 'public_id' => bin2hex(random_bytes(16))];
            }
            $id = DB::table($table)->insertGetId($values);
            DB::table('qr_creation_receipts')->insert(['workspace_id' => $workspaceId, 'scope' => $table, 'request_key' => $key,
                'request_hash' => $hash, 'resource_id' => $id, 'created_at' => now(), 'updated_at' => now()]);

            return DB::table($table)->where('id', $id)->first();
        });
    }

    /** @param 'qr_designs'|'qr_variants' $table */
    public static function update(Request $request, string $table, int $id, ?int $linkId = null): object
    {
        $version = $request->input('version');
        if (! is_int($version) || $version < 1) {
            throw new LinkException('La edición requiere la versión actual.', 422);
        }
        $workspaceId = UvhRequest::workspaceId($request);
        $name = $request->has('name') ? QrDesign::name($request->input('name')) : null;
        $spec = $request->has('spec') ? QrDesign::validate($request->input('spec')) : null;
        $archived = $request->input('archived');
        if ($request->has('archived') && ($linkId === null || ! is_bool($archived))) {
            throw new LinkException('Estado de archivo inválido.', 422);
        }

        return WorkspaceMutation::run($request, function () use ($request, $table, $id, $linkId, $workspaceId, $version, $name, $spec, $archived): object {
            $row = DB::table($table)->where('workspace_id', $workspaceId)->where('id', $id)->when($linkId !== null, fn ($query) => $query->where('link_id', $linkId))->lockForUpdate()->first();
            if (! $row) {
                throw new LinkException('Diseño o variante no encontrados.', 404);
            }
            if ((int) $row->version !== $version) {
                throw new LinkException('Otra persona modificó este diseño. Recarga antes de guardar.', 409);
            }
            $values = ['version' => $version + 1, 'updated_at' => now()];
            if ($name !== null) {
                $values['name'] = $name;
            }
            if ($spec !== null) {
                $values['asset_id'] = self::asset($workspaceId, $spec);
                $values['spec'] = json_encode($spec, JSON_THROW_ON_ERROR);
            }
            if ($request->has('archived')) {
                $values['archived_at'] = $archived ? now() : null;
            }
            DB::table($table)->where('id', $id)->update($values);

            return DB::table($table)->where('id', $id)->first();
        });
    }
}
