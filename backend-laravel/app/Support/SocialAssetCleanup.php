<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

final class SocialAssetCleanup
{
    private static function referenced(int $id): bool
    {
        return DB::table('links')->whereRaw("social_preview->>'imageAssetId' = ?", [(string) $id])->exists()
            || DB::table('link_versions')->whereRaw("configuration->'socialPreview'->>'imageAssetId' = ?", [(string) $id])->exists()
            || DB::table('link_templates')->whereRaw("payload->'social_preview'->>'imageAssetId' = ?", [(string) $id])->exists();
    }

    /** Collect abandoned uploads and unreferenced assets under workspace → asset locks. */
    public static function run(int $batch = 200): int
    {
        $cutoff = now()->subDay();
        $rows = DB::table('social_preview_assets')->where('updated_at', '<', $cutoff)
            ->whereNotExists(fn ($q) => $q->selectRaw('1')->from('links')->whereRaw("links.social_preview->>'imageAssetId' = social_preview_assets.id::text"))
            ->whereNotExists(fn ($q) => $q->selectRaw('1')->from('link_versions')->whereRaw("link_versions.configuration->'socialPreview'->>'imageAssetId' = social_preview_assets.id::text"))
            ->whereNotExists(fn ($q) => $q->selectRaw('1')->from('link_templates')->whereRaw("link_templates.payload->'social_preview'->>'imageAssetId' = social_preview_assets.id::text"))
            ->orderBy('id')->limit(max(1, min(500, $batch)))->get(['id', 'workspace_id']);
        $deleted = 0;
        foreach ($rows as $candidate) {
            $deleted += DB::transaction(function () use ($candidate, $cutoff): int {
                DB::table('workspaces')->where('id', $candidate->workspace_id)->lockForUpdate()->first();
                $asset = DB::table('social_preview_assets')->where('id', $candidate->id)->where('updated_at', '<', $cutoff)->lockForUpdate()->first();
                if (! $asset || self::referenced((int) $asset->id)) {
                    return 0;
                }
                $disk = Storage::disk('local');
                if ($disk->exists($asset->path) && ! $disk->delete($asset->path)) {
                    throw new \RuntimeException('No se pudo limpiar una imagen social privada.');
                }
                DB::table('social_preview_assets')->where('id', $asset->id)->delete();

                return 1;
            });
        }
        // Durable receipts are written by the database even for raw SQL and
        // cascading erasure. Keep them for a day to collect a late upload write.
        // PostgreSQL's trigger timestamps contain microseconds. Laravel's
        // default date binding drops them, delaying a just-created receipt.
        $receipts = DB::table('social_preview_asset_cleanup_receipts')->where('available_at', '<=', now()->format('Y-m-d H:i:s.uP'))->orderBy('available_at')->limit(max(1, min(500, $batch)))->get(['path']);
        foreach ($receipts as $candidate) {
            $deleted += DB::transaction(function () use ($candidate): int {
                $receipt = DB::table('social_preview_asset_cleanup_receipts')->where('path', $candidate->path)->lockForUpdate()->first();
                if (! $receipt) {
                    return 0;
                }
                if (! preg_match('/^social-previews\/[1-9][0-9]*\/[a-f0-9-]{36}\.jpg$/D', $receipt->path)) {
                    throw new \RuntimeException('Ruta de limpieza social inválida.');
                }
                if (DB::table('social_preview_assets')->where('path', $receipt->path)->exists()) {
                    return 0;
                }
                $disk = Storage::disk('local');
                if ($disk->exists($receipt->path) && ! $disk->delete($receipt->path)) {
                    throw new \RuntimeException('No se pudo limpiar una imagen social eliminada.');
                }
                if (new \DateTimeImmutable($receipt->expires_at) < now()) {
                    DB::table('social_preview_asset_cleanup_receipts')->where('path', $receipt->path)->delete();
                } else {
                    DB::table('social_preview_asset_cleanup_receipts')->where('path', $receipt->path)->update(['available_at' => now()->addHour()]);
                }

                return 1;
            });
        }

        return $deleted;
    }
}
