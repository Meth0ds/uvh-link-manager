<?php

namespace App\Http\Controllers;

use App\Exceptions\LinkException;
use App\Support\Idempotency;
use App\Support\SocialImage;
use App\Support\UvhRequest;
use App\Support\WorkspaceMutation;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

final class SocialPreviewAssetController
{
    public function store(Request $request): JsonResponse
    {
        try {
            if (! config('sharing.social_previews')) {
                throw new LinkException(__('messages.error_3f80b725d8fbb6'), 404);
            }
            $file = $request->file('image');
            $key = $request->header('Idempotency-Key');
            if (! $file instanceof UploadedFile || ! Idempotency::validateKey($key)['ok']) {
                throw new LinkException(__('messages.error_d06b75904e0966'), 422);
            }
            $rawCrop = $request->input('crop');
            $crop = $rawCrop === null ? null : (is_string($rawCrop) ? json_decode($rawCrop, true, 8) : $rawCrop);
            if ($rawCrop !== null && $crop === null) {
                throw new LinkException(__('messages.error_233b44ff680999'), 422);
            }
            $image = SocialImage::normalize($file, $crop);
            $workspace = UvhRequest::workspaceId($request);
            $row = WorkspaceMutation::run($request, function () use ($workspace, $key, $image): object {
                $old = DB::table('social_preview_assets')->where('workspace_id', $workspace)->where('request_key', $key)->first();
                if ($old) {
                    if (! hash_equals($old->input_hash, $image['inputHash'])) {
                        throw new LinkException(__('messages.error_5ca7cc128a3469'), 409);
                    }

                    return $old;
                }
                if (DB::table('social_preview_assets')->where('workspace_id', $workspace)->sum('bytes') + strlen($image['jpeg']) > (int) config('sharing.asset_bytes')) {
                    throw new LinkException(__('messages.error_43c38f82a21882'), 409);
                }
                $public = Str::uuid()->toString();
                $id = DB::table('social_preview_assets')->insertGetId(['workspace_id' => $workspace, 'public_id' => $public, 'request_key' => $key, 'input_hash' => $image['inputHash'], 'path' => 'social-previews/'.$workspace.'/'.$public.'.jpg', 'bytes' => strlen($image['jpeg']), 'created_at' => now(), 'updated_at' => now()]);

                return DB::table('social_preview_assets')->where('id', $id)->first();
            });
            if ($row->status !== 'ready') {
                if (! Storage::disk('local')->put($row->path, $image['jpeg'])) {
                    throw new LinkException(__('messages.error_1e34cac3c43e9b'), 503);
                }
                WorkspaceMutation::run($request, function () use ($row, $workspace): void {
                    $fresh = DB::table('social_preview_assets')->where('workspace_id', $workspace)->where('id', $row->id)->lockForUpdate()->first();
                    if (! $fresh) {
                        throw new LinkException(__('messages.error_38fe4ab0ebb64e'), 409);
                    }
                    DB::table('social_preview_assets')->where('id', $row->id)->update(['status' => 'ready', 'updated_at' => now()]);
                });
            }

            return response()->json(['asset' => ['id' => (int) $row->id, 'width' => 1200, 'height' => 630, 'bytes' => (int) $row->bytes]], 201);
        } catch (LinkException $e) {
            return response()->json(['error' => $e->getMessage()], $e->status);
        }
    }

    public function show(Request $request, int $id): Response
    {
        abort_unless(config('sharing.social_previews'), 404);
        $row = DB::table('social_preview_assets')->where('workspace_id', UvhRequest::workspaceId($request))->where('id', $id)->where('status', 'ready')->first();
        abort_unless($row && Storage::disk('local')->exists($row->path), 404);

        return response(Storage::disk('local')->get($row->path))->header('Content-Type', 'image/jpeg')->header('Cache-Control', 'private, no-store');
    }
}
