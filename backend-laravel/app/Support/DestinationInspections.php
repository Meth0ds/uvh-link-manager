<?php

namespace App\Support;

use App\Exceptions\LinkException;
use App\Jobs\InspectDestinationJob;
use App\Models\Link;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;

final class DestinationInspections
{
    /** @return array<string, mixed> */
    public static function create(Request $request, ?int $linkId): array
    {
        self::enabled();

        return DB::transaction(function () use ($request, $linkId): array {
            $user = UvhRequest::user($request);
            $workspace = UvhRequest::workspaceId($request);
            if (! $user || ! $workspace) {
                throw new LinkException(__('messages.error_f279ddcf8a041c'), 403);
            }
            $context = SecurityContext::lock($user, UvhRequest::sessionId($request), true);
            if (! $context || ! WorkspaceAccess::getMembershipForContext($context, $workspace, $linkId === null ? 'editor' : 'viewer')) {
                throw new LinkException(__('messages.error_ecf7ae22fbd94f'), 403);
            }
            $mode = $linkId === null ? 'preview' : 'health';
            $link = null;
            if ($linkId !== null) {
                $link = Link::where('workspace_id', $workspace)->where('id', $linkId)->lockForUpdate()->first();
                if (! $link) {
                    throw new LinkException(__('messages.error_2f4bde2886e62b'), 404);
                }
                if (! is_int($request->input('linkVersion')) || $request->input('linkVersion') !== (int) $link->version) {
                    throw new LinkException(__('messages.error_d08dee8ddc9540'), 409);
                }
                $url = $link->destination;
            } else {
                $url = UvhRequest::inputString($request, 'url');
            }
            if (! UrlUtil::validateDestination($url)['ok']) {
                throw new LinkException(__('messages.error_325d5ada579aa2'), 422);
            }
            $url = explode('#', $url, 2)[0];
            $fingerprint = hash_hmac('sha256', 'inspection:v1:'.$mode.':'.($linkId ?? 'draft').':'.($link->version ?? 0).':'.$url, UvhCrypto::secret());
            $row = DB::table('destination_inspections')->where('workspace_id', $workspace)->where('user_id', $user->id)
                ->where('session_id', $context->session->id)->where('security_version', $user->security_version)
                ->where('fingerprint', $fingerprint)->where('expires_at', '>', now())->whereIn('status', ['pending', 'running', 'ready'])->first();
            if ($row && (! in_array($row->status, ['pending', 'running'], true) || strtotime($row->created_at) > now()->subSeconds(30)->timestamp)) {
                OperationalMetrics::increment('destination_inspection.cache_hit');

                return self::present($row);
            }
            $userKey = 'destination-inspection:user:'.$user->id;
            $workspaceKey = 'destination-inspection:workspace:'.$workspace;
            foreach ([[$userKey, (int) config('destination-inspections.user_per_minute', 10)], [$workspaceKey, (int) config('destination-inspections.workspace_per_minute', 30)]] as [$key, $limit]) {
                if (RateLimiter::tooManyAttempts($key, max(1, $limit))) {
                    throw new LinkException(__('messages.error_781a832feb9839'), 429);
                }
            }
            RateLimiter::hit($userKey, 60);
            RateLimiter::hit($workspaceKey, 60);
            $id = (string) Str::uuid();
            DB::table('destination_inspections')->insert([
                'id' => $id, 'workspace_id' => $workspace, 'user_id' => $user->id, 'session_id' => $context->session->id,
                'security_version' => $user->security_version, 'link_id' => $linkId, 'link_version' => $link?->version,
                'mode' => $mode, 'fingerprint' => $fingerprint, 'url_ciphertext' => UvhCrypto::encryptAtRest($url),
                'status' => 'pending', 'expires_at' => now()->addSeconds(min(600, max(30, (int) config('destination-inspections.cache_seconds', 600)))),
                'created_at' => now(), 'updated_at' => now(),
            ]);
            InspectDestinationJob::dispatch($id)->afterCommit();

            return self::present(DB::table('destination_inspections')->where('id', $id)->first());
        });
    }

