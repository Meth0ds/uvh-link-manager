<?php

namespace App\Http\Controllers;

use App\Support\RedirectService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

final class AppAssociationController
{
    public function show(Request $request, string $file): JsonResponse
    {
        abort_unless(config('app_links.native'), 404);
        $domain = RedirectService::resolveDomainId($request->getHost());
        abort_unless(is_int($domain) && $domain > 0, 404);
        $profile = DB::table('app_link_profiles')->where('domain_id', $domain)->where('enabled', true)
            ->whereRaw('workspace_id = (select workspace_id from custom_domains where id = app_link_profiles.domain_id)')->first();
        abort_unless($profile !== null, 404);

        return response()->json(self::document($profile, $file))->header('X-Robots-Tag', 'noindex, nofollow')->header('Cache-Control', 'no-store');
    }

    /** @return array<mixed> */
    public static function document(object $profile, string $file): array
    {
        if ($file === 'apple-app-site-association') {
            return ['applinks' => ['apps' => [], 'details' => $profile->ios_app_id ? [['appID' => $profile->ios_app_id, 'paths' => ['/a/*']]] : []]];
        }

        return $profile->android_package ? [['relation' => ['delegate_permission/common.handle_all_urls'], 'target' => ['namespace' => 'android_app', 'package_name' => $profile->android_package, 'sha256_cert_fingerprints' => json_decode($profile->android_fingerprints, true)], 'relation_extensions' => ['delegate_permission/common.handle_all_urls' => ['dynamic_app_link_components' => [['/' => '/a/*'], ['/' => '*', 'exclude' => true]]]]]] : [];
    }
}
