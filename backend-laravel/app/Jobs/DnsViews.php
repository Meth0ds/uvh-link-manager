<?php

namespace App\Jobs;

/**
 * DNS multi-resolver: el resolvedor del sistema más los resolvedores
 * públicos que configure el despliegue, combinados por consenso en vez de por
 * confianza en uno solo.
 *
 * Por qué: la comprobación de un hostname decide quién sirve enlaces sobre él
 * (y quién pierde un claim). Un único resolvedor es un único punto de
 * envenenamiento: quien controle la caché que lee la plataforma puede hacer
 * que «exista» un TXT que nadie publicó. Consultar vistas independientes —el
 * sistema y resolvedores públicos por DNS-over-HTTPS— y exigir mayoría convierte
 * ese ataque en una discrepancia que nunca se aprueba.
 *
 * Contrato deliberado:
 *  - Una vista que falla es silencio, no disenso: jamás desautoriza una
 *    respuesta, pero tampoco la avala. La regla efectiva es **mayoría estricta
 *    de las vistas que respondieron**; con una sola vista (desarrollo, tests,
 *    el stack E2E sin resolvedores públicos) esa vista decide sola.
 *  - Un NXDOMAIN desde un resolvedor público es una *respuesta* —la vacía—, no
 *    un fallo: debe poder desautorizar un positivo envenenado, cosa que una
 *    vista muda no puede hacer. Es deliberadamente asimétrico con la vista del
 *    sistema, cuyo `dns_get_record` no distingue «no existe» de «no pude
 *    consultar» y devuelve `false` para ambas.
 *  - Empate o unanimidad imposible (dos vistas que discrepan sin mayoría)
 *    devuelve `false`: la respuesta «fiable» que ya entienden las llamadas como
 *    caída del resolvedor. Una lectura inconclusa nunca mueve el estado de un
 *    dominio.
 *  - El TTL y el orden varían entre resolvedores; la respuesta no. La firma de
 *    consenso sólo mira los datos semánticos del registro.
 *  - Los endpoints DoH son fijos y el nombre consultado viaja como parámetro:
 *    ninguna entrada de usuario puede apuntar la consulta a otro host.
 */
final class DnsViews
{
    /** Endpoints DNS-over-HTTPS de los resolvedores públicos por nombre. */
    private const DOH = [
        'cloudflare' => 'https://cloudflare-dns.com/dns-query',
        'google' => 'https://dns.google/resolve',
    ];

    /**
     * Sustituto de la red para las vistas públicas (tests): recibe nombre, tipo
     * y resolvedor, y devuelve registros con forma de `dns_get_record` o `false`.
     *
     * @var (callable(string, int, string): (list<array<string, mixed>>|false))|null
     */
    private static $publicResolver = null;

    /** @var list<string>|null Resolvedores forzados; null = los de la config. */
    private static ?array $resolvers = null;

    /** @param  (callable(string, int, string): (list<array<string, mixed>>|false))|null  $resolver */
    public static function fakePublicResolver(?callable $resolver): void
    {
        self::$publicResolver = $resolver;
    }

    /** @param  list<string>|null  $resolvers */
    public static function usePublicResolvers(?array $resolvers): void
    {
        self::$resolvers = $resolvers;
    }

    public static function reset(): void
    {
        self::$publicResolver = null;
        self::$resolvers = null;
    }

    /**
     * El conjunto de registros en el que las vistas acuerdan, o `false` cuando
     * no hay respuesta fiable (todo falló, o las vistas discrepan sin mayoría).
     *
     * @return list<array<string, mixed>>|false
     */
    public static function records(string $hostname, int $type): array|false
    {
        /** @var array<string, list<array<string, mixed>>> $groups */
        $groups = [];
        /** @var array<string, int> $counts */
        $counts = [];
        $total = 0;
        foreach (self::views($hostname, $type) as $records) {
            if ($records === false) {
                continue;
            }
            $signature = self::signature($records);
            if (! isset($groups[$signature])) {
                $groups[$signature] = $records;
            }
            $counts[$signature] = ($counts[$signature] ?? 0) + 1;
            $total++;
        }
        if ($total === 0) {
            return false;
        }

        // La respuesta más compartida es la respuesta; sin mayoría estricta
        // (empate entre vistas) no hay consenso y no se responde.
        $bestSignature = null;
        $bestCount = 0;
        foreach ($counts as $signature => $count) {
            if ($count > $bestCount) {
                $bestCount = $count;
                $bestSignature = $signature;
            }
        }
        if ($bestSignature === null) {
            return false;
        }
        // Una sola voz responde: sin segunda opinión no hay empate que
        // resolver y esa vista decide (consenso desactivado, p. ej. en dev).
        if ($total > 1 && $bestCount * 2 <= $total) {
            return false;
        }

        return $groups[$bestSignature];
    }

    /**
     * Cada vista del mismo registro: primero la del sistema, después una por
     * resolvedor público configurado.
     *
     * @return array<string, list<array<string, mixed>>|false>
     */
    public static function views(string $hostname, int $type): array
    {
        // El resolvedor del sistema contesta con un aviso —y en Laravel ese
        // aviso es una excepción— cuando no hay respuesta fiable (SERVFAIL,
        // timeout). Eso es exactamente «esta vista no responde», que `records()`
        // ya sabe traducir; nunca debe convertirse en un fallo del trabajo.
        $answer = @dns_get_record($hostname, $type);
        $views = ['system' => is_array($answer) ? $answer : false];
        foreach (self::publicResolvers() as $source) {
            $views[$source] = self::$publicResolver !== null
                ? (self::$publicResolver)($hostname, $type, $source)
                : self::doh($hostname, $type, $source);
        }

        return $views;
    }

