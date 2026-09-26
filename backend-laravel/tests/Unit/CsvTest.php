<?php

namespace Tests\Unit;

use App\Support\Csv;
use PHPUnit\Framework\TestCase;

/**
 * El CSV contra su contrato: parseo RFC 4180 real —campos entrecomillados con
 * comas, comillas escapadas y saltos de línea— y el guardado anti-fórmulas con
 * su inversa, para que export→import sea un round-trip.
 */
final class CsvTest extends TestCase
{
    public function test_parse_reads_rfc_4180_records_not_physical_lines(): void
    {
        $text = "alias,notes\n".
            "\"a\",\"hola, mundo\"\n".
            "\"b\",\"linea1\nlinea2\"\n".
            "\"c\",\"dijo \"\"hola\"\"\"\n";

        $parsed = Csv::parse($text, 10);

        $this->assertTrue($parsed['ok']);
        $this->assertSame(['alias', 'notes'], $parsed['header']);
        $this->assertSame([
            ['a', 'hola, mundo'],
            ['b', "linea1\nlinea2"],
            ['c', 'dijo "hola"'],
        ], $parsed['rows']);
    }

    public function test_parse_strips_the_byte_order_mark_and_trailing_blank_lines(): void
    {
        $parsed = Csv::parse("\xEF\xBB\xBFalias,destination\na,https://example.org\n\n", 10);

        $this->assertTrue($parsed['ok']);
        $this->assertSame(['alias', 'destination'], $parsed['header']);
        $this->assertSame([['a', 'https://example.org']], $parsed['rows']);
    }

    public function test_parse_enforces_the_row_limit_and_refuses_an_empty_file(): void
    {
        $tooMany = Csv::parse("alias,destination\n".implode("\n", array_map(
            static fn (int $i): string => "a{$i},https://example.org/{$i}",
            range(1, 3),
        )), 2);
        $this->assertFalse($tooMany['ok']);
        $this->assertSame('El archivo supera el máximo de 2 filas', $tooMany['error']);

        $this->assertSame('El archivo CSV está vacío', Csv::parse("  \n", 10)['error']);
        $this->assertSame('El archivo CSV está vacío', Csv::parse('', 10)['error']);
    }

    public function test_guard_and_unguard_round_trip_a_formula_cell(): void
    {
        $this->assertSame("'=SUM(A1:A9)", Csv::guard('=SUM(A1:A9)'));
        $this->assertSame('=SUM(A1:A9)', Csv::unguard(Csv::guard('=SUM(A1:A9)')));
        $this->assertSame('hola', Csv::unguard(Csv::guard('hola')));

        // Un valor que no es fórmula no se toca en ninguna dirección.
        $this->assertSame("'hola", Csv::unguard("'hola"));
        $this->assertSame('=x', Csv::unguard('=x'));
    }

    public function test_line_quotes_cells_rfc_4180(): void
    {
        $this->assertSame('"hola, mundo","dijo ""hola"""', Csv::line(['hola, mundo', 'dijo "hola"']));
    }
}
