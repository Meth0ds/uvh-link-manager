<?php

namespace App\Support;

use Closure;
use Illuminate\Support\Facades\DB;

/** Locale applies only while rendering. The encrypted outbox keeps the result. */
final class MailLanguage
{
    /** @param Closure(): bool $render */
    public static function render(string $to, Closure $render, ?string $language = null): bool
    {
        if ($language !== null && ! Language::valid($language)) {
            throw new \InvalidArgumentException('Unsupported mail language');
        }
        if (! config('uvh.localisation_enabled')) {
            $language = 'es';
        } elseif ($language === null) {
            $recipient = DB::table('users')->whereRaw('lower(email) = ?', [strtolower($to)])->first(['language']);
            $recipient ??= DB::table('pending_registrations')->whereRaw('lower(email) = ?', [strtolower($to)])->first(['language']);
            $language = $recipient !== null
                ? (Language::valid($recipient->language) ? $recipient->language : 'es')
                : Language::current();
        }
        $previous = app()->getLocale();
        app()->setLocale(Language::locale($language));
        try {
            return $render();
        } finally {
            // Workers may render messages for several recipients in one process.
            app()->setLocale($previous);
        }
    }
}
