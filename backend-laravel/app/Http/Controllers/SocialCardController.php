<?php

namespace App\Http\Controllers;

use App\Models\Link;
use App\Support\LinkService;
use App\Support\QrAttribution;
use App\Support\RedirectService;
use App\Support\SocialPreview;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

final class SocialCardController
{
    public function card(Request $request, string $alias): Response
    {
        return DB::transaction(function () use ($request, $alias) {
            $link = SocialPreview::lookup($request->getHost(), $alias);
            $protected = $link && $link->password_hash && SocialPreview::eligible($link);
            $published = $link && SocialPreview::publishable($link);
            $spec = $published ? $link->social_preview : null;
            $title = $protected ? __('display.display_8caf6ff98de4f2') : __('display.display_11e385a1023bde');
            $description = $protected ? __('display.display_040ccc353fd68f') : __('display.display_49f03ef373faa9');
            $image = null;
            $alt = '';
            $canonical = null;
            if ($published) {
                $title = __('display.display_2d245b135a19a7');
                $description = __('display.display_9bf33b95b33b24');
                $canonical = LinkService::shortUrl($link->domain?->domain, $link->alias);
                $variant = QrAttribution::fromRequest($request);
                if ($variant !== null && DB::table('qr_variants')->where('link_id', $link->id)->where('public_id', $variant)->exists()) {
                    $canonical .= '?qr='.rawurlencode($variant);
                }
                if (is_array($spec) && ($spec['enabled'] ?? false)) {
                    $title = $spec['title'];
                    $description = $spec['description'] ?? '';
                    $alt = $spec['imageAlt'] ?? '';
                    if ($spec['imageAssetId'] !== null) {
                        $asset = DB::table('social_preview_assets')->where('id', $spec['imageAssetId'])->where('workspace_id', $link->workspace_id)->where('status', 'ready')->first();
                        if ($asset) {
                            $image = rtrim((string) config('uvh.public_origin'), '/').'/.well-known/uvh-social/'.$link->social_public_id.'/'.$asset->public_id.'.jpg';
                        }
                    }
                }
            }

            return response()->view('social-card', compact('title', 'description', 'image', 'alt', 'canonical'), $published || $protected ? 200 : 404)->header('X-Robots-Tag', 'noindex, nofollow, noarchive');
        });
    }

    public function image(Request $request, string $publication, string $assetId): Response
    {
        abort_unless(config('sharing.social_previews'), 404);

        return DB::transaction(function () use ($publication, $assetId) {
            $link = Link::where('social_public_id', $publication)->sharedLock()->first();
            abort_unless($link && SocialPreview::publishable($link) && ($link->social_preview['enabled'] ?? false), 404);
            if ($link->domain_id !== null) {
                abort_if(RedirectService::resolveDomainId($link->domain->domain ?? '') === -1, 404);
            }
            $asset = DB::table('social_preview_assets')->where('id', $link->social_preview['imageAssetId'] ?? 0)->where('public_id', $assetId)->where('workspace_id', $link->workspace_id)->where('status', 'ready')->first();
            abort_unless($asset && Storage::disk('local')->exists($asset->path), 404);

            return response(Storage::disk('local')->get($asset->path))->header('Content-Type', 'image/jpeg')->header('Cache-Control', 'no-store')->header('X-Robots-Tag', 'noindex, noarchive');
        });
    }
}
