<?php

namespace App\Http\Controllers;

use App\Exceptions\LinkException;
use App\Models\CustomDomain;
use App\Models\Link;
use App\Support\Audit;
use App\Support\Csv;
use App\Support\Idempotency;
use App\Support\LinkService;
use App\Support\UvhRequest;
use Illuminate\Database\QueryException;
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
    private const COLUMNS = ['alias', 'destination', 'fallback_destination', 'notes', 'tags', 'scheduled_at', 'expires_at', 'max_clicks', 'single_use'];

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
        $lines = ["\xEF\xBB\xBF".Csv::line(['id', 'alias', 'domain', 'destination', 'fallback_destination', 'state', 'click_count', 'max_clicks', 'single_use', 'scheduled_at', 'expires_at', 'notes', 'tags', 'created_at'])];
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
                implode(';', $link->tags->pluck('name')->all()),
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

        // Lo que una ejecución anterior de ESTA clave ya resolvió: si el proceso
        // murió a mitad de archivo, el reintento reanuda —reproduce los
        // resultados registrados y sólo procesa el resto— en vez de duplicar.
        $batchId = 0;
        $recorded = collect();
        if (! $dryRun) {
            DB::table('link_import_batches')->where('created_at', '<', now()->subDay())->delete();
            $batchId = $this->openBatch((int) $user->id, $workspaceId, (string) $key, $hash);
            $recorded = DB::table('link_import_rows')->where('batch_id', $batchId)
                ->get(['row_number', 'status', 'error'])->keyBy('row_number');
        }

        $errors = [];
        $truncated = false;
        $created = 0;
        $valid = 0;
        $apiTokenContext = UvhRequest::apiToken($request);
        $actorSecurityVersion = (int) $user->security_version;

        try {
            foreach ($parsed['rows'] as $offset => $cells) {
                $row = $offset + 2; // La cabecera es la fila 1 del archivo.
                if ($recorded->has($row)) {
                    // Fila ya resuelta por la ejecución anterior: se reproduce su
                    // resultado registrado, sin tocar nada más.
                    $outcome = $recorded->get($row);
                    if ($outcome->status === 'created') {
                        $valid++;
                        $created++;
                    } elseif ($outcome->status === 'failed') {
                        $valid++;
                    }
                    if ($outcome->error !== null) {
                        $errors = $this->pushError($errors, $row, (string) $outcome->error, $truncated);
                    }

                    continue;
                }

                $input = $this->inputFromRow($parsed['header'], $cells);
                // `domain` viaja como hostname en el export y se resuelve contra el
                // workspace destino: vacío = dominio por defecto; un hostname que
                // el destino no tiene es un error de fila, no un enlace a medias.
                if (array_key_exists(self::DOMAIN_COLUMN, $input)) {
                    $hostname = (string) $input[self::DOMAIN_COLUMN];
                    unset($input[self::DOMAIN_COLUMN]);
                    if ($hostname !== '') {
                        $domain = CustomDomain::where('workspace_id', $workspaceId)
                            ->whereRaw('lower(domain) = lower(?)', [$hostname])
                            ->first(['id']);
                        if (! $domain) {
                            $reason = 'El dominio '.$hostname.' no existe en este workspace';
                            $this->recordRow($batchId, $row, 'rejected', null, $reason, $dryRun);
                            $errors = $this->pushError($errors, $row, $reason, $truncated);

                            continue;
                        }
                        $input['domain_id'] = (int) $domain->id;
                    }
                }
                $check = LinkService::validate($input);
                if (! $check['ok']) {
                    $this->recordRow($batchId, $row, 'rejected', null, (string) $check['error'], $dryRun);
                    $errors = $this->pushError($errors, $row, (string) $check['error'], $truncated);

                    continue;
                }
                $valid++;
                if ($dryRun) {
                    continue;
                }
                try {
                    // Creación y anotación de la fila compilan juntas: o la fila
                    // queda creada y registrada, o no existe en ningún lado. El
                    // índice único (batch, fila) es además la valla contra un
                    // segundo intento que corriera en paralelo tras un takeover.
                    DB::transaction(function () use ($workspaceId, $user, $input, $apiTokenContext, $actorSecurityVersion, $batchId, $row): void {
                        $made = LinkService::create($workspaceId, (int) $user->id, $input, $apiTokenContext, $actorSecurityVersion);
                        DB::table('link_import_rows')->insert([
                            'batch_id' => $batchId,
                            'row_number' => $row,
                            'status' => 'created',
                            'created_link_id' => $made['id'],
                            'error' => null,
                            'created_at' => now(),
                        ]);
                    });
                    $created++;
                } catch (LinkException $e) {
                    // Cada fila es independiente: un alias repetido o una cuota
                    // agotada se reporta y el resto sigue.
                    $this->recordRow($batchId, $row, 'failed', null, $e->getMessage(), $dryRun);
                    $errors = $this->pushError($errors, $row, $e->getMessage(), $truncated);
                } catch (QueryException $e) {
                    if (($e->errorInfo[0] ?? null) !== '23505') {
                        throw $e;
                    }
                    // Otro intento de la misma clave resolvió esta fila a la vez
                    // (sólo posible tras un takeover de arriendo): su registro
                    // manda y se cuenta su resultado.
                    $outcome = DB::table('link_import_rows')->where('batch_id', $batchId)->where('row_number', $row)
                        ->first(['status', 'error']);
                    if ($outcome?->status === 'created') {
                        $created++;
                    }
                    if ($outcome?->error !== null) {
                        $errors = $this->pushError($errors, $row, (string) $outcome->error, $truncated);
                    }
                }
            }
        } catch (\Throwable $e) {
            // Caída inesperada a mitad de archivo: la reserva se libera y el
            // lote conserva lo ya resuelto —el reintento reanuda desde ahí—.
            if (! $dryRun) {
                Idempotency::release((int) $user->id, $scope, (string) $key, $lease);
            }
            throw $e;
        }

        $body = [
            'dryRun' => $dryRun,
            'valid' => $valid,
            'created' => $created,
            'errors' => $errors,
            'truncated' => $truncated,
        ];
        if (! $dryRun) {
            Idempotency::commit((int) $user->id, $scope, (string) $key, $hash, 200, $body, $lease);
        }

        if (! $dryRun && ($created > 0 || $errors !== [])) {
            Audit::write($user->id, 'link.import', 'link', null, [
                'created' => $created,
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
        try {
            return (int) DB::table('link_import_batches')->insertGetId([
                'user_id' => $userId,
                'workspace_id' => $workspaceId,
                'idempotency_key' => $key,
                'request_hash' => $requestHash,
                'created_at' => now(),
            ]);
        } catch (QueryException $e) {
            if (($e->errorInfo[0] ?? null) !== '23505') {
                throw $e;
            }

            return (int) DB::table('link_import_batches')
                ->where('user_id', $userId)->where('workspace_id', $workspaceId)->where('idempotency_key', $key)
                ->value('id');
        }
    }

    /**
     * Anota el resultado de una fila del lote. En dryRun no se escribe nada.
     * Las filas fallidas usan `insertOrIgnore`: dos intentos de la misma clave
     * sólo corren a la vez tras un takeover de arriendo, y el primero en anotar
     * manda. Las filas creadas se anotan con `insert` dentro de la MISMA
     * transacción que la creación, con el índice único como valla.
     */
    private function recordRow(int $batchId, int $row, string $status, ?int $linkId, ?string $error, bool $dryRun): void
    {
        if ($dryRun || $batchId === 0) {
            return;
        }
        DB::table('link_import_rows')->insertOrIgnore([
            'batch_id' => $batchId,
            'row_number' => $row,
            'status' => $status,
            'created_link_id' => $linkId,
            'error' => $error,
            'created_at' => now(),
        ]);
    }

    /**
     * Traduce una fila del CSV al contrato de creación de enlace. Las
     * etiquetas viajan en una celda separadas por `;`.
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
            if ($column === 'tags') {
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
