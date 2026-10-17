<?php

namespace App\Http\Controllers;

use App\Exceptions\LinkException;
use App\Models\Link;
use App\Models\LinkVersion;
use App\Support\AppOpening;
use App\Support\Idempotency;
use App\Support\IsoDate;
use App\Support\LinkService;
use App\Support\UvhRequest;
use App\Support\WorkspaceWriteActor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

final class LinkHistoryController
{
    public function index(Request $request, int $id): JsonResponse
    {
        if (! config('workflows.link_history', true)) {
            return response()->json(['error' => __('messages.error_082a2b7ba08855')], 404);
        }
        $workspaceId = UvhRequest::workspaceId($request);
        $link = Link::where('id', $id)->where('workspace_id', $workspaceId)->first();
        if (! $link) {
            return response()->json(['error' => __('messages.error_56cb73fa20e635')], 404);
        }
        $source = $request->query('source');
        if ($source !== null && (! is_string($source) || ! in_array($source, ['create', 'update', 'duplicate', 'restore', 'import', 'bulk'], true))) {
            return response()->json(['error' => __('messages.error_937be38ad1aa7f')], 422);
        }
        $perPage = min(50, max(1, (int) $request->query('perPage', 20)));
        $versions = LinkVersion::with('actor:id,name')
            ->where('workspace_id', $workspaceId)
            ->where('link_id', $id)
            ->when($source !== null, fn ($query) => $query->where('source', $source))
            ->orderByDesc('revision')
            ->paginate($perPage);

        return response()->json([
            'versions' => $versions->getCollection()->map(fn (LinkVersion $version) => $this->summary($version))->values(),
            'page' => $versions->currentPage(), 'perPage' => $versions->perPage(), 'lastPage' => $versions->lastPage(),
        ]);
    }

    public function show(Request $request, int $id, int $revision): JsonResponse
    {
        if (! config('workflows.link_history', true)) {
            return response()->json(['error' => __('messages.error_082a2b7ba08855')], 404);
        }
        $version = $this->version($request, $id, $revision);

        return response()->json($this->detail($version));
    }

    public function compare(Request $request, int $id): JsonResponse
    {
        if (! config('workflows.link_history', true)) {
            return response()->json(['error' => __('messages.error_082a2b7ba08855')], 404);
        }
        $from = (int) $request->query('from');
        $to = (int) $request->query('to');
        if ($from < 1 || $to < 1 || $from === $to) {
            return response()->json(['error' => __('messages.error_e4fcf07431a98d')], 422);
        }
        $left = $this->version($request, $id, $from);
        $right = $this->version($request, $id, $to);
        $before = $left->configuration ?? [];
        $after = $right->configuration ?? [];
        $fields = [];
        foreach (array_unique([...array_keys($before), ...array_keys($after)]) as $field) {
            $old = $before[$field] ?? null;
            $new = $after[$field] ?? null;
            if ($field === 'rules' && is_array($old) && is_array($new)) {
                $count = max(count($old), count($new));
                for ($index = 0; $index < $count; $index++) {
                    $oldRule = $old[$index] ?? null;
                    $newRule = $new[$index] ?? null;
                    if (json_encode($oldRule) !== json_encode($newRule)) {
                        $fields[] = ['field' => 'rules.'.($index + 1), 'before' => $oldRule, 'after' => $newRule];
                    }
                }

                continue;
            }
            if (json_encode($old) !== json_encode($new)) {
                $fields[] = ['field' => $field, 'before' => $old, 'after' => $new];
            }
        }

        return response()->json(['from' => $this->summary($left), 'to' => $this->summary($right), 'changes' => $fields]);
    }

