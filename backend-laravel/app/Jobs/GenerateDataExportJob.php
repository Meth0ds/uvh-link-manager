<?php

namespace App\Jobs;

use App\Models\DataExportRequest;
use App\Models\User;
use App\Support\Audit;
use App\Support\Ids;
use App\Support\OperationalMetrics;
use App\Support\PrivateArtifactCleanup;
use App\Support\UvhCrypto;
use App\Support\UvhMail;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

class GenerateDataExportJob implements ShouldQueue
{
    use Dispatchable;
    use Queueable;

    public int $tries = 3;

    public int $timeout = 120;

    /** @var array<int, int> */
    public array $backoff = [60, 300];

    // AES-GCM and Base64URL each require another in-memory representation.
    // Keep the plaintext well below the 256 MiB production worker ceiling.
    private const MAX_JSON_BYTES = 12 * 1024 * 1024;

    /** Keep the automated export bounded before hydrating large collections. */
    private const MAX_EXPORT_ROWS = 10_000;

    private const REQUIRED_MEMORY_HEADROOM = 96 * 1024 * 1024;

    public function __construct(public readonly int $requestId)
    {
        $this->onQueue('exports');
    }

    public function handle(): void
    {
        $snapshot = DataExportRequest::where('id', $this->requestId)
            ->where('status', 'processing')->first(['id', 'user_id']);
        if (! $snapshot) {
            return;
        }

        // Persist the randomized path before writing. A worker crash can then
        // be recovered by housekeeping even if no byte reached the volume.
        $artifactPath = 'account-exports/'.Ids::randomToken(24).'.uvh';
        $start = DB::transaction(function () use ($snapshot): array {
            $user = User::where('id', $snapshot->user_id)->lockForUpdate()->first();
            $request = DataExportRequest::where('id', $snapshot->id)
                ->where('user_id', $snapshot->user_id)->lockForUpdate()->first();
            if (! $request || $request->status !== 'processing') {
                return ['status' => 'stale', 'path' => null];
            }
            $oldPath = is_string($request->artifact_path) && $request->artifact_path !== ''
                ? $request->artifact_path
                : null;
            if (! $user || $user->deleted_at
                || (int) $user->security_version !== (int) $request->security_version) {
                $request->update(['status' => 'cancelled']);

                return ['status' => 'cancelled', 'path' => $oldPath];
            }

            return [
                'status' => 'ok',
                'path' => $oldPath,
                'user_id' => (int) $user->id,
                'request_id' => (int) $request->id,
            ];
        });
        if (is_string($start['path']) && $start['path'] !== '') {
            $cleaned = PrivateArtifactCleanup::attempt((int) $snapshot->id, $start['path']);
            if ($start['status'] === 'ok' && ! $cleaned) {
                throw new \RuntimeException('Previous private export artifact could not be cleaned');
            }
        }
        if ($start['status'] !== 'ok') {
            return;
        }

        $userId = $start['user_id'];
        $requestId = $start['request_id'];

        $registered = DB::transaction(function () use ($requestId, $userId, $artifactPath): bool {
            $lockedUser = User::where('id', $userId)->lockForUpdate()->first();
            $lockedRequest = DataExportRequest::where('id', $requestId)
                ->where('user_id', $userId)->lockForUpdate()->first();
            if (! $lockedRequest || $lockedRequest->status !== 'processing' || ! $lockedUser
                || $lockedUser->deleted_at
                || (int) $lockedUser->security_version !== (int) $lockedRequest->security_version
                || $lockedRequest->artifact_path !== null) {
                return false;
            }
            $lockedRequest->update(['artifact_path' => $artifactPath, 'updated_at' => now()]);

            return true;
        });
        if (! $registered) {
            return;
        }

        // The final JSON byte limit is not enough on its own: hydrating several
        // million analytics rows can exhaust a worker before json_encode() ever
        // measures the payload. Large cases stay available through the managed
        // privacy-rights workflow instead of destabilising the shared queue.
        try {
            if (! $this->hasMemoryHeadroom(self::REQUIRED_MEMORY_HEADROOM)) {
                OperationalMetrics::increment('export.memory_budget_rejected');
                $payload = null;
            } else {
                $payload = $this->buildConsistentPayload($userId);
            }
        } catch (\Throwable) {
            PrivateArtifactCleanup::attempt($requestId, $artifactPath);
            throw new \RuntimeException('No se pudo generar la exportación de datos');
        }

        if ($payload === null) {
            $failed = DB::transaction(function () use ($requestId, $userId, $artifactPath): bool {
                User::where('id', $userId)->lockForUpdate()->first();
                $request = DataExportRequest::where('id', $requestId)
                    ->where('user_id', $userId)->lockForUpdate()->first();
                if (! $request || $request->status !== 'processing'
                    || ! is_string($request->artifact_path)
                    || ! hash_equals($artifactPath, $request->artifact_path)) {
                    return false;
                }
                $request->update([
                    'status' => 'failed',
                    'artifact_path' => null,
                    'confirmation_token_hash' => null,
                    'download_token_hash' => null,
                    'updated_at' => now(),
                ]);

                return true;
            });
            if ($failed) {
                OperationalMetrics::increment('export.too_large');
                Audit::write($userId, 'account.data_export_failed', 'data_export', $requestId, [
                    'reason' => 'automated_size_limit',
                ]);
            }

            return;
        }

        try {
            if (! $this->hasMemoryHeadroom(self::REQUIRED_MEMORY_HEADROOM)) {
                throw new \RuntimeException('Insufficient memory headroom for export encoding');
            }
            $json = json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
            // Release the database snapshot's materialized rows before allocating
            // ciphertext; keeping all three representations inflates peak memory.
            unset($payload);
            if (strlen($json) > self::MAX_JSON_BYTES) {
                throw new \RuntimeException('Export exceeds automated size limit');
            }
            $encrypted = UvhCrypto::encryptAtRest($json);
            if (! Storage::disk('local')->put($artifactPath, $encrypted)) {
                throw new \RuntimeException('Private artifact storage rejected write');
            }
            unset($json, $encrypted);

            // Recheck the account/request after generation. A password/email/MFA
            // rotation while the job was running invalidates this export.
            $eligible = DB::transaction(function () use ($requestId, $userId, $artifactPath): bool {
                $lockedUser = User::where('id', $userId)->lockForUpdate()->first();
                $lockedRequest = DataExportRequest::where('id', $requestId)
                    ->where('user_id', $userId)->lockForUpdate()->first();
                if ($lockedRequest?->status !== 'processing' || ! $lockedUser
                    || $lockedUser->deleted_at
                    || (int) $lockedUser->security_version !== (int) $lockedRequest->security_version
                    || ! is_string($lockedRequest->artifact_path)
                    || ! hash_equals($artifactPath, $lockedRequest->artifact_path)) {
                    return false;
                }

                return true;
            });
            if (! $eligible) {
                PrivateArtifactCleanup::attempt($requestId, $artifactPath);

                return;
            }

            $downloadToken = Ids::randomToken(32);
            $url = rtrim((string) config('app.url'), '/').'/auth/download-export#token='.rawurlencode($downloadToken);
            $madeReady = DB::transaction(function () use ($requestId, $userId, $artifactPath, $downloadToken, $url): bool {
                $lockedUser = User::where('id', $userId)->lockForUpdate()->first();
                $lockedRequest = DataExportRequest::where('id', $requestId)
                    ->where('user_id', $userId)->lockForUpdate()->first();
                if (! $lockedRequest || $lockedRequest->status !== 'processing' || ! $lockedUser
                    || $lockedUser->deleted_at
                    || (int) $lockedUser->security_version !== (int) $lockedRequest->security_version
                    || ! is_string($lockedRequest->artifact_path)
                    || ! hash_equals($artifactPath, $lockedRequest->artifact_path)) {
                    return false;
                }
                // The encrypted outbox row commits with the matching bearer;
                // its generation hash prevents stale-job compensation.
                if (! UvhMail::dataExportReady(
                    $lockedUser->email,
                    $url,
                    (int) $lockedRequest->id,
                    Ids::sha256Hex($downloadToken),
                )) {
                    throw new \RuntimeException('Ready email queue admission failed');
                }
                $now = now();
                $lockedRequest->update([
                    'status' => 'ready',
                    'artifact_path' => $artifactPath,
                    'download_token_hash' => Ids::sha256Hex($downloadToken),
                    'download_expires_at' => $now->copy()->addDay(),
                    'ready_at' => $now,
                ]);

                return true;
            });
            if (! $madeReady) {
                PrivateArtifactCleanup::attempt($requestId, $artifactPath);

                return;
            }

            Audit::write($userId, 'account.data_export_ready', 'data_export', $requestId);
        } catch (\Throwable) {
            PrivateArtifactCleanup::attempt($requestId, $artifactPath);
            throw new \RuntimeException('No se pudo generar la exportación de datos');
        }
    }

