<?php

namespace App\Support;

final class FrontendUrl
{
    public static function localiseExistingPage(string $url): string
    {
        $base = self::base();
        if (! config('uvh.localisation_enabled') || ! str_starts_with($url, $base.'/')) {
            return $url;
        }
        $path = substr($url, strlen($base));
        if (! preg_match('#^/(?:es/|en/)?(?:auth/|app/|reports/|invitations/|help(?:[/?\#]|$))#', $path)) {
            return $url;
        }

        return self::page($path);
    }

    public static function page(string $path, ?string $language = null): string
    {
        return self::base().(config('uvh.localisation_enabled') ? Language::path($path, $language) : $path);
    }

    public static function base(): string
    {
        // APP_URL remains the Laravel origin in local Docker. The SPA has a
        // separate port there; production can keep the existing single origin.
        return rtrim((string) (config('uvh.frontend_url') ?: config('app.url')), '/');
    }
}
