<?php

return [
    'timeout_ms' => min(8000, max(500, (int) env('DESTINATION_INSPECTION_TIMEOUT_MS', 8000))),
    'html_bytes' => min(524288, max(1024, (int) env('DESTINATION_INSPECTION_HTML_BYTES', 524288))),
    'icon_bytes' => min(262144, max(1024, (int) env('DESTINATION_INSPECTION_ICON_BYTES', 262144))),
    'cache_seconds' => min(600, max(30, (int) env('DESTINATION_INSPECTION_CACHE_SECONDS', 600))),
    'user_per_minute' => min(60, max(1, (int) env('DESTINATION_INSPECTION_USER_PER_MINUTE', 10))),
    'workspace_per_minute' => min(300, max(1, (int) env('DESTINATION_INSPECTION_WORKSPACE_PER_MINUTE', 30))),
];
