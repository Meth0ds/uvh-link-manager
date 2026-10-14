<?php

return [
    'enabled' => filter_var(env('UVH_LINK_WORKFLOWS_ENABLED', false), FILTER_VALIDATE_BOOLEAN),
    'rule_simulator' => filter_var(env('UVH_FEATURE_RULE_SIMULATOR', true), FILTER_VALIDATE_BOOLEAN),
    'link_history' => filter_var(env('UVH_FEATURE_LINK_HISTORY', true), FILTER_VALIDATE_BOOLEAN),
    'link_history_restore' => filter_var(env('UVH_FEATURE_LINK_HISTORY_RESTORE', true), FILTER_VALIDATE_BOOLEAN),
    'reminder_hours' => min(168, max(1, (int) env('LINK_REMINDER_HOURS', 24))),
    'reminder_click_ratio' => min(0.99, max(0.01, (float) env('LINK_REMINDER_CLICK_RATIO', 0.9))),
    'max_saved_filters' => min(50, max(1, (int) env('LINK_SAVED_FILTERS_LIMIT', 50))),
];
