<?php

namespace App\Console\Commands;

use App\Support\Language;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

final class AuditLocalisation extends Command
{
    protected $signature = 'uvh:localisation-audit';

    protected $description = 'Check public aliases before reserving language prefixes (read only)';

    public function handle(): int
    {
        if (config('uvh.french_enabled') && ! is_dir(lang_path('fr'))) {
            $this->error('French is enabled but backend-laravel/lang/fr is missing.');

            return self::FAILURE;
        }
        $collisions = DB::table('links')->whereNull('domain_id')->whereIn(DB::raw('lower(alias)'), Language::SUPPORTED)->get(['id', 'alias']);
        foreach ($collisions as $link) {
            $this->error('Reserved-prefix collision: link '.$link->id.' ('.$link->alias.')');
        }
        if ($collisions->isNotEmpty()) {
            return self::FAILURE;
        }
        $this->info('No public aliases conflict with /'.implode(', /', Language::SUPPORTED).'.');

        return self::SUCCESS;
    }
}
