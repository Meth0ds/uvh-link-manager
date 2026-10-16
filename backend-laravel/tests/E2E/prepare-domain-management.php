<?php

declare(strict_types=1);

use App\Models\CustomDomain;
use App\Models\User;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;

require dirname(__DIR__, 2).'/vendor/autoload.php';
$app = require dirname(__DIR__, 2).'/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();
if (! app()->environment('testing') || ! str_ends_with(DB::connection()->getDatabaseName(), '_test')) {
    fwrite(STDERR, "Refusing domain fixtures outside testing/_test.\n");
    exit(64);
}
$email = (string) ($argv[1] ?? '');
$sourceId = filter_var($argv[2] ?? '', FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
if (! str_starts_with($email, 'domain-e2e-') || ! str_ends_with($email, '@example.test') || $sourceId === false) {
    exit(64);
}
$result = DB::transaction(function () use ($email, $sourceId): array {
    $user = User::where('email', $email)->firstOrFail();
    $workspace = $user->ownedWorkspaces()->firstOrFail();
    $source = CustomDomain::where('workspace_id', $workspace->id)->findOrFail($sourceId);
    // Simulated readiness only: this fixture never publishes DNS or calls ACME.
    $serving = ['desired_state' => 'enabled', 'ownership_status' => 'verified', 'routing_status' => 'healthy',
        'tls_status' => 'ready', 'edge_eligible' => true, 'verified_at' => now(), 'ownership_verified_at' => now(),
        'routing_verified_at' => now(), 'tls_ready_at' => now()];
    $source->update($serving);
    $target = CustomDomain::create([...$serving, 'workspace_id' => $workspace->id,
        'domain' => 'target-'.$sourceId.'.example.test', 'verification_token' => 'uvh-verify=e2e-fixture-only', 'verification_scheme' => 2]);
    $ids = [];
    foreach (['live', 'trash'] as $kind) {
        $ids[$kind] = DB::table('links')->insertGetId(['workspace_id' => $workspace->id, 'created_by' => $user->id,
            'domain_id' => $sourceId, 'alias' => $kind.'-'.$sourceId, 'destination' => 'https://example.org/'.$kind,
            'state' => $kind === 'trash' ? 'deleted' : 'paused', 'state_before_delete' => $kind === 'trash' ? 'paused' : null,
            'deleted_at' => $kind === 'trash' ? now()->subDays(2) : null, 'version' => 1, 'created_at' => now(), 'updated_at' => now()]);
    }

    return ['sourceId' => $sourceId, 'targetId' => (int) $target->id, 'targetDomain' => $target->domain, 'workspaceId' => (int) $workspace->id, ...$ids];
});
echo json_encode($result, JSON_THROW_ON_ERROR).PHP_EOL;
