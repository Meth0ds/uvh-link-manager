<?php

namespace App\Support;

/**
 * Guarda SSRF para fetchs del lado del servidor con URLs controladas por el
 * usuario (webhooks):
 * - esquema http/https únicamente, sin credenciales embebidas;
 * - puertos restringidos a {80, 443, 8080, 8443};
 * - resuelve TODOS los registros DNS y rechaza si CUALQUIERA es privado,
 *   loopback, link-local o reservado (incluidas formas IPv6 de transición
 *   que enrutan a espacio IPv4: mapped, compatible, NAT64, 6to4, Teredo);
 * - cierra la ventana TOCTOU del DNS rebinding fijando las IPs validadas con
 *   CURLOPT_RESOLVE (curl conecta solo a las IPs ya validadas, sin segunda
 *   resolución) y nunca sigue redirecciones.
 */
final class Ssrf
{
    private const ALLOWED_PORTS = [80, 443, 8080, 8443];

    /** @var array<int, array{0: int, 1: int}> */
    private const PRIVATE_IPV4_RANGES = [
        [0x00000000, 0x00ffffff], // 0.0.0.0/8
        [0x0a000000, 0x0affffff], // 10.0.0.0/8
        [0x64400000, 0x647fffff], // 100.64.0.0/10 (CGNAT, RFC 6598)
        [0x7f000000, 0x7fffffff], // 127.0.0.0/8 (loopback)
        [0xa9fe0000, 0xa9feffff], // 169.254.0.0/16 (link-local)
        [0xac100000, 0xac1fffff], // 172.16.0.0/12
        [0xc0000000, 0xc00000ff], // 192.0.0.0/24 (IETF protocol assignments)
        [0xc0000200, 0xc00002ff], // 192.0.2.0/24 (TEST-NET)
        [0xc0a80000, 0xc0a8ffff], // 192.168.0.0/16
        // TEST-NET-2 (198.51.100.0/24) y el rango de benchmarking
        // 198.18.0.0/15 (RFC 2544) se cubren ambos para no dejar nada
        // sin proteger.
        [0xc6120000, 0xc613ffff], // 198.18.0.0/15 (benchmarking, RFC 2544)
        [0xc6336400, 0xc63364ff], // 198.51.100.0/24 (TEST-NET-2)
        [0xcb007100, 0xcb0071ff], // 203.0.113.0/24 (TEST-NET-3)
        [0xffff0000, 0xffffffff], // 255.255.255.255/32
    ];

