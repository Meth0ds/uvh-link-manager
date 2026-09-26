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
 * Del lado de la importación, ningún campo admitido puede contener saltos de
 * línea (las validaciones de notas/UTM/etiquetas rechazan caracteres de
 * control), así que el archivo es una fila por línea y parsear línea a línea
 * es correcto, no una simplificación.
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
     * @return array{ok: true, header: list<string>, rows: list<list<string>>}|array{ok: false, error: string}
     */
    public static function parse(string $text, int $maxRows): array
    {
        if (str_starts_with($text, "\xEF\xBB\xBF")) {
            $text = substr($text, 3);
        }
        $lines = preg_split("/\r\n|\n|\r/", $text);
        if ($lines === false) {
            return ['ok' => false, 'error' => 'CSV ilegible'];
        }
        // Una última línea vacía es el salto final del archivo, no una fila.
        while ($lines !== [] && end($lines) === '') {
            array_pop($lines);
        }
        if ($lines === []) {
            return ['ok' => false, 'error' => 'El archivo CSV está vacío'];
        }
        if (count($lines) - 1 > $maxRows) {
            return ['ok' => false, 'error' => 'El archivo supera el máximo de '.$maxRows.' filas'];
        }

        $header = array_map(
            static fn (string $cell): string => mb_strtolower(trim($cell)),
            str_getcsv((string) array_shift($lines), ',', '"', ''),
        );
        $rows = [];
        foreach ($lines as $line) {
            $rows[] = str_getcsv((string) $line, ',', '"', '');
        }

        return ['ok' => true, 'header' => $header, 'rows' => $rows];
    }
}
