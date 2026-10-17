<?php

namespace App\Http\Controllers;

use App\Exceptions\LinkException;
use App\Support\Audit;
use App\Support\DomainReassignment;
use App\Support\Idempotency;
use App\Support\LinkVersioning;
use App\Support\UvhRequest;
use App\Support\WebhookService;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

final class DomainRemovalController
{
    public function deletionPreview(Request $request, int $id): JsonResponse
    {
        try {
            return DB::transaction(function () use ($request, $id): JsonResponse {
                DomainReassignment::authorize($request);

                return response()->json(DomainReassignment::impact(DomainReassignment::source(UvhRequest::workspaceId($request), $id)));
            });
        } catch (LinkException $e) {
            return response()->json(['error' => $e->getMessage()], $e->status);
        }
    }

    public function preview(Request $request, int $id): JsonResponse
    {
        return $this->reviewOrApply($request, $id, false);
    }

    public function reassign(Request $request, int $id): JsonResponse
    {
        return $this->reviewOrApply($request, $id, true);
    }

    private function reviewOrApply(Request $request, int $id, bool $apply): JsonResponse
    {
        try {
            $ids = DomainReassignment::linkIds($request->input('linkIds'));
            $target = $request->input('targetDomainId');
            if (! $request->exists('targetDomainId') || ($target !== null && (! is_int($target) || $target < 1))) {
                throw new LinkException(__('messages.error_6cb72695ed3a51'), 422);
            }
            $versions = $apply ? DomainReassignment::versions($request->input('expectedVersions'), $ids) : null;
            $key = $request->header('Idempotency-Key');
            if ($apply && ! Idempotency::validateKey($key)['ok']) {
                throw new LinkException(__('messages.error_23fa3c35b27b1b'), 422);
            }

            return DB::transaction(function () use ($request, $id, $apply, $ids, $target, $versions, $key): JsonResponse {
                $user = DomainReassignment::authorize($request);
                $workspaceId = UvhRequest::workspaceId($request);
                $scope = 'domains.reassign:'.$workspaceId.':'.$id;
                $hash = Idempotency::hash($request->getContent());
                $lease = '';
                if ($apply) {
                    $begin = Idempotency::begin((int) $user->id, $scope, (string) $key, $hash);
                    if ($begin['state'] === 'replay') {
                        return response()->json($begin['body'], $begin['status'])->header('Idempotent-Replay', 'true');
                    }
                    if ($begin['state'] !== 'fresh') {
                        throw new LinkException(__('messages.error_e3832629a8f3ef'), 409);
                    }
                    $lease = (string) $begin['lease'];
                    Idempotency::renew((int) $user->id, $scope, (string) $key, $hash, $lease);
                }
                $prepared = DomainReassignment::prepare($workspaceId, $id, $ids, $target, $versions);
                if (! $apply) {
                    return response()->json($prepared['preview']);
                }
                if (! $prepared['preview']['canApply']) {
                    throw new LinkException(__('messages.error_1a9c43a0582817'), 409);
                }
                $events = [];
                foreach ($prepared['links'] as $link) {
                    $before = LinkVersioning::configuration($link);
                    $link->update(['domain_id' => $target, 'version' => (int) $link->version + 1, 'updated_at' => now()]);
                    LinkVersioning::capture($link, (int) $user->id, 'bulk', $before);
                    $events[] = ['event' => 'link.updated', 'data' => ['linkId' => (int) $link->id, 'alias' => $link->alias]];
                }
                WebhookService::dispatchMany($workspaceId, $events);
                Audit::write((int) $user->id, 'link.bulk', 'link', null, [
                    'action' => 'set-domain', 'count' => count($ids), 'linkIds' => $ids,
                    'sourceDomainId' => $id, 'targetDomainId' => $target,
                ], UvhRequest::ip($request), workspaceId: $workspaceId);
                $body = ['ok' => true, 'applied' => count($ids), 'domainId' => $id, 'targetDomainId' => $target, 'linkIds' => $ids];
                Idempotency::commit((int) $user->id, $scope, (string) $key, $hash, 200, $body, $lease);

                return response()->json($body);
            });
        } catch (LinkException $e) {
            return response()->json(['error' => $e->getMessage()], $e->status);
        } catch (QueryException $e) {
            if (($e->errorInfo[0] ?? null) === '23505') {
                return response()->json(['error' => __('messages.error_4304d4a133d554')], 409);
            }
            throw $e;
        }
    }
}
