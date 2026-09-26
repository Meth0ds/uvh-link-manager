<?php

namespace App\Http\Controllers;

use App\Exceptions\LinkException;
use App\Models\Link;
use App\Support\Audit;
use App\Support\Csv;
use App\Support\Idempotency;
use App\Support\LinkService;
use App\Support\UvhRequest;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

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
 */
class LinkCsvController
{
    private const MAX_IMPORT_BYTES = 262_144;

    private const MAX_IMPORT_ROWS = 500;

    private const MAX_EXPORT_ROWS = 5_000;

    private const MAX_REPORTED_ERRORS = 100;

    /** Columnas que el archivo puede traer; una desconocida es un error. */
    private const COLUMNS = ['alias', 'destination', 'fallback_destination', 'notes', 'tags', 'scheduled_at', 'expires_at', 'max_clicks', 'single_use'];

    private const SCOPE = 'links.import';

    public function export(Request $request): JsonResponse|Response
    {
        $workspaceId = UvhRequest::workspaceId($request);

        $total = Link::where('workspace_id', $workspaceId)->whereNull('deleted_at')->count();
        if ($total > self::MAX_EXPORT_ROWS) {
            return response()->json(['error' => 'El export CSV admite hasta '.self::MAX_EXPORT_ROWS.' enlaces ('.$total.')'], 409);
        }

        $links = Link::with('tags')->where('workspace_id', $workspaceId)->whereNull('deleted_at')
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
            if (! in_array($column, self::COLUMNS, true)) {
                return response()->json(['error' => 'Columna desconocida: '.$column], 422);
            }
        }
        if (! in_array('alias', $parsed['header'], true) || ! in_array('destination', $parsed['header'], true)) {
            return response()->json(['error' => 'El CSV necesita las columnas alias y destination'], 422);
        }

        $hash = Idempotency::hash($request->getContent());
        $key = $request->header('Idempotency-Key');
        if (! $dryRun) {
            $keyCheck = Idempotency::validateKey($key);
            if (! $keyCheck['ok']) {
                return response()->json(['error' => $keyCheck['error']], 422);
            }
            $key = (string) $key;
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
        }

        $errors = [];
        $truncated = false;
        $created = 0;
        $valid = 0;
        $apiTokenContext = UvhRequest::apiToken($request);
        $actorSecurityVersion = (int) $user->security_version;

        foreach ($parsed['rows'] as $offset => $cells) {
            $row = $offset + 2; // La cabecera es la fila 1 del archivo.
            $input = $this->inputFromRow($parsed['header'], $cells);
            $check = LinkService::validate($input);
            if (! $check['ok']) {
                $errors = $this->pushError($errors, $row, (string) $check['error'], $truncated);

                continue;
            }
            $valid++;
            if ($dryRun) {
                continue;
            }
            try {
                LinkService::create($workspaceId, (int) $user->id, $input, $apiTokenContext, $actorSecurityVersion);
                $created++;
            } catch (LinkException $e) {
                // Cada fila es independiente: un alias repetido o una cuota
                // agotada se reporta y el resto sigue.
                $errors = $this->pushError($errors, $row, $e->getMessage(), $truncated);
            }
        }

        $body = [
            'dryRun' => $dryRun,
            'valid' => $valid,
            'created' => $created,
            'errors' => $errors,
            'truncated' => $truncated,
        ];
        if (! $dryRun) {
            Idempotency::commit((int) $user->id, self::SCOPE, (string) $key, $hash, 200, $body);
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
            $value = trim((string) ($cells[$index] ?? ''));
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
