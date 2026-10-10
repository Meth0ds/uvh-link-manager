<?php

return [
    'designs_per_workspace' => max(1, (int) env('QR_DESIGNS_PER_WORKSPACE', 50)),
    'asset_bytes_per_workspace' => max(2 * 1024 * 1024, (int) env('QR_ASSET_BYTES_PER_WORKSPACE', 64 * 1024 * 1024)),
    'variants_per_link' => max(1, min(100, (int) env('QR_VARIANTS_PER_LINK', 100))),
];
