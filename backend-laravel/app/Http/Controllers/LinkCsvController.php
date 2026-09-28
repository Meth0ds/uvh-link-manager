<?php

namespace App\Http\Controllers;

use App\Exceptions\LinkException;
use App\Models\CustomDomain;
use App\Models\Link;
use App\Support\Audit;
use App\Support\Csv;
use App\Support\Idempotency;
use App\Support\LinkService;
use App\Support\UrlUtil;
use App\Support\UvhRequest;
use App\Support\WorkspaceMutation;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;

/**
 * Import/export CSV de enlaces (F7).
 *
 * Exportar es una lectura en bloque de lo que la lista ya muestra: cada celda
 * pasa por el guardado anti-fórmulas de `Csv`, porque un archivo que acaba en
 * una hoja de cálculo no debe ejecutar nada al abrirse. El tope de filas es
 * explícito: más allá se devuelve un error en vez de un archivo a medias que
 * parece completo.
 *
 * Importar recibe el CSV como texto y lo valida fila a fila con las MISMAS
 * reglas que la creación manual (`LinkService`): una fila inválida se
 * reporta con su número y su motivo sin frenar al resto, y un `dryRun`
 * devuelve el mismo informe sin escribir nada. La creación real exige
 * `Idempotency-Key`: un reintento de la misma importación no puede duplicar
 * los enlaces que sí creó.
 *
 * El archivo exportado por UVH se puede volver a importar tal cual
 * (round-trip): las columnas de sólo lectura del informe (`id`, `state`,
 * `click_count`, `created_at`) se aceptan y se ignoran, la de `domain` se
 * resuelve como hostname dentro del workspace destino, y el guardado
 * anti-fórmulas del export se deshace al leer. Un export con enlaces en un
 * dominio personalizado sólo es portable a un workspace que tenga ese dominio;
 * si no existe, la fila se reporta con su motivo.
 */
class LinkCsvController
{
    private const MAX_IMPORT_BYTES = 262_144;

    private const MAX_IMPORT_ROWS = 500;

    private const MAX_EXPORT_ROWS = 5_000;

    private const MAX_REPORTED_ERRORS = 100;

    /** Columnas que el archivo puede traer; una desconocida es un error. */
    private const COLUMNS = ['alias', 'destination', 'fallback_destination', 'notes', 'tags', 'tags_json', 'scheduled_at', 'expires_at', 'max_clicks', 'single_use'];

    /**
     * Columnas del export que sólo informan: el archivo de UVH vuelve a entrar
     * sin romperse —se aceptan y se ignoran—, porque un round-trip no puede
     * rechazar el propio formato de salida del producto.
     */
    private const READ_ONLY_COLUMNS = ['id', 'state', 'click_count', 'created_at'];

    /** Y la única del export que sí se interpreta: hostname → dominio destino. */
    private const DOMAIN_COLUMN = 'domain';

    private const SCOPE = 'links.import';

