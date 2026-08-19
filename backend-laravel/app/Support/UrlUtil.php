<?php

namespace App\Support;

class UrlUtil
{
    public const RESERVED_ALIASES = [
        'app', 'api', 'admin', 'login', 'registro', 'register', 'soporte', 'support',
        'security', 'privacy', 'terms', 'denunciar', 'report', 'robots.txt',
        'sitemap.xml', 'favicon.ico', 'health', 'legal', 'auth', 'settings',
    ];

    /**
     * Validate a destination URL: absolute http/https only, no embedded
     * credentials, no control characters, valid host.
     *
     * @return array{ok: bool, error?: string}
     */
    public static function validateDestination(string $raw): array
    {
        if ($raw === '' || strlen($raw) > 2048) {
            return ['ok' => false, 'error' => 'URL inválida'];
        }
        if (preg_match('/[\x00-\x1f\x7f]/', $raw)) {
            return ['ok' => false, 'error' => 'La URL contiene caracteres de control'];
        }

        $parts = parse_url($raw);
        if ($parts === false || ! isset($parts['scheme']) || ! isset($parts['host'])) {
            return ['ok' => false, 'error' => 'La URL no es válida'];
        }

        $scheme = strtolower((string) $parts['scheme']);
        if ($scheme !== 'http' && $scheme !== 'https') {
            return ['ok' => false, 'error' => 'Solo se permiten URLs http/https'];
        }
        if (isset($parts['user']) || isset($parts['pass'])) {
            return ['ok' => false, 'error' => 'Las URLs no pueden incluir credenciales'];
        }

        $host = (string) $parts['host'];
        if ($host === '') {
            return ['ok' => false, 'error' => 'Host inválido'];
        }
        if (preg_match('/[\s\x00-\x1f]/', $host)) {
            return ['ok' => false, 'error' => 'Host inválido'];
        }
        if (! str_contains($host, '.') && strtolower($host) !== 'localhost') {
            return ['ok' => false, 'error' => 'Host inválido'];
        }

        return ['ok' => true];
    }

    public static function normalizeAlias(string $raw): string
    {
        return strtolower(trim($raw, " \t\n\r\0\x0B/"));
    }

    public static function isReservedAlias(string $alias): bool
    {
        return in_array($alias, self::RESERVED_ALIASES, true);
    }

    public static function isValidCustomAlias(string $alias): bool
    {
        return (bool) preg_match('/^[a-z0-9][a-z0-9_-]{0,63}$/i', $alias);
    }
}
