<?php

namespace App\Support;

/**
 * CSV de import/export de enlaces (F7), con la única defensa que funciona
 * contra la inyección de fórmulas.
 *
 * Una celda que empieza por `=`, `+`, `-` o `@` la interpreta cualquier
 * hoja de cálculo como fórmula al abrir el archivo: entrecomillarla no basta.
 * La convención aceptada es anteponer una comilla simple (`'=1+1`), que la
 * hoja muestra como texto. `guard()` se aplica a TODA celda exportada.
 *
 * Del lado de la importación, `unguard()` deshace exactamente esa protección
 * (comilla seguida de un prefijo de fórmula), de modo que un archivo exportado
 * por UVH se puede volver a importar sin que las notas legítimas acaben con
 * una comilla de más: export→import es un round-trip. Un valor cuyo primer
 * carácter legítimo es la comilla seguida de `=` no distingue su caso del
 * escapado —ambos son la misma cadena en el archivo— y se importa sin la
 * comilla; es la única ambigüedad de la convención.
 *
 * La importación parsea con `fgetcsv` sobre un stream: CSV RFC 4180 de verdad,
 * con campos entrecomillados que contengan comas, comillas escapadas y saltos
 * de línea. La validación posterior —no el parser— es la que rechaza caracteres
 * de control en los campos.
 */
final class Csv
{
    /** @var list<string> */
    private const FORMULA_PREFIXES = ['=', '+', '-', '@', "\t", "\r"];

    public static function guard(string $value): string
    {
        if ($value !== '' && in_array($value[0], self::FORMULA_PREFIXES, true)) {
            return "'".$value;
        }

        return $value;
    }

    /**
     * La inversa de `guard()`: una comilla seguida de un prefijo de fórmula es
     * el escapado de UVH y se retira; cualquier otro valor pasa intacto.
     */
    public static function unguard(string $value): string
    {
        if (strlen($value) >= 2 && $value[0] === "'" && in_array($value[1], self::FORMULA_PREFIXES, true)) {
            return substr($value, 1);
        }

        return $value;
    }

    /**
     * Una línea CSV (sin salto final) con comillas RFC 4180 y celdas ya
     * protegidas contra fórmulas.
     *
     * @param  list<string>  $cells
     */
    public static function line(array $cells): string
    {
        $stream = fopen('php://temp', 'r+');
        if ($stream === false) {
            throw new \RuntimeException('CSV buffer unavailable');
        }
        try {
            fputcsv($stream, array_map(self::guard(...), $cells), ',', '"', '');
            rewind($stream);
            $line = fgets($stream);

            return rtrim((string) $line, "\r\n");
        } finally {
            fclose($stream);
        }
    }

    /**
     * Divide el texto en filas de celdas. Primera fila: la cabecera. Devuelve
     * error ante un texto sin cabecera o con más filas de las admitidas.
     *
     * El parser es RFC 4180 (`fgetcsv` sobre un stream): una celda
     * entrecomillada puede contener comas, comillas dobles escapadas y saltos
     * de línea. Los números de fila que la importación reporta son números de
     * REGISTRO; si un valor entrecomillado lleva saltos de línea, no coinciden
     * con los del editor de texto.
     *
     * @return array{ok: true, header: list<string>, rows: list<list<string>>}|array{ok: false, error: string}
     */
    public static function parse(string $text, int $maxRows): array
    {
        if (str_starts_with($text, "\xEF\xBB\xBF")) {
            $text = substr($text, 3);
        }
        if (trim($text) === '') {
            return ['ok' => false, 'error' => 'El archivo CSV está vacío'];
        }

        $stream = fopen('php://temp/maxmemory:2097152', 'r+b');
        if ($stream === false) {
            return ['ok' => false, 'error' => 'CSV ilegible'];
        }
        try {
            Streams::writeAll($stream, $text);
            rewind($stream);

            $header = null;
            $rows = [];
            while (($cells = fgetcsv($stream, null, ',', '"', '')) !== false) {
                // Una línea en blanco es una fila sin celdas, no el fin del archivo.
                if ($cells === [null]) {
                    $cells = [''];
                }
                if ($header === null) {
                    $header = array_map(
                        static fn (mixed $cell): string => mb_strtolower(trim((string) $cell)),
                        $cells,
                    );

                    continue;
                }
                if (count($rows) >= $maxRows) {
                    return ['ok' => false, 'error' => 'El archivo supera el máximo de '.$maxRows.' filas'];
                }
                $rows[] = array_map(static fn (mixed $cell): string => (string) $cell, $cells);
            }
            // Una última fila vacía es el salto final del archivo, no una fila.
            while ($rows !== [] && end($rows) === ['']) {
                array_pop($rows);
            }
            if ($header === null) {
                return ['ok' => false, 'error' => 'El archivo CSV está vacío'];
            }

            return ['ok' => true, 'header' => $header, 'rows' => $rows];
        } finally {
            fclose($stream);
        }
    }
}
