<?php

declare(strict_types=1);

/**
 * Custom domains: the phase the verification worker reached.
 */

use Illuminate\Support\Facades\DB;

return [
    'domain' => static function (string $argument): array {
        $row = DB::table('custom_domains')->where('id', (int) $argument)->first();

        return $row === null ? [] : [
            'id' => (int) $row->id,
            'state' => (string) $row->state,
            'dns_error' => $row->dns_error !== null ? (string) $row->dns_error : null,
            'verified_at' => $row->verified_at !== null ? (string) $row->verified_at : null,
            'ownership_verified_at' => $row->ownership_verified_at !== null ? (string) $row->ownership_verified_at : null,
            'routing_verified_at' => $row->routing_verified_at !== null ? (string) $row->routing_verified_at : null,
        ];
    },
    // Depth comes from the configured broker. The database driver answers
    // from the `jobs` table and Redis from its own structures, so this read
    // keeps working after the broker moves. -1 marks an unreadable sample, so
    // the driver's "no job left in the queue" assertion cannot pass on a
    // broker the harness was unable to ask.
];
