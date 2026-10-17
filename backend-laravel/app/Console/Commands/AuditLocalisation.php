<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

final class AuditLocalisation extends Command
{
    protected $signature = 'uvh:localisation-audit';

    protected $description = 'Check public aliases before reserving language prefixes (read only)';

    public function handle(): int
    {
        $collisions = DB::table('links')->whereNull('domain_id')->whereIn(DB::raw('lower(alias)'), ['es', 'en'])->get(['id', 'alias']);
        foreach ($collisions as $link) {
            $this->error('Reserved-prefix collision: link '.$link->id.' ('.$link->alias.')');
        }
        if ($collisions->isNotEmpty()) {
            return self::FAILURE;
        }
        $this->info('No public aliases conflict with /es or /en.');

        return self::SUCCESS;
    }
}
