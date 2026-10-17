<?php

namespace App\Support;

use App\Exceptions\LinkException;

final class QrDesign
{
    /** @return array<string, mixed> */
    public static function validate(mixed $input, bool $persisted = true): array
    {
        $keys = ['version', 'foreground', 'background', 'correction', 'quietZone', 'logo', 'frame', 'caption'];
        if (! is_array($input) || array_is_list($input) || array_diff(array_keys($input), $keys) || array_diff($keys, array_keys($input)) || $input['version'] !== 1) {
            throw new LinkException(__('messages.error_f1e4a1b80194c9'), 422);
        }
        foreach (['foreground', 'background'] as $key) {
            if (! is_string($input[$key]) || ! preg_match('/^#[a-f0-9]{6}$/iD', $input[$key])) {
                throw new LinkException(__('messages.error_7fbea1ec7cc881'), 422);
            }
            $input[$key] = strtoupper($input[$key]);
        }
        $light = self::luminance($input['background']);
        if ($light < 0.8 || ($light + 0.05) / (self::luminance($input['foreground']) + 0.05) < 7) {
            throw new LinkException(__('messages.error_035564f65403e0'), 422);
        }
        if (! in_array($input['correction'], ['L', 'M', 'Q', 'H'], true) || ! in_array($input['quietZone'], [4, 6, 8], true) || ! in_array($input['frame'], ['none', 'border', 'caption'], true)) {
            throw new LinkException(__('messages.error_7032168b09d21a'), 422);
        }
        $caption = $input['caption'] ?? ''; // Laravel converts empty strings to null at the request boundary.
        if (! is_string($caption) || ! mb_check_encoding($caption, 'UTF-8') || mb_strlen($caption) > 80 || preg_match('/[<>\p{Cc}\p{Cf}]/u', $caption)) {
            throw new LinkException(__('messages.error_d122399fcd6390'), 422);
        }
        $logo = $input['logo'];
        if (! is_array($logo) || ! in_array($logo['kind'] ?? null, ['none', 'uvh', 'custom'], true)) {
            throw new LinkException(__('messages.error_936cd8003d644e'), 422);
        }
        $logoKeys = $logo['kind'] === 'custom' ? ['kind', 'assetId'] : ['kind'];
        if (array_diff(array_keys($logo), $logoKeys) || array_diff($logoKeys, array_keys($logo))) {
            throw new LinkException(__('messages.error_936cd8003d644e'), 422);
        }
        if ($logo['kind'] === 'custom' && (! is_int($logo['assetId']) || $logo['assetId'] < 1) && ($persisted || $logo['assetId'] !== null)) {
            throw new LinkException(__('messages.error_ed9a64779633de'), 422);
        }
        if ($logo['kind'] !== 'none') {
            $input['correction'] = 'H';
        }
        $input['caption'] = trim($caption);

        // Stable field order makes equivalent JSON requests share a hash.
        $canonical = [];
        foreach ($keys as $key) {
            $canonical[$key] = $input[$key];
        }
        $canonical['logo'] = $logo['kind'] === 'custom' ? ['kind' => 'custom', 'assetId' => $logo['assetId']] : ['kind' => $logo['kind']];

        return $canonical;
    }

    public static function name(mixed $value): string
    {
        if (! is_string($value) || ! mb_check_encoding($value, 'UTF-8') || mb_strlen(trim($value)) < 1 || mb_strlen($value) > 80 || preg_match('/[<>\p{Cc}\p{Cf}]/u', $value)) {
            throw new LinkException(__('messages.error_eb3d9337cb03aa'), 422);
        }

        return trim($value);
    }

    public static function requestKey(mixed $key): string
    {
        if (! is_string($key) || ! preg_match('/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iD', $key)) {
            throw new LinkException(__('messages.error_eebab88d7cdde0'), 422);
        }

        return strtolower($key);
    }

    private static function luminance(string $hex): float
    {
        $values = [];
        foreach ([1, 3, 5] as $offset) {
            $channel = hexdec(substr($hex, $offset, 2)) / 255;
            $values[] = $channel <= 0.04045 ? $channel / 12.92 : (($channel + 0.055) / 1.055) ** 2.4;
        }

        return $values[0] * 0.2126 + $values[1] * 0.7152 + $values[2] * 0.0722;
    }
}
