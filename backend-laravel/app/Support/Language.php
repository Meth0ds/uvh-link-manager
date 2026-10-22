<?php

namespace App\Support;

use Illuminate\Http\Request;

/** Presentation locale only. Redirect-rule languages continue to use the visitor context. */
final class Language
{
    public const SUPPORTED = ['es', 'en', 'fr'];

    /**
     * Languages whose copy is published. French stays behind its flag until the
     * authored catalogue, mail and legal evidence are ready; enabling it never
     * changes how Spanish or English negotiate.
     *
     * @return list<string>
     */
    public static function enabled(): array
    {
        return (bool) config('uvh.french_enabled', false) ? self::SUPPORTED : ['es', 'en'];
    }

    public static function valid(mixed $value): bool
    {
        return is_string($value) && in_array($value, self::SUPPORTED, true);
    }

    public static function available(mixed $value): bool
    {
        return is_string($value) && in_array($value, self::enabled(), true);
    }

    /**
     * @param  list<string>  $supported
     */
    public static function negotiate(?string $header, array $supported = self::SUPPORTED): string
    {
        $candidates = [];
        foreach (explode(',', substr($header ?? '', 0, 4096)) as $index => $part) {
            if (! preg_match('/^\s*([a-z]{2,3})(?:-[a-z0-9-]{1,8})?\s*(?:;\s*q=(0(?:\.\d{1,3})?|1(?:\.0{1,3})?))?\s*$/iD', $part, $match)) {
                continue;
            }
            $language = strtolower($match[1]);
            $quality = isset($match[2]) ? (float) $match[2] : 1.0;
            if ($quality > 0 && in_array($language, $supported, true)) {
                $candidates[] = ['language' => $language, 'quality' => $quality, 'order' => $index];
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
        if ($allowPrefix && self::available($segment)) {
            return $segment;
        }
        $cookie = $request->cookie('uvh_language');

        return self::available($cookie) ? $cookie : self::negotiate($request->header('Accept-Language'), self::enabled());
    }

    public static function locale(string $language): string
    {
        return match ($language) {
            'en' => 'en_GB',
            // The Laravel catalogue is stored under lang/fr. Keep the
            // presentation locale aligned with that directory; the BCP-47
            // response tag remains fr-FR via tag().
            'fr' => 'fr',
            default => 'es',
        };
    }

    /** BCP-47 tag for HTML, mail and Content-Language headers. */
    public static function tag(string $language): string
    {
        return match ($language) {
            'en' => 'en-GB',
            'fr' => 'fr-FR',
            default => 'es-ES',
        };
    }

    public static function current(): string
    {
        return match (app()->getLocale()) {
            'en_GB', 'en' => 'en',
            'fr' => 'fr',
            default => 'es',
        };
    }

    public static function reservesPublicAlias(string $alias, mixed $domainId): bool
    {
        return config('uvh.localisation_enabled') && $domainId === null
            && in_array(strtolower($alias), self::enabled(), true);
    }

    /** @return array<string, array<string, string>> */
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
        $prefix = '#^/(?:'.implode('|', array_map('preg_quote', self::SUPPORTED)).')(?=/|$)#';
        $stripped = preg_replace($prefix, '', $parts[1]) ?: '/';
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
