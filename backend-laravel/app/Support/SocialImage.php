<?php

namespace App\Support;

use App\Exceptions\LinkException;
use Illuminate\Http\UploadedFile;

final class SocialImage
{
    /** @return array{jpeg: string, inputHash: string} */
    public static function normalize(UploadedFile $file, mixed $crop): array
    {
        if (! $file->isValid() || $file->getSize() > 2 * 1024 * 1024 || $file->getSize() < 12) {
            throw new LinkException('Elige un PNG o JPG de hasta 2 MB.', 422);
        }
        $bytes = file_get_contents($file->getPathname());
        $size = is_string($bytes) ? @getimagesizefromstring($bytes) : false;
        $jpeg = is_string($bytes) && str_starts_with($bytes, "\xff\xd8\xff");
        $png = is_string($bytes) && str_starts_with($bytes, "\x89PNG\r\n\x1a\n");
        if (! $size || (! $jpeg && ! $png) || ($jpeg && $size[2] !== IMAGETYPE_JPEG) || ($png && $size[2] !== IMAGETYPE_PNG) || $size[0] < 1 || $size[1] < 1 || $size[0] > 4096 || $size[1] > 4096) {
            throw new LinkException('La imagen debe ser un PNG/JPEG real, de hasta 4096 px por lado.', 422);
        }
        $limit = trim((string) ini_get('memory_limit'));
        if (preg_match('/^([0-9]+)([KMG]?)$/i', $limit, $matches)) {
            $factor = match (strtoupper($matches[2])) {
                'K' => 1024, 'M' => 1024 * 1024, 'G' => 1024 * 1024 * 1024, default => 1
            };
            // Source + rotated source, output and decoder/headroom; refuse before allocation.
            $required = $size[0] * $size[1] * 8 + 16 * 1024 * 1024;
            if ($required > (int) $matches[1] * $factor - memory_get_usage(true)) {
                throw new LinkException('La imagen necesita demasiado espacio para procesarla. Reduce sus dimensiones.', 422);
            }
        }
        $source = @imagecreatefromstring($bytes);
        if (! $source) {
            throw new LinkException('No se pudo decodificar la imagen.', 422);
        }
        $target = null;
        try {
            if ($jpeg) {
                $orientation = QrLogo::orientation($bytes);
                if (in_array($orientation, [2, 5, 7], true)) {
                    imageflip($source, IMG_FLIP_HORIZONTAL);
                }
                if ($orientation === 4) {
                    imageflip($source, IMG_FLIP_VERTICAL);
                }
                $angle = match ($orientation) {
                    3 => 180, 5, 8 => 90, 6, 7 => -90, default => 0
                };
                if ($angle !== 0) {
                    $rotated = imagerotate($source, $angle, 0);
                    if (! $rotated) {
                        throw new LinkException('No se pudo orientar la imagen.', 422);
                    }
                    imagedestroy($source);
                    $source = $rotated;
                }
            }
            $w = imagesx($source);
            $h = imagesy($source);
            if ($crop === null) {
                $cw = min($w, (int) floor($h * 1200 / 630));
                $ch = min($h, (int) floor($w * 630 / 1200));
                $crop = ['x' => (int) floor(($w - $cw) / 2), 'y' => (int) floor(($h - $ch) / 2), 'width' => $cw, 'height' => $ch];
            }
            if (! is_array($crop) || array_diff(array_keys($crop), ['x', 'y', 'width', 'height']) || count($crop) !== 4) {
                throw new LinkException('Recorte inválido.', 422);
            }
            foreach ($crop as $n) {
                if (! is_int($n)) {
                    throw new LinkException('Recorte inválido.', 422);
                }
            }
            if ($crop['x'] < 0 || $crop['y'] < 0 || $crop['width'] < 1 || $crop['height'] < 1 || $w < $crop['x'] + $crop['width'] || $h < $crop['y'] + $crop['height'] || abs($crop['width'] / $crop['height'] - 1200 / 630) > 0.03) {
                throw new LinkException('El recorte debe estar dentro de la imagen y respetar el formato horizontal.', 422);
            }
            $target = imagecreatetruecolor(1200, 630);
            imagefill($target, 0, 0, imagecolorallocate($target, 255, 255, 255));
            if (! imagecopyresampled($target, $source, 0, 0, $crop['x'], $crop['y'], 1200, 630, $crop['width'], $crop['height'])) {
                throw new LinkException('No se pudo ajustar la imagen.', 422);
            }
            ob_start();
            try {
                if (! imagejpeg($target, null, 88)) {
                    throw new LinkException('No se pudo normalizar la imagen.', 422);
                } $output = ob_get_contents();
            } finally {
                ob_end_clean();
            }
            if (! is_string($output) || strlen($output) > 2 * 1024 * 1024) {
                throw new LinkException('La imagen normalizada supera el límite.', 422);
            }

            return ['jpeg' => $output, 'inputHash' => hash('sha256', $bytes.json_encode($crop, JSON_THROW_ON_ERROR))];
        } finally {
            imagedestroy($source);
            if ($target) {
                imagedestroy($target);
            }
        }
    }
}