    /**
     * Read the size budget and every export section from one PostgreSQL
     * snapshot. The transaction is deliberately read-only and ends before JSON
     * encoding, encryption, filesystem I/O or mail admission.
     *
     * @return array<string, mixed>|null Null means the automated row budget was exceeded.
     */
    private function buildConsistentPayload(int $userId): ?array
    {
        return DB::transaction(function () use ($userId): ?array {
            DB::statement('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
            if (! $this->withinAutomatedRowBudget($userId)) {
                return null;
            }

            return $this->buildPayload($userId);
        });
    }

    public function failed(\Throwable $exception): void
    {
        $snapshot = DataExportRequest::where('id', $this->requestId)->first(['id', 'user_id']);
        if (! $snapshot) {
            return;
        }
        $result = DB::transaction(function () use ($snapshot): ?array {
            User::where('id', $snapshot->user_id)->lockForUpdate()->first();
            $request = DataExportRequest::where('id', $snapshot->id)
                ->where('user_id', $snapshot->user_id)->lockForUpdate()->first();
            if (! $request || ! in_array($request->status, ['requested', 'processing'], true)) {
                return null;
            }
            $path = is_string($request->artifact_path) && $request->artifact_path !== ''
                ? $request->artifact_path
                : null;
            $request->update([
                'status' => 'failed',
                'confirmation_token_hash' => null,
                'download_token_hash' => null,
            ]);

            return ['path' => $path, 'user_id' => (int) $request->user_id, 'request_id' => (int) $request->id];
        });
        if (! $result) {
            return;
        }
        if (is_string($result['path']) && $result['path'] !== '') {
            PrivateArtifactCleanup::attempt($result['request_id'], $result['path']);
        }
        Audit::write($result['user_id'], 'account.data_export_failed', 'data_export', $result['request_id']);
    }

    /** @return array<string, mixed> */
    private function buildPayload(int $userId): array
    {
        $account = DB::table('users')->where('id', $userId)->first([
            'id', 'email', 'name', 'email_verified_at', 'mfa_enabled', 'created_at', 'updated_at',
        ]);
        $memberships = DB::table('memberships')
            ->join('workspaces', 'workspaces.id', '=', 'memberships.workspace_id')
            ->where('memberships.user_id', $userId)
            ->orderBy('memberships.id')
            ->limit(self::MAX_EXPORT_ROWS + 1)
            ->get([
                'memberships.workspace_id', 'workspaces.name as workspace_name', 'workspaces.slug as workspace_slug',
                'memberships.role', 'memberships.created_at',
            ]);
        $links = DB::table('links')->where('created_by', $userId)->orderBy('id')
            ->limit(self::MAX_EXPORT_ROWS + 1)
            ->get([
                'id', 'workspace_id', 'domain_id', 'alias', 'destination', 'fallback_destination', 'state',
                'max_clicks', 'click_count', 'single_use', 'used_at', 'scheduled_at', 'expires_at', 'notes',
                'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'created_at', 'updated_at', 'deleted_at',
            ]);
        $rules = DB::table('redirect_rules')
            ->join('links', 'links.id', '=', 'redirect_rules.link_id')
            ->where('links.created_by', $userId)
            ->orderBy('redirect_rules.id')
            ->limit(self::MAX_EXPORT_ROWS + 1)
            ->get([
                'redirect_rules.id', 'redirect_rules.link_id', 'redirect_rules.priority', 'redirect_rules.country',
                'redirect_rules.language', 'redirect_rules.device', 'redirect_rules.os', 'redirect_rules.time_from',
                'redirect_rules.time_to', 'redirect_rules.referrer', 'redirect_rules.campaign',
                'redirect_rules.destination', 'redirect_rules.created_at',
            ]);
        $tags = DB::table('link_tags')
            ->join('links', 'links.id', '=', 'link_tags.link_id')
            ->join('tags', 'tags.id', '=', 'link_tags.tag_id')
            ->where('links.created_by', $userId)
            ->orderBy('link_tags.link_id')->orderBy('tags.id')
            ->limit(self::MAX_EXPORT_ROWS + 1)
            ->get(['link_tags.link_id', 'tags.name']);
        $analytics = DB::table('metric_rollups')
            ->join('links', 'links.id', '=', 'metric_rollups.link_id')
            ->where('links.created_by', $userId)
            ->orderBy('metric_rollups.day')->orderBy('metric_rollups.link_id')
            ->limit(self::MAX_EXPORT_ROWS + 1)
            ->get([
                'metric_rollups.link_id', 'metric_rollups.day', 'metric_rollups.clicks', 'metric_rollups.visitors',
                'metric_rollups.countries', 'metric_rollups.devices', 'metric_rollups.browsers',
                'metric_rollups.os', 'metric_rollups.referrers', 'metric_rollups.campaigns',
            ]);
        $tokens = DB::table('api_tokens')->where('created_by', $userId)->orderBy('id')
            ->limit(self::MAX_EXPORT_ROWS + 1)
            ->get([
                'id', 'workspace_id', 'name', 'scopes', 'last_used_at', 'expires_at', 'revoked_at', 'created_at',
            ]);
        $ownedDomains = DB::table('custom_domains')
            ->join('workspaces', 'workspaces.id', '=', 'custom_domains.workspace_id')
            ->where('workspaces.owner_user_id', $userId)
            ->orderBy('custom_domains.id')
            ->limit(self::MAX_EXPORT_ROWS + 1)
            ->get([
                'custom_domains.id', 'custom_domains.workspace_id', 'custom_domains.domain', 'custom_domains.state',
                'custom_domains.verified_at', 'custom_domains.created_at', 'custom_domains.updated_at',
            ]);
        $ownedWebhooks = DB::table('webhooks')
            ->join('workspaces', 'workspaces.id', '=', 'webhooks.workspace_id')
            ->where('workspaces.owner_user_id', $userId)
            ->orderBy('webhooks.id')
            ->limit(self::MAX_EXPORT_ROWS + 1)
            ->get([
                'webhooks.id', 'webhooks.workspace_id', 'webhooks.url', 'webhooks.events',
                'webhooks.active', 'webhooks.created_at', 'webhooks.updated_at',
            ])->map(function ($webhook) {
                $parts = parse_url((string) $webhook->url);
                $hadSensitiveUrlParts = is_array($parts) && (isset($parts['query']) || isset($parts['user']) || isset($parts['pass']));
                $host = is_array($parts) ? ($parts['host'] ?? null) : null;
                if (is_string($host) && filter_var($host, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6)) {
                    $host = '['.$host.']';
                }
                $webhook->url = is_array($parts) && isset($parts['scheme'], $parts['host'])
                    ? $parts['scheme'].'://'.$host.(isset($parts['port']) ? ':'.$parts['port'] : '').($parts['path'] ?? '/')
                    : null;
                $webhook->urlCredentialsOrQueryRedacted = $hadSensitiveUrlParts;

                return $webhook;
            });
        $audit = DB::table('audit_events')->where('user_id', $userId)->orderBy('id')
            ->limit(self::MAX_EXPORT_ROWS + 1)
            ->get([
                'id', 'action', 'resource_type', 'resource_id', 'created_at',
            ]);
        $privacyRequests = DB::table('privacy_rights_requests')->where('user_id', $userId)->orderBy('id')
            ->limit(self::MAX_EXPORT_ROWS + 1)
            ->get([
                'id', 'type', 'status', 'identity_verified_at', 'acknowledged_at', 'due_at',
                'extended_until', 'extension_reason_code', 'completed_at', 'cancelled_at',
                'created_at', 'updated_at',
            ]);
        $privacyMessages = DB::table('privacy_rights_messages as m')
            ->join('privacy_rights_requests as r', 'r.id', '=', 'm.request_id')
            ->where('r.user_id', $userId)
            ->orderBy('m.request_id')->orderBy('m.created_at')->orderBy('m.id')
            ->limit(self::MAX_EXPORT_ROWS + 1)
            ->get(['m.id', 'm.request_id', 'm.author_role', 'm.encrypted_body', 'm.created_at'])
            ->map(function ($message) {
                try {
                    $message->body = UvhCrypto::decryptAtRest((string) $message->encrypted_body);
                    $message->bodyUnavailable = false;
                } catch (\Throwable) {
                    // Preserve the record and its chronology without exposing
                    // ciphertext or failing every other section of the export.
                    $message->body = null;
                    $message->bodyUnavailable = true;
                    OperationalMetrics::increment('privacy.decrypt_failed');
                }
                unset($message->encrypted_body);

                return $message;
            });
        $legalAcceptances = DB::table('legal_acceptances')->where('user_id', $userId)
            ->orderBy('accepted_at')->orderBy('id')
            ->limit(self::MAX_EXPORT_ROWS + 1)
            ->get(['document_type', 'version', 'source', 'accepted_at']);

        return [
            'format' => 'uvh-account-export-v1',
            'generatedAt' => now()->toIso8601String(),
            'scope' => [
                'account data and memberships',
                'links created by the account, including rules, tags and aggregate analytics',
                'API token metadata without token hashes or bearer secrets',
                'domain and webhook configuration for owned workspaces without verification/signing secrets',
                'account audit action metadata without IP-derived identifiers',
                'privacy-rights cases and messages addressed to this account without staff identifiers',
                'legal document versions accepted or acknowledged by this account',
            ],
            'account' => $account,
            'memberships' => $memberships,
            'createdLinks' => $links,
            'redirectRules' => $rules,
            'linkTags' => $tags,
            'aggregateAnalytics' => $analytics,
            'aggregateAnalyticsDefinition' => [
                // A rollup visitor is a daily rotating pseudonym. The same
                // browser may appear once on each day and is never claimed as
                // a unique person across the exported period.
                'visitors' => 'distinct_daily_pseudonyms',
                'crossDayIdentity' => false,
            ],
            'apiTokenMetadata' => $tokens,
            'ownedWorkspaceDomains' => $ownedDomains,
            'ownedWorkspaceWebhooks' => $ownedWebhooks,
            'accountAuditTrail' => $audit,
            'privacyRightsRequests' => $privacyRequests,
            'privacyRightsMessages' => $privacyMessages,
            'legalAcceptances' => $legalAcceptances,
        ];
    }

    /**
     * Bound the total number of rows hydrated by the automated path. Counts are
     * intentionally capped by selecting only IDs, avoiding an expensive full
     * COUNT over multi-million-row analytics joins.
     */
    private function withinAutomatedRowBudget(int $userId): bool
    {
        $sections = [
            [DB::table('memberships')->where('user_id', $userId), 'id'],
            [DB::table('links')->where('created_by', $userId), 'id'],
            [DB::table('redirect_rules')->join('links', 'links.id', '=', 'redirect_rules.link_id')
                ->where('links.created_by', $userId), 'redirect_rules.id'],
            [DB::table('link_tags')->join('links', 'links.id', '=', 'link_tags.link_id')
                ->where('links.created_by', $userId), 'link_tags.link_id'],
            [DB::table('metric_rollups')->join('links', 'links.id', '=', 'metric_rollups.link_id')
                ->where('links.created_by', $userId), 'metric_rollups.id'],
            [DB::table('api_tokens')->where('created_by', $userId), 'id'],
            [DB::table('custom_domains')->join('workspaces', 'workspaces.id', '=', 'custom_domains.workspace_id')
                ->where('workspaces.owner_user_id', $userId), 'custom_domains.id'],
            [DB::table('webhooks')->join('workspaces', 'workspaces.id', '=', 'webhooks.workspace_id')
                ->where('workspaces.owner_user_id', $userId), 'webhooks.id'],
            [DB::table('audit_events')->where('user_id', $userId), 'id'],
            [DB::table('privacy_rights_requests')->where('user_id', $userId), 'id'],
            [DB::table('privacy_rights_messages as m')
                ->join('privacy_rights_requests as r', 'r.id', '=', 'm.request_id')
                ->where('r.user_id', $userId), 'm.id'],
            [DB::table('legal_acceptances')->where('user_id', $userId), 'id'],
        ];

        $remaining = self::MAX_EXPORT_ROWS;
        foreach ($sections as [$query, $column]) {
            $rows = (clone $query)->limit($remaining + 1)->pluck($column)->count();
            if ($rows > $remaining) {
                return false;
            }
            $remaining -= $rows;
        }

        return true;
    }

    /**
     * Refuse the bounded automated path before PHP approaches a fatal OOM.
     * An unlimited CLI memory setting is accepted, while suffixes are parsed
     * conservatively and malformed limits fail closed.
     */
    private function hasMemoryHeadroom(int $requiredBytes): bool
    {
        $raw = trim((string) ini_get('memory_limit'));
        if ($raw === '-1') {
            return true;
        }
        if (preg_match('/^(\d+)([KMG]?)$/iD', $raw, $matches) !== 1) {
            return false;
        }
        $multiplier = match (strtoupper($matches[2])) {
            'G' => 1024 * 1024 * 1024,
            'M' => 1024 * 1024,
            'K' => 1024,
            default => 1,
        };
        $limit = (int) $matches[1] * $multiplier;

        return $limit > 0 && ($limit - memory_get_usage(true)) >= $requiredBytes;
    }
}