    /** Return private per-session results only after live authority is locked. */
    public static function find(Request $request, string $id): object
    {
        self::enabled();

        return DB::transaction(function () use ($request, $id): object {
            $row = DB::table('destination_inspections')->where('id', $id)->where('user_id', UvhRequest::user($request)?->id)
                ->where('workspace_id', UvhRequest::workspaceId($request))->where('session_id', UvhRequest::sessionId($request))
                ->where('expires_at', '>', now())->first();
            if (! $row || ! self::authorized($row)) {
                throw new LinkException(__('messages.error_5b62a628e63745'), 404);
            }
            if (! self::currentLink($row)) {
                $row->status = 'stale';
                $row->result = null;
                $row->icon_ciphertext = null;
            } elseif (in_array($row->status, ['pending', 'running'], true) && strtotime($row->created_at) <= now()->subSeconds(30)->timestamp) {
                $row->status = 'stale';
            }

            return $row;
        });
    }

    public static function execute(string $id, DestinationInspector $inspector): void
    {
        if (! config('workflows.enabled', false)) {
            return;
        }
        $row = DB::transaction(function () use ($id): ?object {
            $row = DB::table('destination_inspections')->where('id', $id)->where('status', 'pending')->where('expires_at', '>', now())->where('created_at', '>', now()->subSeconds(30))->first();

            if (! $row || ! self::authorized($row) || ! self::currentLink($row)) {
                return null;
            }
            // Claim once under the established account/session/workspace lock
            // order. Broker redelivery must not make a second remote request.
            $claimed = DB::table('destination_inspections')->where('id', $id)->where('status', 'pending')->lockForUpdate()->first();
            if (! $claimed) {
                return null;
            }
            DB::table('destination_inspections')->where('id', $id)->update(['status' => 'running', 'updated_at' => now()]);

            return $claimed;
        });
        if (! $row) {
            OperationalMetrics::increment('destination_inspection.stale');

            return;
        }
        $started = microtime(true);
        $outcome = $inspector->inspect(UvhCrypto::decryptAtRest($row->url_ciphertext), $row->mode);
        $duration = max(1, (int) round((microtime(true) - $started) * 1000));
        $metrics = ['destination_inspection.completed' => 1, 'destination_inspection.duration_ms' => min(1000000, $duration),
            'destination_inspection.'.$outcome['result']['status'] => 1, 'destination_inspection.le_inf' => 1];
        foreach ([250, 1000, 3000, 8000] as $bound) {
            if ($duration <= $bound) {
                $metrics['destination_inspection.le_'.$bound] = 1;
            }
        }
        OperationalMetrics::incrementBatch($metrics);
        DB::transaction(function () use ($id, $outcome): void {
            $row = DB::table('destination_inspections')->where('id', $id)->where('status', 'running')->where('expires_at', '>', now())->where('created_at', '>', now()->subSeconds(30))->first();
            if (! $row) {
                return;
            }
            if (! self::authorized($row) || ! self::currentLink($row)) {
                OperationalMetrics::increment('destination_inspection.stale');
                DB::table('destination_inspections')->where('id', $id)->delete();

                return;
            }
            $result = $outcome['result'];
            if ($outcome['icon'] !== null) {
                $result['iconUrl'] = '/api/v1/destination-inspections/'.$id.'/icon';
            }
            DB::table('destination_inspections')->where('id', $id)->where('status', 'running')->update([
                'status' => 'ready', 'result' => json_encode($result, JSON_THROW_ON_ERROR),
                'icon_ciphertext' => $outcome['icon'] === null ? null : UvhCrypto::encryptAtRest(base64_encode($outcome['icon'])),
                'updated_at' => now(),
            ]);
        });
    }

    /** @return array<string, mixed> */
    public static function present(object $row): array
    {
        return ['id' => $row->id, 'status' => $row->status === 'running' ? 'pending' : $row->status, 'result' => $row->status === 'ready' && is_string($row->result ?? null) ? json_decode($row->result, true, 16, JSON_THROW_ON_ERROR) : null];
    }

    private static function enabled(): void
    {
        if (! config('workflows.enabled', false)) {
            throw new LinkException(__('messages.error_3f80b725d8fbb6'), 404);
        }
    }

    private static function authorized(object $row): bool
    {
        $user = User::where('id', $row->user_id)->first();
        if (! $user || (int) $user->security_version !== (int) $row->security_version) {
            return false;
        }
        $context = SecurityContext::lock($user, $row->session_id, true);

        return $context !== null && WorkspaceAccess::getMembershipForContext($context, (int) $row->workspace_id, $row->mode === 'preview' ? 'editor' : 'viewer') !== null;
    }

    private static function currentLink(object $row): bool
    {
        if ($row->link_id === null) {
            return true;
        }
        $link = Link::where('id', $row->link_id)->where('workspace_id', $row->workspace_id)->lockForUpdate()->first();

        return $link !== null && (int) $link->version === (int) $row->link_version;
    }
}
