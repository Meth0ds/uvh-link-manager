<?php

namespace App\Http\Controllers;

use App\Models\Link;
use App\Support\AppOpening;
use App\Support\LinkService;
use App\Support\UvhRequest;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class QrSnapshotController
{
    public function index(Request $request): JsonResponse
    {
        $raw = $request->query('ids');
        if (! is_string($raw) || strlen($raw) > 2200 || ! preg_match('/^[1-9][0-9]*(?:,[1-9][0-9]*){0,99}$/D', $raw)) {
            return response()->json(['error' => __('messages.error_767a67087cdf01')], 422);
        }
        $parts = explode(',', $raw);
        $ids = [];
        foreach ($parts as $part) {
            if (strlen($part) > 16 || (float) $part > 9007199254740991) {
                return response()->json(['error' => __('messages.error_e4b7357ac629d0')], 422);
            }
            $ids[] = (int) $part;
        }
        if (count(array_unique($ids)) !== count($ids)) {
            return response()->json(['error' => __('messages.error_c7cdbdd2400702')], 422);
        }
        $rows = Link::with(AppOpening::domainRelation())->where('workspace_id', UvhRequest::workspaceId($request))->whereNull('deleted_at')->whereIn('id', $ids)->get()->keyBy('id');
        if ($rows->count() !== count($ids)) {
            return response()->json(['error' => __('messages.error_d54eac76e6a92c')], 404);
        }

        return response()->json(['links' => array_map(function (int $id) use ($rows): array {
            $row = $rows[$id];

            return ['id' => $id, 'alias' => $row->alias, 'shortUrl' => LinkService::shortUrl($row->domain?->domain, $row->alias), 'shareUrl' => AppOpening::launchUrl($row, LinkService::shortUrl($row->domain?->domain, $row->alias)) ?? LinkService::shortUrl($row->domain?->domain, $row->alias), 'state' => $row->state];
        }, $ids)])->header('Cache-Control', 'private, no-store');
    }
}
