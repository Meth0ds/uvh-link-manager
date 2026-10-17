<?php

namespace App\Support;

/** Stable message identifiers for clients: presentation language never identifies an operation. */
final class ApiErrorCode
{
    public static function forMessage(string $message): ?string
    {
        // Catalogues contain authored system messages only, never owner content.
        // This bounded reverse lookup is request-local, so long-lived workers
        // cannot reuse another request's locale or mutable translation state.
        foreach (['messages', 'visitor', 'display'] as $catalogue) {
            $entries = trans($catalogue, [], 'es');
            if (! is_array($entries)) {
                continue;
            }
            foreach ($entries as $key => $text) {
                if (is_string($text) && ($text === $message || trans($catalogue.'.'.$key, [], 'en_GB') === $message)) {
                    return $catalogue.'.'.$key;
                }
            }
        }

        return null;
    }

    public static function translate(string $message): string
    {
        $code = self::forMessage($message);

        return $code !== null ? __($code) : $message;
    }
}
