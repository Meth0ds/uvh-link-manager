<?php

namespace App\Support;

use App\Exceptions\LinkException;
use App\Models\Link;

final class ExpiredLinkPage
{
    public static function validate(mixed $spec): void
    {
        if ($spec === null) {
            return;
        }
        if (! is_array($spec) || array_diff(array_keys($spec), ['version', 'enabled', 'expired', 'exhausted']) !== []
            || ($spec['version'] ?? null) !== 1 || ! is_bool($spec['enabled'] ?? null)) {
            throw new LinkException(__('messages.error_d9334138357a76'), 422);
        }
        foreach (['expired', 'exhausted'] as $kind) {
            $copy = $spec[$kind] ?? null;
            if (! is_array($copy) || array_diff(array_keys($copy), ['title', 'message', 'buttonLabel', 'buttonUrl']) !== []) {
                throw new LinkException(__('messages.error_a3800a79c4b6d1'), 422);
            }
            foreach (['title' => 80, 'message' => 500, 'buttonLabel' => 40] as $field => $limit) {
                $value = $copy[$field] ?? ($field === 'buttonLabel' ? '' : null);
                if (! is_string($value) || ! mb_check_encoding($value, 'UTF-8') || mb_strlen($value) > $limit
                    || ($field !== 'buttonLabel' && trim($value) === '')
                    || preg_match($field === 'message' ? '/[\p{Cf}<>\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u' : '/[\p{Cc}\p{Cf}<>]/u', $value)) {
                    throw new LinkException(__('messages.error_ddcf9ca9445f1f'), 422);
                }
            }
            $url = $copy['buttonUrl'] ?? null;
            $label = trim($copy['buttonLabel'] ?? '');
            if (($url === null || $url === '') && $label === '') {
                continue;
            }
            if (! is_string($url) || $url === '' || $label === '' || ! UrlUtil::validateDestination($url)['ok']
                || DestinationDenylist::reason($url) !== null) {
                throw new LinkException(__('messages.error_347a0a73022431'), 422);
            }
        }
    }

    /** @return array<string, mixed>|null */
    public static function canonical(mixed $spec): ?array
    {
        if (! is_array($spec)) {
            return null;
        }
        foreach (['expired', 'exhausted'] as $kind) {
            if (! is_array($spec[$kind] ?? null)) {
                continue;
            }
            $label = $spec[$kind]['buttonLabel'] ?? '';
            $spec[$kind]['buttonLabel'] = is_string($label) ? trim($label) : $label;
            $spec[$kind]['buttonUrl'] = ($spec[$kind]['buttonUrl'] ?? null) ?: null;
        }

        return $spec;
    }

    /** @param array<string, mixed> $outcome
     * @return array<string, mixed>
     */
    public static function decorate(array $outcome, Link $link, string $kind): array
    {
        $copy = self::for($link, $kind);
        if ($copy !== null) {
            $outcome['page'] = $copy;
        }

        return $outcome;
    }

    /** @return array<string, mixed>|null */
    public static function for(Link $link, string $kind): ?array
    {
        if (! config('workflows.enabled')) {
            return null;
        }
        $spec = $link->expired_page;
        try {
            $spec = self::canonical($spec);
            self::validate($spec);
        } catch (LinkException) {
            // Moderation may change after saving: suppress unsafe customization.
            return null;
        }
        if (! is_array($spec) || ! ($spec['enabled'] ?? false)) {
            return null;
        }

        $copy = $spec[$kind] ?? null;
        $url = $copy['buttonUrl'] ?? null;
        if (is_string($url) && $url !== '') {
            $key = DestinationDenylist::key($url);
            if ($key !== null && DestinationReputationService::cached($key['url_hash'])?->verdict() === ReputationVerdict::MALICIOUS) {
                $copy['buttonUrl'] = null;
                $copy['buttonLabel'] = '';
            }
        }

        return $copy;
    }
}