    public static function isPrivateIp(string $ip): bool
    {
        if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) !== false) {
            $n = self::ipv4ToInt($ip);

            return self::isPrivateIpv4($n);
        }

        if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6) !== false) {
            $bin = inet_pton($ip);
            if ($bin === false) {
                return true;
            }
            $b = unpack('C16', $bin);

            // unspecified (::) y loopback (::1)
            $allZero = true;
            for ($i = 1; $i <= 16; $i++) {
                if ($b[$i] !== 0) {
                    $allZero = false;
                    break;
                }
            }
            if ($allZero) {
                return true;
            }
            if ($b[1] === 0 && $b[2] === 0 && $b[3] === 0 && $b[4] === 0
                && $b[5] === 0 && $b[6] === 0 && $b[7] === 0 && $b[8] === 0
                && $b[9] === 0 && $b[10] === 0 && $b[11] === 0 && $b[12] === 0
                && $b[13] === 0 && $b[14] === 0 && $b[15] === 0 && $b[16] === 1) {
                return true;
            }
            // fc00::/7 (ULA)
            if (($b[1] & 0xfe) === 0xfc) {
                return true;
            }
            // fe80::/10 (link-local)
            if ($b[1] === 0xfe && ($b[2] & 0xc0) === 0x80) {
                return true;
            }
            // ff00::/8 (multicast)
            if ($b[1] === 0xff) {
                return true;
            }
            // 2001:db8::/32 (documentación)
            if ($b[1] === 0x20 && $b[2] === 0x01 && $b[3] === 0x0d && $b[4] === 0xb8) {
                return true;
            }

            $embedded = self::ipv4EmbeddedIn($b);
            if ($embedded !== null && self::isPrivateIpv4($embedded)) {
                return true;
            }

            return false;
        }

        return true; // no es una IP válida → tratar como no permitida
    }

    /**
     * Valida una URL para fetch servidor: esquema + credenciales + puerto + SSRF.
     *
     * @return array{scheme: string, host: string, port: int, path: string, ips: array<int, string>}
     */
    public static function assertSafeUrl(string $raw): array
    {
        $parts = parse_url($raw);
        if ($parts === false || ! isset($parts['scheme'])) {
            throw new \RuntimeException('URL inválida');
        }

        $scheme = strtolower((string) $parts['scheme']);
        if ($scheme !== 'http' && $scheme !== 'https') {
            throw new \RuntimeException('SSRF: esquema no permitido');
        }
        if (! isset($parts['host'])) {
            throw new \RuntimeException('URL inválida');
        }
        if (isset($parts['user']) || isset($parts['pass'])) {
            throw new \RuntimeException('SSRF: credenciales embebidas no permitidas');
        }

        $port = isset($parts['port']) ? (int) $parts['port'] : ($scheme === 'https' ? 443 : 80);
        if (! in_array($port, self::ALLOWED_PORTS, true)) {
            throw new \RuntimeException('SSRF: puerto no permitido');
        }

        $host = (string) $parts['host'];
        // parse_url devuelve los hosts IPv6 literales entre corchetes.
        if (str_starts_with($host, '[') && str_ends_with($host, ']')) {
            $host = substr($host, 1, -1);
        }
        $path = ($parts['path'] ?? '/').(isset($parts['query']) ? '?'.$parts['query'] : '');

        $ips = self::resolveAndValidateHost($host);

        return [
            'scheme' => $scheme,
            'host' => $host,
            'port' => $port,
            'path' => $path,
            'ips' => $ips,
        ];
    }

    /**
     * Fetch servidor endurecido para SSRF: sin redirecciones, fijación de IPs
     * validadas en connect-time y timeout duro.
     *
     * @param  array<int, string>  $headers  cabeceras crudas "Name: value"
     * @return array{status: int, ok: bool}
     */
    public static function safeFetch(string $url, array $headers, string $body, int $timeoutMs = 5000): array
    {
        $info = self::assertSafeUrl($url);

        $ch = curl_init();
        // Los literales IPv6 requieren corchetes en la URL.
        $urlHost = str_contains($info['host'], ':') ? '['.$info['host'].']' : $info['host'];
        $opts = [
            CURLOPT_URL => $info['scheme'].'://'.$urlHost.':'.$info['port'].$info['path'],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $body,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_CONNECTTIMEOUT => (int) ceil($timeoutMs / 1000),
            CURLOPT_TIMEOUT => (int) ceil($timeoutMs / 1000),
            CURLOPT_NOSIGNAL => true,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
        ];

        // Fijar las IPs ya validadas: curl no vuelve a resolver el host, con lo
        // que un atacante con DNS rebinding no puede cambiar el destino entre
        // la validación y la conexión.
        if ($info['ips'] !== []) {
            $resolve = [];
            foreach ($info['ips'] as $ip) {
                $addr = str_contains($ip, ':') ? '['.$ip.']' : $ip;
                $resolve[] = $info['host'].':'.$info['port'].':'.$addr;
            }
            $opts[CURLOPT_RESOLVE] = $resolve;
        }

        curl_setopt_array($ch, $opts);
        $out = curl_exec($ch);
        if ($out === false) {
            $err = curl_error($ch);
            curl_close($ch);

            throw new \RuntimeException('SSRF: '.($err !== '' ? $err : 'error de red'));
        }
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);
        if ($status <= 0) {
            throw new \RuntimeException('SSRF: sin respuesta HTTP');
        }

        return ['status' => $status, 'ok' => $status >= 200 && $status < 300];
    }

    /**
     * Resuelve todos los registros del host y rechaza si cualquiera es privado.
     *
     * @return array<int, string>
     */
    private static function resolveAndValidateHost(string $host): array
    {
        $host = rtrim($host, '.');
        if ($host === '') {
            throw new \RuntimeException('SSRF: host vacío');
        }

        // IP literal: validar directamente (no hay DNS que consultar).
        if (filter_var($host, FILTER_VALIDATE_IP) !== false) {
            if (self::isPrivateIp($host)) {
                throw new \RuntimeException('SSRF: destino interno bloqueado');
            }

            return [];
        }

        $records = @dns_get_record($host, DNS_A | DNS_AAAA);
        if ($records === false || $records === []) {
            throw new \RuntimeException('SSRF: no se pudo resolver el host');
        }

        $ips = [];
        foreach ($records as $record) {
            $ip = $record['ip'] ?? $record['ipv6'] ?? null;
            if (! is_string($ip) || $ip === '') {
                continue;
            }
            if (self::isPrivateIp($ip)) {
                throw new \RuntimeException('SSRF: destino interno bloqueado');
            }
            $ips[] = $ip;
        }
        if ($ips === []) {
            throw new \RuntimeException('SSRF: no se pudo resolver el host');
        }

        return array_values(array_unique($ips));
    }

    private static function isPrivateIpv4(int $n): bool
    {
        foreach (self::PRIVATE_IPV4_RANGES as [$lo, $hi]) {
            if ($n >= $lo && $n <= $hi) {
                return true;
            }
        }

        return false;
    }

    private static function ipv4ToInt(string $ip): int
    {
        $n = 0;
        foreach (explode('.', $ip) as $oct) {
            $n = (($n << 8) + (int) $oct) & 0xffffffff;
        }

        return $n;
    }

    /**
     * Extrae una IPv4 embebida de formas de transición IPv6 que enrutan a
     * espacio IPv4: mapped (::ffff:a.b.c.d), compatible (::a.b.c.d), NAT64
     * (64:ff9b::/96), 6to4 (2002::/16) y Teredo (2001::/32, bits de servidor
     * complementados). Un atacante controla el DNS de sus dominios y puede
     * servir AAAA en estas formas para evadir filtros IPv6 ingenuos.
     *
     * @param  array<int, int>  $b  bytes 1..16 (unpack('C16'))
     */
    private static function ipv4EmbeddedIn(array $b): ?int
    {
        $firstTenZero = true;
        for ($i = 1; $i <= 10; $i++) {
            if ($b[$i] !== 0) {
                $firstTenZero = false;
                break;
            }
        }
        if ($firstTenZero) {
            $v = ($b[11] << 8) | $b[12];
            if ($v === 0xffff || $v === 0x0000) {
                return self::ipv4FromBytes($b[13], $b[14], $b[15], $b[16]);
            }

            return null;
        }

        // NAT64 well-known prefix 64:ff9b::/96: grupos 0x0064 y 0xff9b, que
        // en bytes son 00 64 ff 9b (cada grupo IPv6 ocupa 2 bytes).
        if ($b[1] === 0x00 && $b[2] === 0x64 && $b[3] === 0xff && $b[4] === 0x9b
            && $b[5] === 0 && $b[6] === 0 && $b[7] === 0 && $b[8] === 0
            && $b[9] === 0 && $b[10] === 0 && $b[11] === 0 && $b[12] === 0) {
            return self::ipv4FromBytes($b[13], $b[14], $b[15], $b[16]);
        }

        // 6to4: 2002::/16
        if ($b[1] === 0x20 && $b[2] === 0x02) {
            return self::ipv4FromBytes($b[3], $b[4], $b[5], $b[6]);
        }

        // Teredo 2001:0000::/32 — la IPv4 del servidor es el complemento de los
        // últimos 32 bits.
        if ($b[1] === 0x20 && $b[2] === 0x01 && $b[3] === 0 && $b[4] === 0) {
            $n = self::ipv4FromBytes($b[13], $b[14], $b[15], $b[16]);

            return $n !== null ? ($n ^ 0xffffffff) : null;
        }

        return null;
    }

    private static function ipv4FromBytes(int $a, int $b, int $c, int $d): ?int
    {
        if ($a > 255 || $b > 255 || $c > 255 || $d > 255) {
            return null;
        }

        return (($a << 24) | ($b << 16) | ($c << 8) | $d) & 0xffffffff;
    }
}
