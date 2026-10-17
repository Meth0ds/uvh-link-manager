<?php

namespace App\Http\Controllers;

use Symfony\Component\HttpFoundation\BinaryFileResponse;

final class VisitorAssetController
{
    public function show(string $file): BinaryFileResponse
    {
        $types = [
            'puzzle-core.v1.mjs' => 'text/javascript',
            'puzzle.v1.mjs' => 'text/javascript',
            'bootstrap.v1.mjs' => 'text/javascript',
            'not-found.v1.css' => 'text/css',
            'puzzle-static.v1.svg' => 'image/svg+xml',
            'manrope-400.woff2' => 'font/woff2',
            'manrope-600.woff2' => 'font/woff2',
            'manrope-800.woff2' => 'font/woff2',
        ];
        abort_unless(isset($types[$file]), 404);
        $directory = resource_path('visitor-assets');
        // Development mounts the shared source; production packages the same files.
        if (app()->environment(['local', 'testing']) && ! is_dir($directory)) {
            $directory = (string) config('uvh.visitor_asset_source');
        }
        $path = str_starts_with($file, 'manrope-')
            ? resource_path('fonts/app-links/'.$file)
            : $directory.'/'.$file;
        abort_unless(is_file($path), 404);

        return response()->file($path, ['Content-Type' => $types[$file], 'X-Content-Type-Options' => 'nosniff']);
    }
}
