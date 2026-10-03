<?php

namespace App\Support;

// Load only inside an isolated PHPUnit process: the production helper keeps
// its wall clock, while the test can exercise equality without a timing race.
function microtime(bool $asFloat = false): float|string
{
    return $asFloat ? 1_800_000_000.125 : '0.12500000 1800000000';
}
