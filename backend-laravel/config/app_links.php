<?php

return [
    'providers' => filter_var(env('UVH_FEATURE_APP_PROVIDERS', false), FILTER_VALIDATE_BOOLEAN),
    'native' => filter_var(env('UVH_FEATURE_NATIVE_APPS', false), FILTER_VALIDATE_BOOLEAN),
    'receipt_seconds' => 300,
];
