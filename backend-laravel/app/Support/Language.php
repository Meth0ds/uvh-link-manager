<?php

namespace App\Support;

use Illuminate\Http\Request;

/** Presentation locale only. Redirect-rule languages continue to use the visitor context. */
final class Language
{
    public const SUPPORTED = ['es', 'en'];

    public static function valid(mixed $value): bool
    {
        return is_string($value) && in_array($value, self::SUPPORTED, true);
    }

    public static function negotiate(?string $header): string
    {
        $candidates = [];
        foreach (explode(',', substr($header ?? '', 0, 4096)) as $index => $part) {
            if (! preg_match('/^\s*(es|en)(?:-[a-z0-9-]+)?\s*(?:;\s*q=(0(?:\.\d{1,3})?|1(?:\.0{1,3})?))?\s*$/iD', $part, $match)) {
                continue;
            }
            $quality = isset($match[2]) ? (float) $match[2] : 1.0;
            if ($quality > 0) {
                $candidates[] = ['language' => strtolower($match[1]), 'quality' => $quality, 'order' => $index];
            }
        }
        usort($candidates, fn ($a, $b) => ($b['quality'] <=> $a['quality']) ?: ($a['order'] <=> $b['order']));

        return $candidates[0]['language'] ?? 'es';
    }

    public static function isFirstPartyHost(string $host): bool
    {
        $host = strtolower(rtrim($host, '.'));
        foreach (['public_host', 'app_host'] as $key) {
            $configured = strtolower(rtrim((string) config('uvh.'.$key), '.'));
            if ($configured !== '' && in_array($host, [$configured, 'www.'.$configured], true)) {
                return true;
            }
        }

        return app()->environment(['local', 'testing']) && in_array($host, ['localhost', '127.0.0.1', '::1', '[::1]'], true);
    }

    public static function fromRequest(Request $request, bool $allowPrefix = true): string
    {
        $segment = $request->segment(1);
        if ($allowPrefix && self::valid($segment)) {
            return $segment;
        }
        $cookie = $request->cookie('uvh_language');

        return self::valid($cookie) ? $cookie : self::negotiate($request->header('Accept-Language'));
    }

    public static function locale(string $language): string
    {
        return $language === 'en' ? 'en_GB' : 'es';
    }

    public static function current(): string
    {
        return app()->getLocale() === 'en_GB' ? 'en' : 'es';
    }

    public static function reservesPublicAlias(string $alias, mixed $domainId): bool
    {
        return config('uvh.localisation_enabled') && $domainId === null
            && in_array(strtolower($alias), self::SUPPORTED, true);
    }

    /** @return array<string, array{es: string, en: string}> */
    public static function routes(): array
    {
        $path = resource_path('localisation/routes.json');
        if (! is_file($path) && app()->environment(['local', 'testing'])) {
            $path = rtrim((string) config('uvh.repository_root'), '/').'/shared/localisation/routes.json';
        }

        return json_decode(file_get_contents($path), true, 32, JSON_THROW_ON_ERROR);
    }

    public static function path(string $path, ?string $language = null): string
    {
        $language = self::valid($language) ? $language : self::current();
        preg_match('/^([^?#]*)([?#].*)?$/sD', $path, $parts);
        $stripped = preg_replace('#^/(es|en)(?=/|$)#', '', $parts[1]) ?: '/';
        $suffix = $parts[2] ?? '';
        $aliases = ['/help' => 'help', '/status' => 'status', '/legal' => 'terms'];
        foreach (self::routes() as $id => $translations) {
            if (in_array(rtrim($stripped, '/') ?: '/', $translations, true) || ($aliases[$stripped] ?? null) === $id) {
                return '/'.$language.$translations[$language].$suffix;
            }
        }

        return '/'.$language.$stripped.$suffix;
    }
}
