<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

final class QrAssetCleanup
{
    /** Collect abandoned uploads and unreferenced assets under workspace → asset locks. */
    public static function run(int $batch = 200): int
    {
        $cutoff = now()->subDay();
        $rows = DB::table('qr_assets')->where('updated_at', '<', $cutoff)
            ->whereNotExists(fn ($q) => $q->selectRaw('1')->from('qr_designs')->whereColumn('qr_designs.asset_id', 'qr_assets.id'))
            ->whereNotExists(fn ($q) => $q->selectRaw('1')->from('qr_variants')->whereColumn('qr_variants.asset_id', 'qr_assets.id'))
            ->orderBy('id')->limit(max(1, min(500, $batch)))->get(['id', 'workspace_id']);
        $deleted = 0;
        foreach ($rows as $candidate) {
            $deleted += DB::transaction(function () use ($candidate, $cutoff): int {
                DB::table('workspaces')->where('id', $candidate->workspace_id)->lockForUpdate()->first();
                $asset = DB::table('qr_assets')->where('id', $candidate->id)->where('updated_at', '<', $cutoff)->lockForUpdate()->first();
                if (! $asset || DB::table('qr_designs')->where('asset_id', $asset->id)->exists() || DB::table('qr_variants')->where('asset_id', $asset->id)->exists()) {
                    return 0;
                }
                $disk = Storage::disk('qr-private');
                if ($disk->exists($asset->path) && ! $disk->delete($asset->path)) {
                    throw new \RuntimeException('No se pudo limpiar un logo QR privado.');
                }
                DB::table('qr_assets')->where('id', $asset->id)->delete();

                return 1;
            });
        }
        // Durable receipts are written by the database even for raw SQL and
        // cascading erasure. Keep them for a day to collect a late upload write.
        // PostgreSQL's trigger timestamps contain microseconds. Laravel's
        // default date binding drops them, delaying a just-created receipt.
        $receipts = DB::table('qr_asset_cleanup_receipts')->where('available_at', '<=', now()->format('Y-m-d H:i:s.uP'))->orderBy('available_at')->limit(max(1, min(500, $batch)))->get(['path']);
        foreach ($receipts as $candidate) {
            $deleted += DB::transaction(function () use ($candidate): int {
                $receipt = DB::table('qr_asset_cleanup_receipts')->where('path', $candidate->path)->lockForUpdate()->first();
                if (! $receipt) {
                    return 0;
                }
                if (! preg_match('/^[1-9][0-9]*\/[a-f0-9-]{36}\.png$/D', $receipt->path)) {
                    throw new \RuntimeException('Ruta de limpieza QR inválida.');
                }
                if (DB::table('qr_assets')->where('path', $receipt->path)->exists()) {
                    return 0;
                }
                $disk = Storage::disk('qr-private');
                if ($disk->exists($receipt->path) && ! $disk->delete($receipt->path)) {
                    throw new \RuntimeException('No se pudo limpiar un logo QR eliminado.');
                }
                if (new \DateTimeImmutable($receipt->expires_at) < now()) {
                    DB::table('qr_asset_cleanup_receipts')->where('path', $receipt->path)->delete();
                } else {
                    DB::table('qr_asset_cleanup_receipts')->where('path', $receipt->path)->update(['available_at' => now()->addHour()]);
                }

                return 1;
            });
        }

        return $deleted;
    }
}