    public function export(Request $request): JsonResponse|Response
    {
        $workspaceId = UvhRequest::workspaceId($request);

        $total = Link::where('workspace_id', $workspaceId)->whereNull('deleted_at')->count();
        if ($total > self::MAX_EXPORT_ROWS) {
            return response()->json(['error' => 'El export CSV admite hasta '.self::MAX_EXPORT_ROWS.' enlaces ('.$total.')'], 409);
        }

        // `domain` va eager-loaded: el export es una operación de «scale» y no
        // puede permitirse un N+1 de dominios sobre miles de enlaces.
        $links = Link::with(['tags', 'domain'])->where('workspace_id', $workspaceId)->whereNull('deleted_at')
            ->orderBy('id')->get();

        // BOM para que Excel lea los acentos como UTF-8.
        $lines = ["\xEF\xBB\xBF".Csv::line(['id', 'alias', 'domain', 'destination', 'fallback_destination', 'state', 'click_count', 'max_clicks', 'single_use', 'scheduled_at', 'expires_at', 'notes', 'tags_json', 'created_at'])];
        foreach ($links as $link) {
            $lines[] = Csv::line([
                (string) $link->id,
                (string) $link->alias,
                (string) ($link->domain?->domain),
                (string) $link->destination,
                (string) ($link->fallback_destination ?? ''),
                (string) $link->state,
                (string) $link->click_count,
                (string) ($link->max_clicks ?? ''),
                $link->single_use ? 'true' : 'false',
                (string) ($link->scheduled_at?->toIso8601String() ?? ''),
                (string) ($link->expires_at?->toIso8601String() ?? ''),
                (string) ($link->notes ?? ''),
                json_encode($link->tags->pluck('name')->sort()->values()->all(), JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
                (string) ($link->created_at?->toIso8601String() ?? ''),
            ]);
        }

        $csv = implode("\r\n", $lines)."\r\n";

        Audit::write(UvhRequest::user($request)?->id, 'link.export', 'link', null, ['count' => $links->count()], UvhRequest::ip($request), workspaceId: $workspaceId);

        return response($csv, 200, [
            'Content-Type' => 'text/csv; charset=UTF-8',
            'Content-Disposition' => 'attachment; filename="uvh-links-'.now()->format('Ymd').'.csv"',
            'Cache-Control' => 'no-store',
        ]);
    }

    public function import(Request $request): JsonResponse
    {
        $workspaceId = UvhRequest::workspaceId($request);
        $user = UvhRequest::user($request);

        $dryRun = $request->input('dryRun', false);
        if (! is_bool($dryRun)) {
            return response()->json(['error' => 'dryRun inválido'], 422);
        }
        $text = $request->input('csv');
        if (! is_string($text) || $text === '' || strlen($text) > self::MAX_IMPORT_BYTES) {
            return response()->json(['error' => 'CSV inválido (vacío o demasiado grande)'], 422);
        }

        $parsed = Csv::parse($text, self::MAX_IMPORT_ROWS);
        if (! $parsed['ok']) {
            return response()->json(['error' => $parsed['error']], 422);
        }
        foreach ($parsed['header'] as $column) {
            if (! in_array($column, self::COLUMNS, true)
                && ! in_array($column, self::READ_ONLY_COLUMNS, true)
                && $column !== self::DOMAIN_COLUMN) {
                return response()->json(['error' => 'Columna desconocida: '.$column], 422);
            }
        }
        if (in_array('tags', $parsed['header'], true) && in_array('tags_json', $parsed['header'], true)) {
            return response()->json(['error' => 'Usa tags o tags_json, no ambas columnas'], 422);
        }
        if (! in_array('alias', $parsed['header'], true) || ! in_array('destination', $parsed['header'], true)) {
            return response()->json(['error' => 'El CSV necesita las columnas alias y destination'], 422);
        }

        // La identidad de la intención incluye el workspace: la misma clave en
        // otro workspace es otra intención, jamás un replay cross-tenant.
        $scope = self::SCOPE.':'.$workspaceId;
        $lease = '';
        $hash = Idempotency::hash($request->getContent());
        $key = $request->header('Idempotency-Key');
        if (! $dryRun) {
            $keyCheck = Idempotency::validateKey($key);
            if (! $keyCheck['ok']) {
                return response()->json(['error' => $keyCheck['error']], 422);
            }
            $key = (string) $key;
            $begin = Idempotency::begin((int) $user->id, $scope, $key, $hash);
            if ($begin['state'] === 'replay') {
                return response()->json($begin['body'], $begin['status'])->header('Idempotent-Replay', 'true');
            }
            if ($begin['state'] === 'mismatch') {
                return response()->json(['error' => 'Esta Idempotency-Key ya se usó con otra petición'], 409);
            }
            if ($begin['state'] === 'in_progress') {
                return response()->json(['error' => 'Ya hay una operación en curso con esta clave. Espera a que termine.'], 409);
            }
            $lease = (string) ($begin['lease'] ?? '');
        }

        $batchId = 0;
        try {
            if ($dryRun) {
                $body = WorkspaceMutation::run($request, function () use ($request, $workspaceId, $parsed): array {
                    $limit = DB::table('quotas')->where('workspace_id', $workspaceId)->value('links_limit');
                    $preview = [
                        'aliases' => [],
                        'remaining' => $limit === null ? null : max(0, (int) $limit - Link::where('workspace_id', $workspaceId)->count()),
                    ];
                    $rows = [];
                    foreach ($parsed['rows'] as $offset => $cells) {
                        $rows[] = $this->resolveRow($request, $parsed['header'], $cells, $offset + 2, true, $preview);
                    }

                    return $this->summarizeRows($rows, true);
                });

                return response()->json($body);
            }
            DB::table('link_import_batches')->where('expires_at', '<', now())->delete();
            $batchId = WorkspaceMutation::run($request, function () use ($user, $workspaceId, $scope, $key, $hash, $lease): int {
                Idempotency::renew((int) $user->id, $scope, (string) $key, $hash, $lease);

                return $this->openBatch((int) $user->id, $workspaceId, (string) $key, $hash);
            });
            foreach ($parsed['rows'] as $offset => $cells) {
                $row = $offset + 2;
                WorkspaceMutation::run($request, function () use ($request, $user, $scope, $key, $hash, $lease, $batchId, $row, $parsed, $cells): void {
                    // Account → workspace → reservation. Keep this lock through
                    // link creation AND ledger insertion, even if the row is slow.
                    Idempotency::renew((int) $user->id, $scope, (string) $key, $hash, $lease);
                    DB::table('link_import_batches')->where('id', $batchId)->update(['expires_at' => now()->addHours(Idempotency::TTL_HOURS)]);
                    $recorded = DB::table('link_import_rows')->where('batch_id', $batchId)->where('row_number', $row)->first();
                    if ($recorded !== null) {
                        return;
                    }
                    $outcome = $this->resolveRow($request, $parsed['header'], $cells, $row, false);
                    DB::table('link_import_rows')->insert([
                        'batch_id' => $batchId,
                        'row_number' => $row,
                        'status' => $outcome['status'],
                        'created_link_id' => $outcome['link_id'],
                        'error' => $outcome['error'],
                        'created_at' => now(),
                    ]);
                    Idempotency::renew((int) $user->id, $scope, (string) $key, $hash, $lease);
                });
            }
            $body = WorkspaceMutation::run($request, function () use ($user, $scope, $key, $hash, $lease, $batchId): array {
                Idempotency::renew((int) $user->id, $scope, (string) $key, $hash, $lease);
                DB::table('link_import_batches')->where('id', $batchId)->update(['expires_at' => now()->addHours(Idempotency::TTL_HOURS)]);
                // The persisted ledger is authoritative, including rows
                // completed by an earlier holder before this takeover.
                $rows = DB::table('link_import_rows')->where('batch_id', $batchId)
                    ->orderBy('row_number')->get()->map(fn ($row) => (array) $row)->all();
                $body = $this->summarizeRows($rows, false);
                Idempotency::commit((int) $user->id, $scope, (string) $key, $hash, 200, $body, $lease);

                return $body;
            });
        } catch (\Throwable $e) {
            if (! $dryRun) {
                Idempotency::release((int) $user->id, $scope, (string) $key, $lease);
            }
            if ($e instanceof LinkException) {
                return response()->json(['error' => $e->getMessage()], $e->status);
            }
            throw $e;
        }
        $created = $body['created'];
        $errors = $body['errors'];

        if ($created > 0 || $errors !== []) {
            Audit::write($user->id, 'link.import', 'link', null, [
                'created' => $created,
                'failed' => $body['failed'],
                'invalid' => count($errors),
            ], UvhRequest::ip($request), workspaceId: $workspaceId);
        }

        return response()->json($body);
    }

    /**
     * Abre (o retoma) el lote de esta importación: cuenta + workspace + clave
     * de idempotencia. Si la clave ya corrió y murió, devuelve el lote
     * existente para reanudar desde sus filas registradas.
     */
    private function openBatch(int $userId, int $workspaceId, string $key, string $requestHash): int
    {
        DB::table('link_import_batches')->insertOrIgnore([
            'user_id' => $userId,
            'workspace_id' => $workspaceId,
            'idempotency_key' => $key,
            'request_hash' => $requestHash,
            'created_at' => now(),
            'expires_at' => now()->addHours(Idempotency::TTL_HOURS),
        ]);
        $batch = DB::table('link_import_batches')
            ->where('user_id', $userId)->where('workspace_id', $workspaceId)->where('idempotency_key', $key)->first();
        if ($batch === null || ! hash_equals((string) $batch->request_hash, $requestHash)) {
            throw new LinkException('Esta Idempotency-Key ya se usó con otra importación', 409);
        }

        return (int) $batch->id;
    }

    /**
     * @param  list<string>  $header
     * @param  list<string>  $cells
     * @param  array{aliases?: array<string, true>, remaining?: int|null}|null  $preview
     * @return array{row_number: int, status: string, link_id: ?int, error: ?string}
     */
    private function resolveRow(Request $request, array $header, array $cells, int $row, bool $dryRun, ?array &$preview = null): array
    {
        $workspaceId = UvhRequest::workspaceId($request);
        $input = $this->inputFromRow($header, $cells);
        $rejected = fn (string $error): array => ['row_number' => $row, 'status' => 'rejected', 'link_id' => null, 'error' => $error];
        if (array_key_exists(self::DOMAIN_COLUMN, $input)) {
            $hostname = (string) $input[self::DOMAIN_COLUMN];
            unset($input[self::DOMAIN_COLUMN]);
            if ($hostname !== '') {
                $domain = CustomDomain::where('workspace_id', $workspaceId)
                    ->whereRaw('lower(domain) = lower(?)', [$hostname])->first(['id']);
                if (! $domain) {
                    return $rejected('El dominio '.$hostname.' no existe en este workspace');
                }
                $input['domain_id'] = (int) $domain->id;
            }
        }
        $check = LinkService::validate($input);
        if (! $check['ok']) {
            return $rejected((string) $check['error']);
        }
        if ($dryRun) {
            $domainId = $input['domain_id'] ?? null;
            if ($domainId !== null && ! CustomDomain::where('id', $domainId)->where('workspace_id', $workspaceId)
                ->where('desired_state', 'enabled')->where('edge_eligible', true)->whereNotNull('tls_ready_at')->exists()) {
                return $rejected('Dominio no activado o sin acceso');
            }
            $alias = ! empty($input['alias']) ? UrlUtil::normalizeAlias($input['alias']) : null;
            $identity = $domainId.':'.$alias;
            if ($alias !== null && (isset($preview['aliases'][$identity]) || Link::where('domain_id', $domainId)->where('alias', $alias)->exists())) {
                return $rejected('Este alias ya está en uso');
            }
            if (($preview['remaining'] ?? null) !== null && $preview['remaining'] < 1) {
                return $rejected('Cuota de enlaces alcanzada');
            }
            if ($alias !== null) {
                $preview['aliases'][$identity] = true;
            }
            if (($preview['remaining'] ?? null) !== null) {
                $preview['remaining']--;
            }

            return ['row_number' => $row, 'status' => 'valid', 'link_id' => null, 'error' => null];
        }
        try {
            $user = UvhRequest::user($request);
            $made = LinkService::create($workspaceId, (int) $user->id, $input, UvhRequest::apiToken($request), (int) $user->security_version);

            return ['row_number' => $row, 'status' => 'created', 'link_id' => (int) $made['id'], 'error' => null];
        } catch (LinkException $e) {
            return ['row_number' => $row, 'status' => 'failed', 'link_id' => null, 'error' => $e->getMessage()];
        }
    }

    /**
     * Los contadores no se solapan: `valid` son las filas que se importaron (o
     * importarían en dry run) —una fila que falló al crear no es válida—,
     * `created` son los enlaces de verdad creados y `failed` las filas que
     * superaron la validación pero no llegaron a crear su enlace. Las filas
     * rechazadas en validación sólo aparecen en `errors`.
     *
     * @param  list<array<string, mixed>>  $rows
     * @return array{dryRun: bool, valid: int, created: int, failed: int, errors: list<array{row: int, error: string}>, truncated: bool}
     */
    private function summarizeRows(array $rows, bool $dryRun): array
    {
        $valid = $created = $failed = 0;
        $errors = [];
        $truncated = false;
        foreach ($rows as $row) {
            if ($row['status'] === 'created') {
                $valid++;
                $created++;
            } elseif ($row['status'] === 'valid') {
                $valid++;
            } elseif ($row['status'] === 'failed') {
                $failed++;
            }
            if ($row['error'] !== null) {
                $errors = $this->pushError($errors, (int) $row['row_number'], (string) $row['error'], $truncated);
            }
        }

        return compact('dryRun', 'valid', 'created', 'failed', 'errors', 'truncated');
    }

    /**
     * Traduce una fila del CSV al contrato de creación de enlace. Las
     * etiquetas del export viajan como JSON; `tags` conserva el formato legado con `;`.
     *
     * @param  list<string>  $header
     * @param  list<string>  $cells
     * @return array<string, mixed>
     */
    private function inputFromRow(array $header, array $cells): array
    {
        $input = [];
        foreach ($header as $index => $column) {
            if (in_array($column, self::READ_ONLY_COLUMNS, true)) {
                // Sólo informan (id, estado, clics, creación): el round-trip
                // las acepta y las ignora —nunca son entrada de creación—.
                continue;
            }
            // El export protege toda celda contra fórmulas; al volver a entrar
            // se deshace esa protección para no alterar el valor original.
            $value = trim(Csv::unguard(trim((string) ($cells[$index] ?? ''))));
            if ($value === '') {
                continue;
            }
            if ($column === 'tags_json') {
                $decoded = json_decode($value, true);
                $input['tags'] = str_starts_with($value, '[') && is_array($decoded) && array_is_list($decoded) ? $decoded : $value;
            } elseif ($column === 'tags') {
                $input['tags'] = array_values(array_filter(array_map('trim', explode(';', $value))));
            } elseif ($column === 'max_clicks') {
                $input['max_clicks'] = ctype_digit($value) ? (int) $value : $value;
            } elseif ($column === 'single_use') {
                $input['single_use'] = in_array(mb_strtolower($value), ['true', '1', 'sí', 'si'], true) ? true
                    : (in_array(mb_strtolower($value), ['false', '0', 'no'], true) ? false : $value);
            } else {
                $input[$column] = $value;
            }
        }

        return $input;
    }

    /**
     * @param  list<array{row: int, error: string}>  $errors
     * @return list<array{row: int, error: string}>
     */
    private function pushError(array $errors, int $row, string $error, bool &$truncated): array
    {
        if (count($errors) >= self::MAX_REPORTED_ERRORS) {
            $truncated = true;

            return $errors;
        }
        $errors[] = ['row' => $row, 'error' => $error];

        return $errors;
    }
}