    /** @return list<string> */
    private static function publicResolvers(): array
    {
        if (self::$resolvers !== null) {
            return self::$resolvers;
        }
        try {
            $configured = (array) config('uvh.custom_domains.public_resolvers', []);
        } catch (\Throwable) {
            // Sin contenedor (tests unitarios aislados) sólo existe la vista
            // del sistema; el consenso está desactivado y nada se rompe.
            return [];
        }

        return array_values(array_filter(
            $configured,
            static fn (mixed $name): bool => is_string($name) && isset(self::DOH[$name]),
        ));
    }

    /**
     * Consulta DNS-over-HTTPS de un resolvedor público. Los errores de red o
     * transporte son silencio (`false`); el «no existe» es la respuesta vacía.
     *
     * @return list<array<string, mixed>>|false
     */
    private static function doh(string $hostname, int $type, string $source): array|false
    {
        $endpoint = self::DOH[$source] ?? null;
        if ($endpoint === null) {
            return false;
        }
        $url = $endpoint.(str_contains($endpoint, '?') ? '&' : '?')
            .'name='.rawurlencode($hostname).'&type='.$type;

        $handle = curl_init($url);
        if ($handle === false) {
            return false;
        }
        curl_setopt_array($handle, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 2,
            CURLOPT_TIMEOUT => 4,
            CURLOPT_HTTPHEADER => ['Accept: application/dns-json'],
            CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
        ]);
        $body = curl_exec($handle);
        $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
        curl_close($handle);
        if (! is_string($body) || $status !== 200) {
            return false;
        }
        $payload = json_decode($body, true);
        if (! is_array($payload)) {
            return false;
        }
        $rcode = (int) ($payload['Status'] ?? -1);
        if ($rcode === 3) {
            // NXDOMAIN: el nombre no existe. Respuesta, no avería.
            return [];
        }
        if ($rcode !== 0) {
            return false;
        }
        $answers = $payload['Answer'] ?? [];
        if (! is_array($answers)) {
            return [];
        }
        $records = [];
        foreach ($answers as $answer) {
            if (! is_array($answer)) {
                continue;
            }
            $record = self::fromWire($hostname, (int) ($answer['type'] ?? 0), (string) ($answer['data'] ?? ''));
            if ($record !== null) {
                $records[] = $record;
            }
        }

        return $records;
    }

    /** @return array<string, mixed>|null */
    private static function fromWire(string $hostname, int $type, string $data): ?array
    {
        return match ($type) {
            1 => ['host' => $hostname, 'type' => 'A', 'ip' => $data],
            5 => ['host' => $hostname, 'type' => 'CNAME', 'target' => strtolower(rtrim($data, '.'))],
            16 => ['host' => $hostname, 'type' => 'TXT', 'txt' => $data, 'entries' => [$data]],
            28 => ['host' => $hostname, 'type' => 'AAAA', 'ipv6' => $data],
            257 => self::caaRecord($hostname, $data),
            default => null,
        };
    }

    /** @return array<string, mixed>|null */
    private static function caaRecord(string $hostname, string $data): ?array
    {
        // Presentación de CAA: `flags tag "value"`.
        if (preg_match('/^(\d+)\s+(\S+)\s+"?([^"]*)"?$/', trim($data), $matches) !== 1) {
            return null;
        }

        return [
            'host' => $hostname,
            'type' => 'CAA',
            'flags' => (int) $matches[1],
            'tag' => strtolower($matches[2]),
            'value' => trim($matches[3]),
        ];
    }

    /**
     * Firma semántica de un conjunto de registros: mismo tipo y mismos datos
     * aunque cambien TTL, orden o la caja del texto.
     *
     * @param  list<array<string, mixed>>  $records
     */
    private static function signature(array $records): string
    {
        $parts = [];
        foreach ($records as $record) {
            $parts[] = self::semantic($record);
        }
        sort($parts);

        return implode("\n", $parts);
    }

    /** @param  array<string, mixed>  $record */
    private static function semantic(array $record): string
    {
        $type = strtolower((string) ($record['type'] ?? ''));
        if ($type === '') {
            // `dns_get_record` a veces omite el tipo: se infiere de las claves,
            // igual que hacen las comprobaciones que juzgan los registros.
            $type = match (true) {
                isset($record['txt']), isset($record['entries']) => 'txt',
                isset($record['target']) => 'cname',
                isset($record['ipv6']) => 'aaaa',
                isset($record['ip']) => 'a',
                isset($record['tag']) => 'caa',
                default => '',
            };
        }
        $value = match ($type) {
            'txt' => self::txtValue($record),
            'cname' => strtolower(rtrim((string) ($record['target'] ?? ''), '.')),
            'a' => (string) ($record['ip'] ?? ''),
            'aaaa' => (string) ($record['ipv6'] ?? $record['ip'] ?? ''),
            'caa' => strtolower((string) ($record['tag'] ?? '')).'='.trim((string) ($record['value'] ?? '')),
            default => strtolower((string) ($record['target'] ?? $record['ip'] ?? '')),
        };

        return $type.'|'.$value;
    }

    /** @param  array<string, mixed>  $record */
    private static function txtValue(array $record): string
    {
        $value = $record['txt'] ?? '';
        if (is_string($value) && $value !== '') {
            return strtolower(trim($value, " \t\r\n\""));
        }
        $entries = $record['entries'] ?? null;
        if (! is_array($entries)) {
            return '';
        }
        $parts = array_filter($entries, static fn (mixed $part): bool => is_string($part));

        return strtolower(trim(implode('', $parts), " \t\r\n\""));
    }
}
