<?php

use App\Support\Auth\SecurityIncidentAudit;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;

require dirname(__DIR__, 2).'/vendor/autoload.php';

$app = require dirname(__DIR__, 2).'/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();
if ($app->environment() !== 'testing' || ! str_ends_with((string) DB::connection()->getDatabaseName(), '_test')) {
    throw new RuntimeException('Refusing to reconcile audit fixtures outside testing/*_test.');
}
DB::select("SELECT set_config('application_name', ?, false)", ['uvh-incident-audit-worker']);
SecurityIncidentAudit::reconcile();
echo json_encode(['ok' => true], JSON_THROW_ON_ERROR);
