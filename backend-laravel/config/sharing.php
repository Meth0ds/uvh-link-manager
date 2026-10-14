<?php

return [
    'reports' => filter_var(env('UVH_FEATURE_SHARED_REPORTS', false), FILTER_VALIDATE_BOOLEAN),
    'social_previews' => filter_var(env('UVH_FEATURE_SOCIAL_PREVIEWS', false), FILTER_VALIDATE_BOOLEAN),
    'max_reports' => max(1, min(500, (int) env('SHARED_REPORTS_LIMIT', 50))),
    'asset_bytes' => max(2 * 1024 * 1024, (int) env('SOCIAL_PREVIEW_ASSET_BYTES_PER_WORKSPACE', 64 * 1024 * 1024)),
];
