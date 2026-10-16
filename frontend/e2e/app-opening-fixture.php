<?php

// Disposable local-only design/integration fixture. Output contains a session:
// redirect to a mode-0600 temporary file; never print or commit that output.
require '/app/vendor/autoload.php';
$app = require '/app/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (! app()->environment('local') || Illuminate\Support\Facades\DB::connection()->getDatabaseName() !== 'uvh_local') {
    throw new RuntimeException('Local fixture only');
}
$cleanupId = getenv('UVH_APP_LINKS_CLEANUP_USER');
if ($cleanupId !== false) {
    if (! ctype_digit($cleanupId)) throw new RuntimeException('Invalid fixture identifier');
    $user = App\Models\User::findOrFail((int) $cleanupId);
    if (! preg_match('/^app-links-[A-Za-z0-9_-]+@example\.invalid$/D', $user->email)) throw new RuntimeException('Not a disposable fixture');
    Illuminate\Support\Facades\DB::transaction(function () use ($user) { $user->ownedWorkspaces()->delete(); $user->delete(); });
    exit;
}
$result = Illuminate\Support\Facades\DB::transaction(function (): array {
    $user = App\Models\User::factory()->create(['name' => 'Revisión de aplicaciones UVH', 'email' => 'app-links-'.App\Support\Ids::randomToken(8).'@example.invalid', 'password_hash' => Illuminate\Support\Facades\Hash::make(bin2hex(random_bytes(32))), 'email_verified_at' => now()]);
    $workspace = $user->ownedWorkspaces()->create(['name' => 'Revisión de aplicaciones', 'slug' => 'app-links-'.App\Support\Ids::randomToken(8)]);
    $workspace->memberships()->create(['user_id' => $user->id, 'role' => 'owner']);
    $workspace->quota()->create(['links_limit' => 100]);
    $domain = App\Models\CustomDomain::create(['workspace_id' => $workspace->id, 'domain' => 'app-demo-'.bin2hex(random_bytes(3)).'.example.test', 'verification_token' => 'uvh-verify=fixture', 'verification_version' => 1, 'verification_scheme' => 2, 'desired_state' => 'enabled', 'ownership_status' => 'verified', 'routing_status' => 'healthy', 'tls_status' => 'ready', 'verified_at' => now(), 'ownership_verified_at' => now(), 'routing_verified_at' => now(), 'edge_eligible' => true, 'tls_ready_at' => now()]);
    App\Support\DomainClaims::prove((int) $workspace->id, $domain->domain);
    Illuminate\Support\Facades\DB::table('app_link_profiles')->insert(['workspace_id' => $workspace->id, 'domain_id' => $domain->id, 'public_id' => (string) Illuminate\Support\Str::uuid(), 'name' => 'La tienda', 'enabled' => true, 'ios_app_id' => 'ABCDE12345.es.empresa.app', 'android_package' => 'es.empresa.app', 'android_fingerprints' => json_encode([implode(':', array_fill(0, 32, 'AB'))]), 'route_prefixes' => json_encode(['/productos/', '/ofertas/']), 'version' => 1, 'created_at' => now(), 'updated_at' => now()]);
    $link = App\Models\Link::create(['workspace_id' => $workspace->id, 'created_by' => $user->id, 'alias' => 'app-'.strtolower(App\Support\Ids::randomToken(8)), 'name' => 'Escucha nuestra selección', 'destination' => 'https://example.org/musica', 'state' => 'active', 'version' => 1, 'app_opening' => ['version' => 1, 'kind' => 'provider', 'provider' => 'spotify', 'url' => 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M']]);
    $profileId = Illuminate\Support\Facades\DB::table('app_link_profiles')->where('domain_id', $domain->id)->value('public_id');
    $native = App\Models\Link::create(['workspace_id' => $workspace->id, 'created_by' => $user->id, 'domain_id' => $domain->id, 'alias' => 'native-demo', 'name' => 'Producto de demostración', 'destination' => 'https://example.org/producto', 'state' => 'active', 'version' => 1, 'app_opening' => ['version' => 1, 'kind' => 'native', 'profileId' => $profileId, 'route' => '/productos/123']]);
    $session = App\Support\SessionManager::create($user->id, Illuminate\Http\Request::create('http://localhost:8000'), (int) $user->security_version, true);
    return ['userId' => $user->id, 'workspaceId' => $workspace->id, 'linkId' => $link->id, 'domainId' => $domain->id, 'domain' => $domain->domain, 'nativeLinkId' => $native->id, 'nativeAlias' => $native->alias, 'alias' => $link->alias, 'cookieName' => config('uvh.session_cookie'), 'session' => $session];
});
echo json_encode($result, JSON_THROW_ON_ERROR);
