<?php

namespace App\Http\Controllers;

use App\Exceptions\LinkException;
use App\Support\QrDesign;
use App\Support\QrLogo;
use App\Support\UvhRequest;
use App\Support\WorkspaceMutation;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

final class QrAssetController
{
    public function store(Request $request): JsonResponse
    {
        try {
            $file = $request->file('logo');
            if (! $file instanceof UploadedFile) {
                throw new LinkException(__('messages.error_0b2c1253828868'), 422);
            }
            $key = QrDesign::requestKey($request->header('Idempotency-Key'));
            $logo = QrLogo::normalize($file);
            $workspaceId = UvhRequest::workspaceId($request);
            $asset = WorkspaceMutation::run($request, function () use ($request, $key, $logo, $workspaceId): object {
                $old = DB::table('qr_assets')->where('workspace_id', $workspaceId)->where('request_key', $key)->first();
                if ($old) {
                    if (! hash_equals($old->input_hash, $logo['inputHash'])) {
                        throw new LinkException(__('messages.error_5ca7cc128a3469'), 409);
                    }

                    return $old;
                }
                $used = (int) DB::table('qr_assets')->where('workspace_id', $workspaceId)->sum('bytes');
                if ($used + strlen($logo['png']) > (int) config('qr.asset_bytes_per_workspace', 64 * 1024 * 1024)) {
                    throw new LinkException(__('messages.error_90c5ddf723f4bc'), 409);
                }
                $id = DB::table('qr_assets')->insertGetId(['workspace_id' => $workspaceId, 'created_by' => UvhRequest::user($request)->id,
                    'request_key' => $key, 'input_hash' => $logo['inputHash'], 'path' => $workspaceId.'/'.Str::uuid().'.png',
                    'bytes' => strlen($logo['png']), 'width' => $logo['width'], 'height' => $logo['height'], 'status' => 'pending', 'created_at' => now(), 'updated_at' => now()]);

                return DB::table('qr_assets')->where('id', $id)->first();
            });
            if ($asset->status === 'pending') {
                // The reservation is committed BEFORE filesystem I/O. A crash or
                // loss of permission leaves a visible, collectable pending row.
                if (! Storage::disk('qr-private')->put($asset->path, $logo['png'])) {
                    throw new LinkException(__('messages.error_3e8f819865203d'), 503);
                }
                WorkspaceMutation::run($request, function () use ($asset, $workspaceId): void {
                    $row = DB::table('qr_assets')->where('workspace_id', $workspaceId)->where('id', $asset->id)->lockForUpdate()->first();
                    if (! $row) {
                        throw new LinkException(__('messages.error_38fe4ab0ebb64e'), 409);
                    }
                    DB::table('qr_assets')->where('id', $asset->id)->update(['status' => 'ready', 'updated_at' => now()]);
                });
            }

            return response()->json(['asset' => ['id' => (int) $asset->id, 'width' => (int) $asset->width, 'height' => (int) $asset->height, 'bytes' => (int) $asset->bytes]], 201);
        } catch (LinkException $e) {
            return response()->json(['error' => $e->getMessage()], $e->status);
        }
    }

    public function show(Request $request, int $id): JsonResponse|Response
    {
        $row = DB::table('qr_assets')->where('workspace_id', UvhRequest::workspaceId($request))->where('id', $id)->where('status', 'ready')->first();
        if (! $row) {
            return response()->json(['error' => __('messages.error_afc4f75f13755a')], 404);
        }
        $bytes = Storage::disk('qr-private')->get($row->path);
        if ($bytes === null) {
            return response()->json(['error' => __('messages.error_b1d66efbeb16b4')], 503);
        }

        return response($bytes)->header('Content-Type', 'image/png')->header('X-Content-Type-Options', 'nosniff')->header('Cache-Control', 'private, no-store')->header('Content-Disposition', 'inline; filename="uvh-logo.png"');
    }
}