    public function restore(Request $request, int $id, int $revision): JsonResponse
    {
        if (! config('workflows.link_history_restore', true)) {
            return response()->json(['error' => __('messages.error_082a2b7ba08855')], 404);
        }
        $workspaceId = UvhRequest::workspaceId($request);
        $user = UvhRequest::user($request);
        $version = $this->version($request, $id, $revision);
        $expected = $request->input('expectedVersion');
        if (! is_int($expected) || $expected < 1) {
            return response()->json(['error' => __('messages.error_d1a835c5bdca0b')], 422);
        }
        $key = $request->header('Idempotency-Key');
        $check = Idempotency::validateKey($key);
        if (! $check['ok']) {
            return response()->json(['error' => $check['error']], 422);
        }
        $scope = "links.history.restore:$workspaceId:$id:$revision";
        $hash = Idempotency::hash($request->getContent());
        $begin = Idempotency::begin((int) $user->id, $scope, $key, $hash);
        if ($begin['state'] === 'replay') {
            return response()->json($begin['body'] ?? [], $begin['status'] ?? 200);
        }
        if ($begin['state'] === 'mismatch') {
            return response()->json(['error' => __('messages.error_00fdaa8687d60f')], 409);
        }
        if ($begin['state'] === 'in_progress') {
            return response()->json(['error' => __('messages.error_1b829e52971b0c')], 409);
        }
        try {
            $configuration = $version->configuration ?? [];
            $input = [
                'destination' => $configuration['destination'] ?? '',
                'fallback_destination' => $configuration['fallbackDestination'] ?? null,
                'collection_id' => $configuration['collectionId'] ?? null,
                'name' => $configuration['name'] ?? null,
                'notes' => $configuration['notes'] ?? null,
                'max_clicks' => $configuration['maxClicks'] ?? null,
                'single_use' => $configuration['singleUse'] ?? false,
                'scheduled_at' => $configuration['scheduledAt'] ?? null,
                'expires_at' => $configuration['expiresAt'] ?? null,
                'expired_page' => $configuration['expiredPage'] ?? null,
                'utm' => $configuration['utm'] ?? [],
                'tags' => $configuration['tags'] ?? [],
                'rules' => $configuration['rules'] ?? [],
                'lifecycle_dates_changed' => true,
            ];
            if (array_key_exists('appOpening', $version->configuration ?? [])) {
                $input['app_opening'] = $version->configuration['appOpening'];
            }
            if (array_key_exists('socialPreview', $version->configuration ?? [])) {
                $input['social_preview'] = $version->configuration['socialPreview'];
            }
            $actor = WorkspaceWriteActor::fromRequest($request);
            $body = DB::transaction(function () use ($id, $workspaceId, $user, $input, $expected, $request, $actor, $scope, $key, $hash, $begin, $revision): array {
                if (! $actor->lockMembership((int) $user->id, $workspaceId, (int) $user->security_version)) {
                    throw new LinkException(__('messages.error_facd4117352b2b'), 403);
                }
                Idempotency::renew((int) $user->id, $scope, $key, $hash, $begin['lease']);
                $valid = LinkService::validate($input);
                if (! $valid['ok']) {
                    throw new LinkException($valid['error'] ?? __('display.display_dd7200728ad2d1'), 422);
                }
                LinkService::update($id, $workspaceId, (int) $user->id, $input, $expected, UvhRequest::apiToken($request), (int) $user->security_version, $actor, 'restore');
                $link = Link::with([AppOpening::domainRelation(), 'tags', 'collection'])->where('id', $id)->where('workspace_id', $workspaceId)->firstOrFail();
                $actor->auditLink('link.restore_version', $id, ['originRevision' => $revision, 'restoredFields' => array_keys($input)]);
                $body = ['link' => LinkService::dto($link), 'restoredRevision' => $revision];
                Idempotency::commit((int) $user->id, $scope, $key, $hash, 200, $body, $begin['lease']);

                return $body;
            });

            return response()->json($body);
        } catch (LinkException $error) {
            Idempotency::release((int) $user->id, $scope, $key, $begin['lease']);

            return response()->json(['error' => $error->getMessage()], $error->status);
        } catch (\Throwable $error) {
            Idempotency::release((int) $user->id, $scope, $key, $begin['lease']);
            throw $error;
        }
    }

    private function version(Request $request, int $id, int $revision): LinkVersion
    {
        $workspaceId = UvhRequest::workspaceId($request);
        $version = LinkVersion::with('actor:id,name')->where('link_id', $id)->where('workspace_id', $workspaceId)->where('revision', $revision)->first();
        if (! $version) {
            throw new LinkException(__('messages.error_90353dab4a2bcb'), 404);
        }

        return $version;
    }

    /** @return array<string, mixed> */
    private function summary(LinkVersion $version): array
    {
        return ['revision' => $version->revision, 'linkVersion' => $version->link_version, 'source' => $version->source, 'actor' => $version->actor?->name, 'changedFields' => $version->changed_fields ?? [], 'createdAt' => IsoDate::format($version->created_at)];
    }

    /** @return array<string, mixed> */
    private function detail(LinkVersion $version): array
    {
        return [...$this->summary($version), 'configuration' => $version->configuration ?? []];
    }
}
