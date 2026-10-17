<?php

namespace App\Http\Controllers;

use App\Exceptions\LinkException;
use App\Support\AppOpening;
use App\Support\Audit;
use App\Support\DestinationHttpTransport;
use App\Support\Idempotency;
use App\Support\RedirectService;
use App\Support\SecurityContext;
use App\Support\UvhRequest;
use App\Support\WorkspaceAccess;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

final class DomainAppProfileController
{
    public function show(Request $request, int $id): JsonResponse
    {
        abort_unless(config('app_links.native'), 404);
        $domain = DB::table('custom_domains')->where('id', $id)->where('workspace_id', UvhRequest::workspaceId($request))->first();
        abort_unless($domain !== null, 404);
        $row = DB::table('app_link_profiles')->where('domain_id', $id)->where('workspace_id', $domain->workspace_id)->first();

        return response()->json(['profile' => $row ? self::present($row) : null, 'domainReady' => RedirectService::resolveDomainId($domain->domain) === $id]);
    }

    /** @return array<string, mixed> */
    public static function present(object $row): array
    {
        return ['id' => $row->public_id, 'version' => (int) $row->version, 'name' => $row->name, 'enabled' => (bool) $row->enabled, 'iosAppId' => $row->ios_app_id, 'androidPackage' => $row->android_package, 'androidFingerprints' => json_decode($row->android_fingerprints, true), 'routePrefixes' => json_decode($row->route_prefixes, true)];
    }

    public function save(Request $request, int $id): JsonResponse
    {
        abort_unless(config('app_links.native'), 404);
        try {
            $result = DB::transaction(function () use ($request, $id): array {
                $user = UvhRequest::user($request);
                $workspace = UvhRequest::workspaceId($request);
                $context = SecurityContext::lock($user, UvhRequest::sessionId($request), requireVerifiedEmail: true);
                if (! $context || ! WorkspaceAccess::getMembershipForContext($context, $workspace, 'admin')) {
                    throw new LinkException(__('messages.error_c75c21b9f3066d'), 403);
                }
                $key = $request->header('Idempotency-Key');
                if (! Idempotency::validateKey($key)['ok']) {
                    throw new LinkException(__('messages.error_02a33307f17e7f'), 422);
                }
                $domain = DB::table('custom_domains')->where('id', $id)->where('workspace_id', $workspace)->lockForUpdate()->first();
                if (! $domain) {
                    throw new LinkException(__('messages.error_9c404451a4d01d'), 404);
                }
                $scope = 'app-profile:'.$workspace.':'.$id;
                $hash = hash('sha256', json_encode($request->all(), JSON_THROW_ON_ERROR));
                $begin = Idempotency::begin((int) $user->id, $scope, $key, $hash);
                if ($begin['state'] === 'replay') {
                    return $begin['body'];
                }
                if ($begin['state'] !== 'fresh') {
                    throw new LinkException(__('messages.error_072c46480b07c4'), 409);
                }
                $row = DB::table('app_link_profiles')->where('domain_id', $id)->lockForUpdate()->first();
                if ($request->input('version') !== ($row ? (int) $row->version : 0)) {
                    throw new LinkException(__('messages.error_36919233a5a313'), 409);
                }
                $values = $this->validate($request);
                if ($values['enabled'] && RedirectService::resolveDomainId($domain->domain) !== $id) {
                    throw new LinkException(__('messages.error_70ef695852baec'), 422);
                }
                $values += ['version' => ($row ? (int) $row->version : 0) + 1, 'updated_at' => now()];
                if ($row) {
                    DB::table('app_link_profiles')->where('id', $row->id)->update($values);
                } else {
                    DB::table('app_link_profiles')->insert($values + ['public_id' => (string) Str::uuid(), 'domain_id' => $id, 'workspace_id' => $workspace, 'created_at' => now()]);
                }
                Audit::write((int) $user->id, 'domain.app_profile_updated', 'domain', $id, ['version' => $values['version']], workspaceId: $workspace);
                $result = ['profile' => self::present(DB::table('app_link_profiles')->where('domain_id', $id)->first()), 'domainReady' => RedirectService::resolveDomainId($domain->domain) === $id];
                Idempotency::commit((int) $user->id, $scope, $key, $hash, 200, $result, $begin['lease']);

                return $result;
            });

            return response()->json($result);
        } catch (LinkException $e) {
            return response()->json(['error' => $e->getMessage()], $e->status);
        }
    }

