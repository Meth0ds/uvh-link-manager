<?php

namespace App\Http\Controllers;

use App\Exceptions\LinkException;
use App\Models\Link;
use App\Support\LinkPreferences;
use App\Support\UvhRequest;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

final class LinkFavoriteController
{
    public function update(Request $request, int $id): JsonResponse
    {
        try {
            if (array_keys($request->all()) !== ['favorite'] || ! is_bool($request->input('favorite'))) {
                throw new LinkException(__('messages.error_94cfe427ce0fe7'), 422);
            }
            LinkPreferences::mutate($request, function () use ($request, $id): void {
                $workspace = UvhRequest::workspaceId($request);
                if (! Link::where('workspace_id', $workspace)->where('id', $id)->lockForUpdate()->first()) {
                    throw new LinkException(__('messages.error_2f4bde2886e62b'), 404);
                }
                $key = ['workspace_id' => $workspace, 'user_id' => UvhRequest::user($request)->id, 'link_id' => $id];
                if ($request->boolean('favorite')) {
                    DB::table('link_favorites')->insertOrIgnore($key + ['created_at' => now()]);
                } else {
                    DB::table('link_favorites')->where($key)->delete();
                }
            });

            return response()->json(['favorite' => $request->boolean('favorite')]);
        } catch (LinkException $error) {
            return response()->json(['error' => $error->getMessage()], $error->status);
        }
    }
}
