<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

final class UvhDestinationInspectionsPrune extends Command
{
    protected $signature = 'uvh:destination-inspections-prune';

    protected $description = 'Remove expired private destination inspection documents and icons';

    public function handle(): int
    {
        do {
            $ids = DB::table('destination_inspections')->where('expires_at', '<=', now())->limit(500)->pluck('id');
            if ($ids->isNotEmpty()) {
                DB::table('destination_inspections')->whereIn('id', $ids)->delete();
            }
        } while ($ids->count() === 500);

        return self::SUCCESS;
    }
}