    /** @return array<string, mixed> */
    private function validate(Request $request): array
    {
        $v = $request->all();
        if (array_diff(array_keys($v), ['version', 'name', 'enabled', 'iosAppId', 'androidPackage', 'androidFingerprints', 'routePrefixes']) || ! is_bool($v['enabled'] ?? null) || ! is_string($v['name'] ?? null) || trim($v['name']) === '' || mb_strlen($v['name']) > 120 || preg_match('/[\p{Cc}\p{Cf}<>]/u', $v['name'])) {
            throw new LinkException(__('messages.error_824effbb05271f'), 422);
        }
        $ios = $v['iosAppId'] ?? null;
        $android = $v['androidPackage'] ?? null;
        $fingerprints = $v['androidFingerprints'] ?? [];
        $prefixes = $v['routePrefixes'] ?? [];
        if (($ios !== null && (! is_string($ios) || preg_match('/^[A-Z0-9]{10}\.[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/D', $ios) !== 1)) || ($android !== null && (! is_string($android) || strlen($android) > 255 || preg_match('/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/D', $android) !== 1)) || ($ios === null && $android === null)) {
            throw new LinkException(__('messages.error_5db1a9da658758'), 422);
        }
        if (! is_array($fingerprints) || ! array_is_list($fingerprints) || count($fingerprints) > 10 || ($android !== null && count($fingerprints) === 0)) {
            throw new LinkException(__('messages.error_c8247cd168346d'), 422);
        }
        foreach ($fingerprints as $fingerprint) {
            if (! is_string($fingerprint) || ! preg_match('/^(?:[A-Fa-f0-9]{2}:){31}[A-Fa-f0-9]{2}$/D', $fingerprint)) {
                throw new LinkException(__('messages.error_89422458b6fe7b'), 422);
            }
        }
        if (! is_array($prefixes) || ! array_is_list($prefixes) || count($prefixes) < 1 || count($prefixes) > 20) {
            throw new LinkException(__('messages.error_face15ad93bff4'), 422);
        }
        foreach ($prefixes as $prefix) {
            if (! is_string($prefix) || strlen($prefix) > 200 || ! str_ends_with($prefix, '/') || ! AppOpening::routeAllowed($prefix, ['/'])) {
                throw new LinkException(__('messages.error_ed3fd3a24a7046'), 422);
            }
        }

        return ['name' => trim($v['name']), 'enabled' => $v['enabled'], 'ios_app_id' => $ios, 'android_package' => $android, 'android_fingerprints' => json_encode(array_values(array_unique(array_map('strtoupper', $fingerprints))), JSON_THROW_ON_ERROR), 'route_prefixes' => json_encode(array_values(array_unique($prefixes)), JSON_THROW_ON_ERROR)];
    }

    public function diagnose(Request $request, int $id): JsonResponse
    {
        abort_unless(config('app_links.native'), 404);
        $domain = DB::table('custom_domains')->where('id', $id)->where('workspace_id', UvhRequest::workspaceId($request))->first();
        abort_unless($domain !== null, 404);
        $ready = RedirectService::resolveDomainId($domain->domain) === $id;
        $profile = DB::table('app_link_profiles')->where('domain_id', $id)->where('workspace_id', $domain->workspace_id)->where('enabled', true)->first();
        $files = [];
        $remaining = 8000;
        foreach (['apple-app-site-association', 'assetlinks.json'] as $file) {
            $ok = false;
            if ($ready && $profile) {
                $start = microtime(true);
                try {
                    $r = app(DestinationHttpTransport::class)->request('https://'.$domain->domain.'/.well-known/'.$file, 'GET', max(1, $remaining), 32_768);
                    $expected = AppAssociationController::document($profile, $file);
                    $ok = $r['status'] === 200 && ! $r['truncated'] && json_decode($r['body'], true) === $expected;
                } catch (\Throwable) {
                    // Do not include remote addresses, bodies or secrets in diagnostics.
                }
                $remaining -= (int) ((microtime(true) - $start) * 1000);
            }
            $files[] = ['file' => $file, 'published' => $ok];
            if ($remaining <= 0) {
                break;
            }
        }

        return response()->json(['domainVerified' => $ready, 'files' => $files, 'deviceTest' => 'pending']);
    }
}
