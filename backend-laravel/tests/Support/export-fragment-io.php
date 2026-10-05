<?php

namespace App\Support;

use Tests\Fixtures\ExportFragmentFault;

/** Isolated test hook: production app/bootstrap files never load this file. */
function fopen(string $filename, string $mode): mixed
{
    return ExportFragmentFault::open($filename, $mode);
}
