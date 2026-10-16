<?php

return [
    'providers' => filter_var(env('UVH_FEATURE_APP_PROVIDERS', true), FILTER_VALIDATE_BOOLEAN),
    'native' => filter_var(env('UVH_FEATURE_NATIVE_APPS', true), FILTER_VALIDATE_BOOLEAN),
    'receipt_seconds' => 300,
];
