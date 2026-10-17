<?php

namespace App\Http\Controllers;

use App\Exceptions\LinkException;
use App\Support\LinkPreferences;
use App\Support\UvhRequest;
use Illuminate\Database\Query\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

final class SavedLinkFilterController
{
    public function index(Request $request): JsonResponse
    {
        try {
            LinkPreferences::enabled();

            return response()->json(['filters' => LinkPreferences::presentMany($this->query($request)->orderBy('name')->orderBy('id')->get(), UvhRequest::workspaceId($request))]);
        } catch (LinkException $error) {
            return response()->json(['error' => $error->getMessage()], $error->status);
        }
    }

    public function store(Request $request): JsonResponse
    {
        return $this->save($request);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        return $this->save($request, $id);
    }

    private function save(Request $request, ?int $id = null): JsonResponse
    {
        try {
            $row = LinkPreferences::mutate($request, function () use ($request, $id) {
                if (array_diff(array_keys($request->all()), $id === null ? ['name', 'spec'] : ['name', 'spec', 'version']) !== []) {
                    throw new LinkException(__('messages.error_bdbe4d977b6771'), 422);
                }
                if ($id !== null && (! is_int($request->input('version')) || $request->input('version') < 1)) {
                    throw new LinkException(__('messages.error_e2df6bf5057b0a'), 428);
                }
                if ($id !== null && ! $request->has('name') && ! $request->has('spec')) {
                    throw new LinkException(__('messages.error_d4c55c90c92a18'), 422);
                }
                $name = $request->input('name');
                if (($id === null || $request->has('name')) && (! is_string($name) || trim($name) === '' || ! mb_check_encoding($name, 'UTF-8') || mb_strlen($name) > 80 || preg_match('/[\p{Cc}\p{Cf}]/u', $name))) {
                    throw new LinkException(__('messages.error_dba30147008756'), 422);
                }
                $query = $this->query($request);
                $row = $id !== null ? (clone $query)->where('id', $id)->lockForUpdate()->first() : null;
                if ($id !== null && ! $row) {
                    throw new LinkException(__('messages.error_47d0c02846234d'), 404);
                }
                if ($row && $request->input('version') !== (int) $row->version) {
                    throw new LinkException(__('messages.error_bb73e8d1ca3550'), 409);
                }
                $name = $request->has('name') ? $name : $row->name;
                $spec = $request->has('spec') ? $request->input('spec') : ($row ? json_decode($row->spec, true, 32, JSON_THROW_ON_ERROR) : null);
                LinkPreferences::validateSpec($spec);
                $spec = LinkPreferences::canonicalSpec($spec);
                if (($id === null || $request->has('spec')) && LinkPreferences::missingReferences($spec, UvhRequest::workspaceId($request)) !== []) {
                    throw new LinkException(__('messages.error_a65d2e8df6dcd9'), 422);
                }
                if ($id === null && $query->count() >= (int) config('workflows.max_saved_filters', 50)) {
                    throw new LinkException(__('messages.error_7568c66eda9e19'), 429);
                }
                $values = ['name' => trim($name), 'spec' => json_encode($spec, JSON_THROW_ON_ERROR), 'updated_at' => now(), 'version' => $row ? (int) $row->version + 1 : 1];
                if ($id === null) {
                    $id = DB::table('saved_link_filters')->insertGetId($values + ['user_id' => UvhRequest::user($request)->id, 'workspace_id' => UvhRequest::workspaceId($request), 'created_at' => now()]);
                } else {
                    $query->where('id', $id)->update($values);
                }

                return $this->query($request)->where('id', $id)->first();
            });

            return response()->json(['filter' => LinkPreferences::present($row)], $id === null ? 201 : 200);
        } catch (LinkException $error) {
            return response()->json(['error' => $error->getMessage()], $error->status);
        }
    }

    public function destroy(Request $request, int $id): JsonResponse
    {
        try {
            LinkPreferences::mutate($request, function () use ($request, $id): void {
                $row = $this->query($request)->where('id', $id)->lockForUpdate()->first();
                if (! $row) {
                    throw new LinkException(__('messages.error_47d0c02846234d'), 404);
                }
                if ($request->input('version') !== (int) $row->version) {
                    throw new LinkException(__('messages.error_217f343e01f132'), 409);
                }
                $this->query($request)->where('id', $id)->delete();
            });

            return response()->json(['ok' => true]);
        } catch (LinkException $error) {
            return response()->json(['error' => $error->getMessage()], $error->status);
        }
    }

    private function query(Request $request): Builder
    {
        return DB::table('saved_link_filters')->where('workspace_id', UvhRequest::workspaceId($request))->where('user_id', UvhRequest::user($request)->id);
    }
}
