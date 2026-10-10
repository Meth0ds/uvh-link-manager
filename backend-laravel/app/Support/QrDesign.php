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
            throw new LinkException('Diseño QR inválido o versión no compatible.', 422);
        }
        foreach (['foreground', 'background'] as $key) {
            if (! is_string($input[$key]) || ! preg_match('/^#[a-f0-9]{6}$/iD', $input[$key])) {
                throw new LinkException('Usa colores sólidos sin transparencia.', 422);
            }
            $input[$key] = strtoupper($input[$key]);
        }
        $light = self::luminance($input['background']);
        if ($light < 0.8 || ($light + 0.05) / (self::luminance($input['foreground']) + 0.05) < 7) {
            throw new LinkException('El QR necesita módulos oscuros, fondo claro y contraste mínimo de 7:1.', 422);
        }
        if (! in_array($input['correction'], ['L', 'M', 'Q', 'H'], true) || ! in_array($input['quietZone'], [4, 6, 8], true) || ! in_array($input['frame'], ['none', 'border', 'caption'], true)) {
            throw new LinkException('Redundancia, margen o marco inválidos.', 422);
        }
        $caption = $input['caption'] ?? ''; // Laravel converts empty strings to null at the request boundary.
        if (! is_string($caption) || ! mb_check_encoding($caption, 'UTF-8') || mb_strlen($caption) > 80 || preg_match('/[<>\p{Cc}\p{Cf}]/u', $caption)) {
            throw new LinkException('El texto admite 80 caracteres, sin HTML ni caracteres de control.', 422);
        }
        $logo = $input['logo'];
        if (! is_array($logo) || ! in_array($logo['kind'] ?? null, ['none', 'uvh', 'custom'], true)) {
            throw new LinkException('Logo inválido.', 422);
        }
        $logoKeys = $logo['kind'] === 'custom' ? ['kind', 'assetId'] : ['kind'];
        if (array_diff(array_keys($logo), $logoKeys) || array_diff($logoKeys, array_keys($logo))) {
            throw new LinkException('Logo inválido.', 422);
        }
        if ($logo['kind'] === 'custom' && (! is_int($logo['assetId']) || $logo['assetId'] < 1) && ($persisted || $logo['assetId'] !== null)) {
            throw new LinkException('Guarda primero un logo privado válido.', 422);
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
            throw new LinkException('Introduce un nombre de 1 a 80 caracteres, sin HTML ni caracteres de control.', 422);
        }

        return trim($value);
    }

    public static function requestKey(mixed $key): string
    {
        if (! is_string($key) || ! preg_match('/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iD', $key)) {
            throw new LinkException('La creación requiere una clave de idempotencia UUID.', 422);
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
