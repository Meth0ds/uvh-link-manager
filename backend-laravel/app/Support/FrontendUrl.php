<?php

namespace App\Support;

final class FrontendUrl
{
    public static function base(): string
    {
        // APP_URL remains the Laravel origin in local Docker. The SPA has a
        // separate port there; production can keep the existing single origin.
        return rtrim((string) (config('uvh.frontend_url') ?: config('app.url')), '/');
    }
}
