<?php

// CLI-only full-stack fixture. It cannot run against a production environment.
require '/app/vendor/autoload.php';
$app = require '/app/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (! app()->environment('local') || Illuminate\Support\Facades\DB::connection()->getDatabaseName() !== 'uvh_local') {
    throw new RuntimeException('Local fixture only');
}

$cleanupId = getenv('UVH_SHARING_CLEANUP_USER');
if ($cleanupId !== false) {
    if (! ctype_digit($cleanupId)) {
        throw new RuntimeException('Invalid fixture identifier');
    }
    $user = App\Models\User::findOrFail((int) $cleanupId);
    if (! preg_match('/^sharing-[A-Za-z0-9_-]+@example\.invalid$/D', $user->email)) {
        throw new RuntimeException('Refusing to delete a non-fixture account');
    }
    Illuminate\Support\Facades\DB::transaction(function () use ($user): void {
        $user->ownedWorkspaces()->delete();
        $user->delete();
    });
    App\Support\SocialAssetCleanup::run();
    echo "Disposable sharing fixture removed.\n";
    exit;
}

$result = Illuminate\Support\Facades\DB::transaction(function (): array {
    $user = App\Models\User::factory()->create(['name' => 'Revisión de diseño UVH', 'email' => 'sharing-'.App\Support\Ids::randomToken(8).'@example.invalid', 'password_hash' => Illuminate\Support\Facades\Hash::make(bin2hex(random_bytes(32))), 'email_verified_at' => now()]);
    $workspace = $user->ownedWorkspaces()->create(['name' => 'Pruebas de informes y tarjetas', 'slug' => 'sharing-'.App\Support\Ids::randomToken(8)]);
    $workspace->memberships()->create(['user_id' => $user->id, 'role' => 'owner']);
    $workspace->quota()->create(['links_limit' => 100]);
    $link = App\Models\Link::create(['workspace_id' => $workspace->id, 'created_by' => $user->id, 'alias' => 'sharing-'.strtolower(App\Support\Ids::randomToken(8)), 'name' => 'Carta restaurante · Otoño', 'destination' => 'https://example.org/carta', 'state' => 'active', 'version' => 1]);
    for ($day = 0; $day < 24; $day++) {
        for ($visit = 0; $visit < 2 + ($day * 7) % 11; $visit++) {
            App\Support\AnalyticsService::recordClick((int) $link->id, ['country' => $visit % 3 === 0 ? 'FR' : 'ES', 'device' => $visit % 3 === 0 ? 'desktop' : 'mobile'], occurredAt: now()->utc()->subDays($day)->toIso8601String());
        }
    }
    $session = App\Support\SessionManager::create($user->id, Illuminate\Http\Request::create('http://localhost:8000'), (int) $user->security_version, true);
    // Redirect this output to a chmod-600 temporary file; never commit it or log it.
    return ['userId' => $user->id, 'workspaceId' => $workspace->id, 'linkId' => $link->id, 'cookieName' => config('uvh.session_cookie'), 'session' => $session];
});
echo json_encode($result, JSON_THROW_ON_ERROR);
