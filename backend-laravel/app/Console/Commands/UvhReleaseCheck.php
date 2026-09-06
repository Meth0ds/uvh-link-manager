<?php

namespace App\Console\Commands;

use App\Support\ReleaseReadiness;
use Illuminate\Console\Command;

final class UvhReleaseCheck extends Command
{
    protected $signature = 'uvh:release-check';

    protected $description = 'Read-only release schema and invitation-budget configuration check';

    public function handle(): int
    {
        $errors = ReleaseReadiness::errors();
        foreach ($errors as $error) {
            $this->error($error);
        }
        if ($errors !== []) {
            return self::FAILURE;
        }
        $this->info('Esquema del release y presupuestos de invitación comprobados. No se han aplicado migraciones.');

        return self::SUCCESS;
    }
}
