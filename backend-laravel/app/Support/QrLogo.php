<?php

namespace App\Support;

use App\Exceptions\LinkException;
use Illuminate\Http\UploadedFile;

final class QrLogo
{
    /** @return array{png: string, width: int, height: int, inputHash: string} */
    public static function normalize(UploadedFile $file): array
    {
        if (! $file->isValid() || $file->getSize() > 2 * 1024 * 1024 || $file->getSize() < 12) {
            throw new LinkException(__('messages.error_fe7ec48b82e539'), 422);
        }
        $bytes = file_get_contents($file->getPathname());
        if ($bytes === false) {
            throw new LinkException(__('messages.error_b042045c337987'), 422);
        }
        $png = str_starts_with($bytes, "\x89PNG\r\n\x1a\n");
        $jpeg = str_starts_with($bytes, "\xff\xd8\xff");
        $size = @getimagesizefromstring($bytes);
        if ((! $png && ! $jpeg) || ! $size || ! in_array($size[2], [IMAGETYPE_PNG, IMAGETYPE_JPEG], true)
            || ($png && $size[2] !== IMAGETYPE_PNG) || ($jpeg && $size[2] !== IMAGETYPE_JPEG)
            || $size[0] < 1 || $size[1] < 1 || $size[0] > 4096 || $size[1] > 4096) {
            throw new LinkException(__('messages.error_d17ec1c95af37a'), 422);
        }
        $source = @imagecreatefromstring($bytes);
        if (! $source) {
            throw new LinkException(__('messages.error_e6d7f131c7704b'), 422);
        }
        $target = null;
        try {
            if (imagesx($source) !== $size[0] || imagesy($source) !== $size[1]) {
                throw new LinkException(__('messages.error_7ad9eed96df05e'), 422);
            }
            if ($jpeg) {
                $orientation = self::orientation($bytes);
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
                        throw new LinkException(__('messages.error_7fb072d0b9d34d'), 422);
                    }
                    imagedestroy($source);
                    $source = $rotated;
                }
            }
            $scale = min(1, 1024 / max(imagesx($source), imagesy($source)));
            $width = max(1, (int) round(imagesx($source) * $scale));
            $height = max(1, (int) round(imagesy($source) * $scale));
            $target = imagecreatetruecolor($width, $height);
            imagealphablending($target, false);
            imagesavealpha($target, true);
            imagefill($target, 0, 0, imagecolorallocatealpha($target, 0, 0, 0, 127));
            if (! imagecopyresampled($target, $source, 0, 0, 0, 0, $width, $height, imagesx($source), imagesy($source))) {
                throw new LinkException(__('messages.error_c26c81c6359a34'), 422);
            }
            $left = $width;
            $right = -1;
            $top = $height;
            $bottom = -1;
            for ($y = 0; $y < $height; $y++) {
                for ($x = 0; $x < $width; $x++) {
                    if (((imagecolorat($target, $x, $y) >> 24) & 127) < 127) {
                        $left = min($left, $x);
                        $right = max($right, $x);
                        $top = min($top, $y);
                        $bottom = max($bottom, $y);
                    }
                }
            }
            if ($right < $left) {
                throw new LinkException(__('messages.error_9be64112fb6660'), 422);
            }
            if ($left !== 0 || $top !== 0 || $right !== $width - 1 || $bottom !== $height - 1) {
                $cropped = imagecrop($target, ['x' => $left, 'y' => $top, 'width' => $right - $left + 1, 'height' => $bottom - $top + 1]);
                if (! $cropped) {
                    throw new LinkException(__('messages.error_9ae33c26ec7de3'), 422);
                }
                imagedestroy($target);
                $target = $cropped;
                imagesavealpha($target, true);
                $width = imagesx($target);
                $height = imagesy($target);
            }
            ob_start();
            try {
                if (! imagepng($target, null, 6)) {
                    throw new LinkException(__('messages.error_f5ffaffdc2e71d'), 422);
                }
                $normalized = ob_get_contents();
            } finally {
                ob_end_clean();
            }
            if (! is_string($normalized) || $normalized === '') {
                throw new LinkException(__('messages.error_f5ffaffdc2e71d'), 422);
            }

            return ['png' => $normalized, 'width' => $width, 'height' => $height, 'inputHash' => hash('sha256', $bytes)];
        } finally {
            imagedestroy($source);
            if ($target !== null) {
                imagedestroy($target);
            }
        }
    }

    public static function orientation(string $bytes): int
    {
        $length = strlen($bytes);
        $offset = 2;
        while ($offset + 4 <= $length) {
            if (ord($bytes[$offset++]) !== 255) {
                break;
            }
            while ($offset < $length && ord($bytes[$offset]) === 255) {
                $offset++;
            }
            if ($offset + 3 > $length) {
                break;
            }
            $marker = ord($bytes[$offset++]);
            if ($marker === 0xDA || $marker === 0xD9) {
                break;
            }
            $segmentLength = (ord($bytes[$offset]) << 8) | ord($bytes[$offset + 1]);
            if ($segmentLength < 2 || $offset + $segmentLength > $length) {
                break;
            }
            if ($marker === 0xE1 && $segmentLength >= 16 && substr($bytes, $offset + 2, 6) === "Exif\0\0") {
                $tiff = substr($bytes, $offset + 8, $segmentLength - 8);
                if (strlen($tiff) < 8 || ! in_array(substr($tiff, 0, 2), ['II', 'MM'], true)) {
                    return 1;
                }
                $little = str_starts_with($tiff, 'II');
                $read = static function (int $position, int $size) use ($tiff, $little): ?int {
                    if ($position < 0 || $position + $size > strlen($tiff)) {
                        return null;
                    }
                    $format = $size === 2 ? ($little ? 'v' : 'n') : ($little ? 'V' : 'N');
                    $value = unpack($format.'value', substr($tiff, $position, $size));

                    return $value === false ? null : $value['value'];
                };
                if ($read(2, 2) !== 42) {
                    return 1;
                }
                $directory = $read(4, 4);
                if ($directory === null) {
                    return 1;
                }
                $count = $read($directory, 2);
                if ($count === null || $count > 64) {
                    return 1;
                }
                for ($i = 0; $i < $count; $i++) {
                    $entry = $directory + 2 + 12 * $i;
                    if ($read($entry, 2) === 0x112 && $read($entry + 2, 2) === 3 && $read($entry + 4, 4) === 1) {
                        $orientation = $read($entry + 8, 2);

                        return $orientation !== null && $orientation >= 1 && $orientation <= 8 ? $orientation : 1;
                    }
                }

                return 1;
            }
            $offset += $segmentLength;
        }

        return 1;
    }
}
