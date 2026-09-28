<?php

namespace App\Http\Controllers;

use App\Jobs\ProvisionDomainTlsJob;
use App\Jobs\VerifyDomainDnsJob;
use App\Models\CustomDomain;
use App\Models\Link;
use App\Support\Audit;
use App\Support\DestinationDenylist;
use App\Support\DomainAdmission;
use App\Support\DomainClaims;
use App\Support\DomainEvents;
use App\Support\DomainRevalidationSchedule;
use App\Support\DomainStatus;
use App\Support\Idempotency;
use App\Support\Ids;
use App\Support\IsoDate;
use App\Support\OperationalMetrics;
use App\Support\ProductionSecurity;
use App\Support\UrlUtil;
use App\Support\UvhRequest;
use App\Support\WorkspaceAccess;
use App\Support\WorkspaceLimits;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

class DomainController
{
    private const MAX_DOMAINS_PER_WORKSPACE = WorkspaceLimits::DOMAINS;

    private const VERIFICATION_LOCK_SECONDS = 600;

    public function index(Request $request)
    {
        $workspaceId = UvhRequest::workspaceId($request);
        $includeChallenge = $this->canReadChallenge($request);
        $domains = CustomDomain::where('workspace_id', $workspaceId)
            ->orderByDesc('created_at')
            ->get();
        // One grouped count instead of one query per row: the impact of a
        // domain going down is its links, so the list shows it up front.
        $counts = DB::table('links')
            ->whereIn('domain_id', $domains->pluck('id'))
            ->whereNull('deleted_at')
            ->groupBy('domain_id')
            ->selectRaw('domain_id, COUNT(*) AS total')
            ->pluck('total', 'domain_id');

        return response()->json([
            'domains' => $domains->map(fn ($d) => $this->dto($d, $includeChallenge, (int) ($counts[$d->id] ?? 0))),
        ]);
    }

    /**
     * Return one workspace-scoped diagnostic snapshot.
     *
     * The ownership challenge token is projected only for callers that may
     * change DNS configuration — a `domains:read` token reads health, not
     * secrets. The record host and the CNAME target are not secrets and every
     * member may see them to debug their DNS.
     */
    public function show(Request $request, int $id)
    {
        $domain = CustomDomain::where('workspace_id', UvhRequest::workspaceId($request))
            ->where('id', $id)
            ->first();
        if (! $domain) {
            return response()->json(['error' => 'Dominio no encontrado'], 404);
        }

        return response()->json([
            'domain' => $this->dto($domain, $this->canReadChallenge($request)),
        ]);
    }

    /**
     * The domain's own history: what was checked, when it degraded, when it
     * recovered. Same rows the integrations receive, so the timeline a human
     * reads and the events a webhook got cannot disagree.
     */
    public function activity(Request $request, int $id)
    {
        $domain = CustomDomain::where('workspace_id', UvhRequest::workspaceId($request))
            ->where('id', $id)
            ->first();
        if (! $domain) {
            return response()->json(['error' => 'Dominio no encontrado'], 404);
        }

        $events = DB::table('domain_events')
            ->where('workspace_id', $domain->workspace_id)
            ->where('domain_id', $domain->id)
            ->orderByDesc('id')
            ->limit(50)
            ->get()
            ->map(fn ($e) => [
                'id' => (int) $e->id,
                'event' => (string) $e->event,
                'payload' => json_decode((string) $e->payload, true),
                'createdAt' => IsoDate::format($e->created_at),
            ]);

        return response()->json(['events' => $events]);
    }

    /**
     * The visitor-facing behaviour of the hostname: where `/` forwards and
     * what an unknown path gets. Same rules as a link destination — the URL
     * must be safe to send a browser to.
     */
    public function update(Request $request, int $id): JsonResponse
    {
        $workspaceId = UvhRequest::workspaceId($request);
        $user = UvhRequest::user($request);
        $apiTokenContext = UvhRequest::apiToken($request);
        // Presence flags, not null-checks: an explicit null/empty *clears* the
        // root destination, and an absent key must not.
        $hasRootInput = $request->has('rootDestination');
        $hasModeInput = $request->has('notFoundMode');
        // The default-domain flag follows the same presence-flag contract: an
        // absent key must not touch the preference.
        $hasDefaultInput = $request->has('isDefault');
        $rootDestination = $request->input('rootDestination');
        $notFoundMode = $request->input('notFoundMode');
        $isDefault = $request->input('isDefault');
        if ($hasDefaultInput && ! is_bool($isDefault)) {
            return response()->json(['error' => 'Datos inválidos'], 422);
        }

        if ($hasRootInput) {
            if ($rootDestination !== null && ! is_string($rootDestination)) {
                return response()->json(['error' => 'Datos inválidos'], 422);
            }
            $rootDestination = is_string($rootDestination) ? trim($rootDestination) : null;
            if ($rootDestination === '') {
                $rootDestination = null;
            } elseif ($rootDestination !== null) {
                $valid = UrlUtil::validateDestination($rootDestination);
                if (! $valid['ok']) {
                    return response()->json(['error' => $valid['error'] ?? 'Destino raíz inválido'], 422);
                }
                if (DestinationDenylist::reason($rootDestination) !== null) {
                    return response()->json(['error' => 'Destino raíz no permitido'], 422);
                }
            }
        }
        if ($hasModeInput && ! in_array($notFoundMode, ['platform', 'redirect', 'branded'], true)) {
            return response()->json(['error' => 'Modo de no encontrado inválido'], 422);
        }

        $result = DB::transaction(function () use ($id, $workspaceId, $user, $apiTokenContext, $hasRootInput, $hasModeInput, $hasDefaultInput, $rootDestination, $notFoundMode, $isDefault): string {
            if (! WorkspaceAccess::getMembershipLocked(
                $user->id,
                $workspaceId,
                'editor',
                $apiTokenContext,
                'domains:write',
                (int) $user->security_version,
            )) {
                return 'forbidden';
            }
            if ($hasDefaultInput) {
                // Lock the whole set before the target row: two concurrent
                // "make default" calls must serialize on the same lock order
                // or the one-default-per-workspace index rejects one mid-flight.
                CustomDomain::where('workspace_id', $workspaceId)->orderBy('id')->lockForUpdate()->get(['id']);
            }
            $domain = CustomDomain::where('id', $id)->where('workspace_id', $workspaceId)->lockForUpdate()->first();
            if (! $domain) {
                return 'not_found';
            }
            $updates = ['updated_at' => now()];
            if ($hasRootInput) {
                $updates['root_destination'] = $rootDestination;
            }
            if ($hasModeInput) {
                $effectiveRoot = $hasRootInput ? $rootDestination : $domain->root_destination;
                if ($notFoundMode === 'redirect' && $effectiveRoot === null) {
                    return 'redirect_without_destination';
                }
                $updates['not_found_mode'] = $notFoundMode;
            }
            if ($hasDefaultInput) {
                // The default is what new links are born with: only a domain
                // that can actually serve links may hold the preference.
                if ($isDefault && ! DomainStatus::servingReady($domain)) {
                    return 'default_requires_serving';
                }
                if ($isDefault) {
                    CustomDomain::where('workspace_id', $workspaceId)
                        ->where('is_default', true)->where('id', '!=', $id)
                        ->update(['is_default' => false, 'updated_at' => now()]);
                    $updates['is_default'] = true;
                } else {
                    $updates['is_default'] = false;
                }
            }
            $domain->update($updates);

            return 'ok';
        });
        if ($result === 'forbidden') {
            return response()->json(['error' => 'Tu acceso al workspace cambió. Recarga antes de continuar.'], 403);
        }
        if ($result === 'not_found') {
            return response()->json(['error' => 'Dominio no encontrado'], 404);
        }
        if ($result === 'redirect_without_destination') {
            return response()->json(['error' => 'Configura antes un destino raíz para redirigir las rutas desconocidas'], 422);
        }
        if ($result === 'default_requires_serving') {
            return response()->json(['error' => 'Un dominio solo puede ser el predeterminado cuando está activo sirviendo enlaces. Actívalo antes.'], 422);
        }
        Audit::write($user->id, 'domain.update', 'domain', $id, null, UvhRequest::ip($request), workspaceId: $workspaceId);

        $domain = CustomDomain::where('id', $id)->where('workspace_id', $workspaceId)->firstOrFail();

        return response()->json(['domain' => $this->dto($domain, $this->canReadChallenge($request))]);
    }

    public function store(Request $request)
    {
        $workspaceId = UvhRequest::workspaceId($request);
        $user = UvhRequest::user($request);
        $apiTokenContext = UvhRequest::apiToken($request);

        $domain = $this->normalizeDomain(UvhRequest::inputString($request, 'domain'));
        // Leave room for the _uvh-verification TXT owner name while keeping
        // the complete DNS name within the protocol limit of 253 characters.
        // Unicode input is stored in canonical ASCII/Punycode form so all DNS,
        // uniqueness and edge checks operate on one representation.
        if ($domain === null || strlen($domain) > 235 || ! ProductionSecurity::validHostname($domain)) {
            return response()->json([
                'error' => 'Dominio inválido. Usa un hostname DNS compatible con un CNAME directo.',
            ], 422);
        }
        // The server enforces what the UI promises: subdomains only, never an
        // IP, a special-use name or a name inside UVH's own infrastructure.
        $rejection = DomainAdmission::rejectReason($domain, app()->environment('production'), $this->firstPartyHosts());
        $error = match ($rejection) {
            'ip_literal' => 'No se admiten direcciones IP. Usa un subdominio con CNAME.',
            'special_use' => 'Ese nombre no pertenece a un dominio público utilizable.',
            'apex' => 'Usa un subdominio (p. ej. go.tudominio.com). No se admiten dominios raíz, flattening ni proxies DNS.',
            'first_party' => 'Este hostname está reservado por UVH',
            default => null,
        };
        if ($error !== null) {
            return response()->json(['error' => $error], 422);
        }

        // The Idempotency-Key is optional. With it, a retried create receives
        // the original response (TXT challenge included) instead of colliding
        // with the uniqueness guard; without it, behaviour is unchanged. The
        // scope carries the challenge visibility so a replay can never hand the
        // token to a request that would not have received it.
        $guard = $this->beginIdempotency(
            $request,
            'domains.create:'.$workspaceId.':'.($this->canReadChallenge($request) ? 'challenge' : 'redacted'),
        );
        if ($guard instanceof JsonResponse) {
            return $guard;
        }

        $token = 'uvh-verify='.Ids::randomToken(24);
        try {
            $result = DB::transaction(function () use ($workspaceId, $domain, $token, $user, $apiTokenContext, $guard): array {
                if (! WorkspaceAccess::getMembershipLocked(
                    $user->id,
                    $workspaceId,
                    'editor',
                    $apiTokenContext,
                    'domains:write',
                    (int) $user->security_version,
                )) {
                    return ['status' => 'forbidden'];
                }
                $this->renewIdempotency($guard);
                if (CustomDomain::where('workspace_id', $workspaceId)->count() >= self::MAX_DOMAINS_PER_WORKSPACE) {
                    return ['status' => 'limit'];
                }

                // A request never reserves the hostname: any number of
                // workspaces may ask for the same name, and the claim — earned
                // by publishing the TXT — is what makes it exclusive.
                $created = CustomDomain::create([
                    'workspace_id' => $workspaceId,
                    'domain' => $domain,
                    'verification_token' => $token,
                    'verification_scheme' => 2,
                    'desired_state' => 'enabled',
                    'ownership_status' => 'pending',
                    'routing_status' => 'unknown',
                    'tls_status' => 'pending',
                ]);
                $body = ['domain' => $this->dto($created, true)];
                // Sealed in the same transaction as the row: a retry can never
                // see the sealed response over a rolled-back creation.
                $this->sealIdempotency($guard, 201, $body);

                return ['status' => 'created', 'domain' => $created, 'body' => $body];
            });
        } catch (QueryException $e) {
            $this->releaseIdempotency($guard);
            if (($e->errorInfo[0] ?? null) === '23505') {
                return response()->json(['error' => 'Este dominio ya está registrado en este workspace'], 409);
            }
            throw $e;
        }
        if ($result['status'] === 'forbidden') {
            $this->releaseIdempotency($guard);

            return response()->json(['error' => 'Tu acceso al workspace cambió. Recarga antes de continuar.'], 403);
        }
        if ($result['status'] !== 'created') {
            $this->releaseIdempotency($guard);

            return response()->json(['error' => 'Límite de dominios alcanzado'], 429);
        }
        /** @var CustomDomain $d */
        $d = $result['domain'];

        Audit::write($user->id, 'domain.create', 'domain', $d->id, ['domain' => $domain], UvhRequest::ip($request), workspaceId: $workspaceId);

        return response()->json($result['body'], 201);
    }

    public function verify(Request $request, int $id)
    {
        return $this->queueVerification($request, $id, false);
    }

    public function revalidate(Request $request, int $id)
    {
        return $this->queueVerification($request, $id, true);
    }

    /**
     * Make the domain serve: issue (or reuse) the certificate and open the
     * edge. Refuses to act while a DNS check is running — that is exactly the
     * window where the evidence for this decision is being refreshed.
     */
    public function activate(Request $request, int $id)
    {
        $workspaceId = UvhRequest::workspaceId($request);
        $user = UvhRequest::user($request);
        $apiTokenContext = UvhRequest::apiToken($request);
        $guard = $this->beginIdempotency($request, 'domains.activate:'.$workspaceId);
        if ($guard instanceof JsonResponse) {
            return $guard;
        }

        $prepared = DB::transaction(function () use ($id, $workspaceId, $user, $apiTokenContext, $guard): array {
            if (! WorkspaceAccess::getMembershipLocked(
                $user->id,
                $workspaceId,
                'editor',
                $apiTokenContext,
                'domains:write',
                (int) $user->security_version,
            )) {
                return ['status' => 'forbidden'];
            }
            $this->renewIdempotency($guard);
            $domain = CustomDomain::where('id', $id)->where('workspace_id', $workspaceId)->lockForUpdate()->first();
            if (! $domain) {
                return ['status' => 'not_found'];
            }
            if (DomainStatus::servingReady($domain) && $domain->dns_error === null) {
                return ['status' => 'active'];
            }
            if ($domain->tls_status === 'provisioning' && (bool) $domain->edge_eligible) {
                return ['status' => 'provisioning'];
            }
            if (DomainStatus::dnsCheckInProgress($domain)) {
                return ['status' => 'verification_in_progress'];
            }
            if ($domain->verified_at === null) {
                return ['status' => 'not_verified'];
            }
            if ($domain->ownership_status !== 'verified'
                || $domain->routing_status !== 'healthy'
                || $domain->dns_error !== null) {
                return ['status' => 'not_ready'];
            }
            $freshHours = max(1, (int) config('uvh.custom_domains.verification_fresh_hours', 24));
            if ($domain->verified_at->lt(now()->subHours($freshHours))) {
                return ['status' => 'stale_verification'];
            }
            if (! DomainStatus::tlsManualRetryAllowed($domain)) {
                return ['status' => 'tls_cooldown'];
            }

            // Re-enabling a domain whose certificate is still valid must not
            // spend another issuance: only the intent and the edge flag move.
            if ($domain->tls_ready_at !== null && in_array($domain->tls_status, ['ready', 'expiring'], true)) {
                $domain->update([
                    'desired_state' => 'enabled',
                    'edge_eligible' => true,
                    'updated_at' => now(),
                ]);
                DomainEvents::record($workspaceId, $id, $domain->domain, 'domain.activated', [
                    'domainId' => $id,
                    'domain' => $domain->domain,
                    'reenabled' => true,
                ]);

                return ['status' => 'active', 'event_only' => true];
            }

            $updates = DomainStatus::beginTlsProvisioning($domain);
            $domain->update($updates);

            return [
                'status' => 'ready',
                'domain' => $domain->domain,
                'version' => $updates['tls_version'],
            ];
        });

        $error = match ($prepared['status']) {
            'forbidden' => ['Tu acceso al workspace cambió. Recarga antes de continuar.', 403],
            'not_found' => ['Dominio no encontrado', 404],
            'not_verified' => ['El dominio debe estar verificado antes de activarlo', 422],
            'not_ready' => ['El dominio aún no tiene propiedad y ruta DNS confirmadas. Revalídalo antes de activarlo.', 409],
            'stale_verification' => ['La verificación ha caducado. Revalida el dominio antes de activarlo.', 409],
            'verification_in_progress' => ['Hay una comprobación DNS en curso. Espera a que termine antes de preparar HTTPS.', 409],
            'tls_cooldown' => ['La emisión de certificado se está reintentando. Vuelve a probar en unos minutos.', 429],
            default => null,
        };
        if ($error !== null) {
            $this->releaseIdempotency($guard);

            return response()->json(['error' => $error[0]], $error[1]);
        }
        if (in_array($prepared['status'], ['active', 'provisioning'], true)) {
            $body = ['ok' => true, 'state' => $prepared['status']];
            $status = $prepared['status'] === 'active' ? 200 : 202;
            // The effect is already committed; sealing after it can only
            // under-seal, never claim success over an undone change.
            $this->sealIdempotency($guard, $status, $body);

            return response()->json($body, $status);
        }

        try {
            ProvisionDomainTlsJob::dispatch(
                $id,
                $workspaceId,
                $user->id,
                (int) $user->security_version,
                is_array($apiTokenContext) ? ($apiTokenContext['token_id'] ?? null) : null,
                $prepared['domain'],
                $prepared['version'],
            )->afterCommit();
        } catch (\Throwable $e) {
            CustomDomain::where('id', $id)
                ->where('workspace_id', $workspaceId)
                ->where('tls_status', 'provisioning')
                ->where('tls_version', $prepared['version'])
                ->update([
                    'tls_status' => 'error',
                    'edge_eligible' => false,
                    'tls_error' => 'queue_unavailable',
                    'updated_at' => now(),
                ]);
            report($e);
            $this->releaseIdempotency($guard);

            return response()->json(['error' => 'No se pudo iniciar la emisión TLS. Inténtalo de nuevo.'], 503);
        }

        Audit::write($user->id, 'domain.tls_requested', 'domain', $id, null, UvhRequest::ip($request), workspaceId: $workspaceId);

        // Sealed only once the job is queued: a failed push releases the key
        // and the retry starts the issuance again.
        $this->sealIdempotency($guard, 202, ['ok' => true, 'state' => 'provisioning']);

        return response()->json(['ok' => true, 'state' => 'provisioning'], 202);
    }

    /**
     * Withdraw the domain. Works from any state and is always reversible: the
     * links survive, the certificate survives, only the serving stops. Any DNS
     * check in flight is cancelled cleanly — the user decided, there is no
     * timeout to recover from.
     *
     * Admin, not editor: this takes every link on the domain offline at once,
     * which is a much larger blast radius than editing one link.
     */
    public function disable(Request $request, int $id)
    {
        $workspaceId = UvhRequest::workspaceId($request);
        $user = UvhRequest::user($request);
        $apiTokenContext = UvhRequest::apiToken($request);
        $guard = $this->beginIdempotency($request, 'domains.disable:'.$workspaceId);
        if ($guard instanceof JsonResponse) {
            return $guard;
        }
        $sealedBody = ['ok' => true, 'state' => 'disabled'];

        $result = DB::transaction(function () use ($id, $workspaceId, $user, $apiTokenContext, $guard, $sealedBody): string {
            if (! WorkspaceAccess::getMembershipLocked(
                $user->id,
                $workspaceId,
                'admin',
                $apiTokenContext,
                'domains:write',
                (int) $user->security_version,
            )) {
                return 'forbidden';
            }
            $this->renewIdempotency($guard);
            $domain = CustomDomain::where('id', $id)->where('workspace_id', $workspaceId)->lockForUpdate()->first();
            if (! $domain) {
                return 'not_found';
            }
            if ($domain->desired_state === 'disabled' && ! (bool) $domain->edge_eligible) {
                $this->sealIdempotency($guard, 200, $sealedBody);

                return 'unchanged';
            }
            $domain->update(DomainStatus::disableUpdates($domain));
            DomainEvents::record($workspaceId, $id, $domain->domain, 'domain.disabled', [
                'domainId' => $id,
                'domain' => $domain->domain,
            ]);
            // The withdrawal and its seal commit together: a retry can never
            // see "disabled" over a rolled-back change.
            $this->sealIdempotency($guard, 200, $sealedBody);

            return 'ok';
        });
        if ($result === 'forbidden') {
            $this->releaseIdempotency($guard);

            return response()->json(['error' => 'Tu acceso al workspace cambió. Recarga antes de continuar.'], 403);
        }
        if ($result === 'not_found') {
            $this->releaseIdempotency($guard);

            return response()->json(['error' => 'Dominio no encontrado'], 404);
        }
        if ($result !== 'unchanged') {
            Audit::write($user->id, 'domain.disable', 'domain', $id, null, UvhRequest::ip($request), workspaceId: $workspaceId);
        }

        return response()->json($sealedBody);
    }

    public function destroy(Request $request, int $id)
    {
        $workspaceId = UvhRequest::workspaceId($request);
        $user = UvhRequest::user($request);
        $apiTokenContext = UvhRequest::apiToken($request);

        $result = DB::transaction(function () use ($workspaceId, $user, $id, $apiTokenContext): string {
            // Admin, not editor: deletion is the one irreversible act on a
            // domain (the claim is released and the name is back on the market).
            if (! WorkspaceAccess::getMembershipLocked(
                $user->id,
                $workspaceId,
                'admin',
                $apiTokenContext,
                'domains:write',
                (int) $user->security_version,
            )) {
                return 'forbidden';
            }
            $domain = CustomDomain::where('id', $id)->where('workspace_id', $workspaceId)->lockForUpdate()->first();
            if (! $domain) {
                return 'not_found';
            }
            // Include soft-deleted links. Otherwise nullOnDelete silently
            // detaches them and a later restore changes their public URL.
            if (Link::withTrashed()->where('domain_id', $domain->id)->exists()) {
                return 'in_use';
            }
            DomainEvents::record($workspaceId, $id, $domain->domain, 'domain.deleted', [
                'domainId' => $id,
                'domain' => $domain->domain,
            ]);
            $domain->delete();
            // The claim goes with the request: whoever controls the DNS next
            // proves it and claims the name. A gap between the two can only be
            // bridged by publishing the TXT record.
            DomainClaims::release($workspaceId, $domain->domain);

            return 'deleted';
        });
        if ($result === 'forbidden') {
            return response()->json(['error' => 'Tu acceso al workspace cambió. Recarga antes de continuar.'], 403);
        }
        if ($result === 'not_found') {
            return response()->json(['error' => 'Dominio no encontrado'], 404);
        }
        if ($result === 'in_use') {
            return response()->json([
                'error' => 'Reasigna los enlaces de este dominio, incluidos los eliminados que quieras conservar, antes de borrarlo',
            ], 409);
        }
        Audit::write($user->id, 'domain.delete', 'domain', $id, null, UvhRequest::ip($request), workspaceId: $workspaceId);

        return response()->json(['ok' => true]);
    }

    private function queueVerification(Request $request, int $id, bool $revalidation)
    {
        $workspaceId = UvhRequest::workspaceId($request);
        $user = UvhRequest::user($request);
        $apiTokenContext = UvhRequest::apiToken($request);
        $dedupeKey = 'uvh:domain-verification:'.$workspaceId.':'.$id;
        // The lock is scoped to the authorized workspace and its owner token is
        // passed to the worker. A stale worker therefore cannot release a lock
        // acquired by a newer verification.
        try {
            $verificationLock = Cache::lock($dedupeKey, self::VERIFICATION_LOCK_SECONDS);
            $lockAcquired = $verificationLock->get();
        } catch (\Throwable $e) {
            OperationalMetrics::increment('lock.unavailable');
            report($e);

            return response()->json([
                'error' => 'La coordinación de verificación DNS no está disponible temporalmente. Inténtalo de nuevo.',
            ], 503);
        }
        if (! $lockAcquired) {
            OperationalMetrics::increment('lock.unavailable');

            return response()->json(['error' => 'Ya hay una verificación en curso para este dominio'], 409);
        }

        $dispatched = false;
        try {
            $prepared = DB::transaction(function () use ($id, $workspaceId, $user, $revalidation, $apiTokenContext): array {
                if (! WorkspaceAccess::getMembershipLocked(
                    $user->id,
                    $workspaceId,
                    'editor',
                    $apiTokenContext,
                    'domains:write',
                    (int) $user->security_version,
                )) {
                    return ['status' => 'forbidden'];
                }
                $domain = CustomDomain::where('id', $id)->where('workspace_id', $workspaceId)->lockForUpdate()->first();
                if (! $domain) {
                    return ['status' => 'not_found'];
                }
                $previous = DomainStatus::legacyState($domain);
                $allowed = $revalidation
                    ? in_array($previous, ['verified', 'active', 'disabled'], true)
                    : in_array($previous, ['pending', 'error'], true);
                if (! $allowed) {
                    return ['status' => 'invalid_state'];
                }
                $updates = DomainStatus::beginDnsCheck($domain);
                $domain->update($updates);

                return [
                    'status' => 'ready',
                    'domain' => $domain->domain,
                    'token' => $domain->verification_token,
                    'scheme' => (int) $domain->verification_scheme,
                    'previous' => $previous,
                    'version' => $updates['verification_version'],
                ];
            });
            if ($prepared['status'] === 'forbidden') {
                return response()->json(['error' => 'Tu acceso al workspace cambió. Recarga antes de continuar.'], 403);
            }
            if ($prepared['status'] === 'not_found') {
                return response()->json(['error' => 'Dominio no encontrado'], 404);
            }
            if ($prepared['status'] !== 'ready') {
                return response()->json(['error' => 'El dominio no está en un estado verificable'], 409);
            }

            try {
                VerifyDomainDnsJob::dispatch(
                    $id,
                    $workspaceId,
                    $user->id,
                    (int) $user->security_version,
                    is_array($apiTokenContext) ? ($apiTokenContext['token_id'] ?? null) : null,
                    $prepared['domain'],
                    $prepared['token'],
                    $prepared['scheme'],
                    $prepared['version'],
                    $dedupeKey,
                    $verificationLock->owner(),
                )->afterCommit();
                $dispatched = true;
            } catch (\Throwable $e) {
                CustomDomain::where('id', $id)->where('workspace_id', $workspaceId)
                    ->where('verification_version', $prepared['version'])
                    ->update([
                        'dns_check_completed_at' => now(),
                        'dns_error' => 'queue_unavailable',
                        'updated_at' => now(),
                    ]);
                report($e);

                return response()->json(['error' => 'No se pudo iniciar la verificación DNS. Inténtalo de nuevo.'], 503);
            }

            return response()->json(['ok' => true, 'state' => $revalidation ? $prepared['previous'] : 'verifying'], 202);
        } finally {
            if (! $dispatched) {
                try {
                    $verificationLock->release();
                } catch (\Throwable $e) {
                    // The lease expires after ten minutes. Never replace an
                    // already-determined 4xx/5xx response with a release error.
                    OperationalMetrics::increment('lock.unavailable');
                    report($e);
                }
            }
        }
    }

    /**
     * Optional `Idempotency-Key` reservation for the domain mutations.
     *
     * Returns `null` when the caller sent no key (historical behaviour: every
     * request executes), a `JsonResponse` when the request must stop (replay,
     * mismatch, or an operation still in flight), or the reservation handle
     * used to renew, seal or release. Errors always release the key so the
     * same intent can be retried; only success seals a response.
     *
     * @return array{userId: int, scope: string, key: string, hash: string, lease: string}|JsonResponse|null
     */
    private function beginIdempotency(Request $request, string $scope): array|JsonResponse|null
    {
        $key = $request->header('Idempotency-Key');
        if ($key === null) {
            return null;
        }
        $check = Idempotency::validateKey($key);
        if (! $check['ok']) {
            return response()->json(['error' => $check['error']], 422);
        }
        $user = UvhRequest::user($request);
        $hash = Idempotency::hash($request->getContent());
        $begin = Idempotency::begin((int) $user->id, $scope, $key, $hash);
        if ($begin['state'] === 'replay') {
            return response()->json($begin['body'], $begin['status'])->header('Idempotent-Replay', 'true');
        }
        if ($begin['state'] === 'mismatch') {
            return response()->json(['error' => 'Esta Idempotency-Key ya se usó con otra petición'], 409);
        }
        if ($begin['state'] === 'in_progress') {
            return response()->json(['error' => 'Ya hay una operación en curso con esta clave. Espera a que termine.'], 409);
        }

        return [
            'userId' => (int) $user->id,
            'scope' => $scope,
            'key' => $key,
            'hash' => $hash,
            'lease' => (string) ($begin['lease'] ?? ''),
        ];
    }

    /**
     * @param  array{userId: int, scope: string, key: string, hash: string, lease: string}|null  $guard
     * @param  array<string, mixed>  $body
     */
    private function sealIdempotency(?array $guard, int $status, array $body): void
    {
        if ($guard !== null) {
            Idempotency::commit($guard['userId'], $guard['scope'], $guard['key'], $guard['hash'], $status, $body, $guard['lease']);
        }
    }

    /** @param  array{userId: int, scope: string, key: string, hash: string, lease: string}|null  $guard */
    private function renewIdempotency(?array $guard): void
    {
        if ($guard !== null) {
            Idempotency::renew($guard['userId'], $guard['scope'], $guard['key'], $guard['hash'], $guard['lease']);
        }
    }

    /** @param  array{userId: int, scope: string, key: string, hash: string, lease: string}|null  $guard */
    private function releaseIdempotency(?array $guard): void
    {
        if ($guard !== null) {
            Idempotency::release($guard['userId'], $guard['scope'], $guard['key'], $guard['lease']);
        }
    }

    private function dto(CustomDomain $d, bool $includeChallenge, ?int $linksCount = null): array
    {
        $automaticRetry = $d->desired_state === 'enabled';
        $nextDnsCheckAt = DomainRevalidationSchedule::nextAt($d);
        $tlsDaysRemaining = $d->tls_not_after === null
            ? null
            : max(0, (int) now()->diffInDays($d->tls_not_after, false));

        return [
            'id' => $d->id,
            'domain' => $d->domain,
            // Deprecated label kept for API consumers during the compatibility
            // window; derived from the status columns, no longer stored.
            'state' => DomainStatus::legacyState($d),
            'desiredState' => $d->desired_state,
            'ownershipStatus' => $d->ownership_status,
            'routingStatus' => $d->routing_status,
            'tlsStatus' => $d->tls_status,
            'trafficStatus' => DomainStatus::trafficStatus($d),
            'servingReady' => DomainStatus::servingReady($d),
            'verificationHost' => $this->verificationHost($d->domain),
            'verificationToken' => $includeChallenge ? $d->verification_token : null,
            'cnameTarget' => $this->cnameTarget(),
            'verificationScheme' => (int) $d->verification_scheme,
            'verifiedAt' => $this->iso($d->verified_at),
            'ownershipVerifiedAt' => $this->iso($d->ownership_verified_at),
            'routingVerifiedAt' => $this->iso($d->routing_verified_at),
            'dnsCheckStartedAt' => $this->iso($d->dns_check_started_at),
            'dnsCheckCompletedAt' => $this->iso($d->dns_check_completed_at),
            'dnsError' => $d->dns_error,
            'dnsCheckInProgress' => DomainStatus::dnsCheckInProgress($d),
            'automaticDnsRetry' => $automaticRetry,
            'dnsRetryIntervalHours' => $automaticRetry ? DomainRevalidationSchedule::intervalHours($d) : null,
            'nextDnsCheckAt' => $this->iso($nextDnsCheckAt),
            'dnsCheckDue' => DomainRevalidationSchedule::isDue($d),
            'dnsFailureCount' => (int) $d->dns_failure_count,
            'dnsMaxFailures' => max(2, min(10, (int) config('uvh.custom_domains.max_failures', 3))),
            'dnsFirstFailedAt' => $this->iso($d->dns_first_failed_at),
            'graceExpiresAt' => $this->iso(DomainStatus::graceExpiresAt($d)),
            // What the resolver actually answered — the difference between
            // "routing_missing" and an instruction the user can act on.
            'dnsObservedAt' => $this->iso($d->dns_observed_at),
            'ownershipTxtPresent' => $d->ownership_txt_present === null ? null : (bool) $d->ownership_txt_present,
            'routingObservedTarget' => $d->routing_observed_target,
            'routingObservedTtl' => $d->routing_observed_ttl === null ? null : (int) $d->routing_observed_ttl,
            'routingObservedAddresses' => $d->routing_observed_addresses,
            'routingObservedProxied' => $d->routing_observed_proxied === null ? null : (bool) $d->routing_observed_proxied,
            'caaRecords' => $d->caa_records,
            'caaAllowsIssuer' => $d->caa_allows_issuer === null ? null : (bool) $d->caa_allows_issuer,
            'acmeIssuer' => (string) config('uvh.custom_domains.acme_issuer', 'letsencrypt.org'),
            'edgeEligible' => (bool) $d->edge_eligible,
            'tlsReadyAt' => $this->iso($d->tls_ready_at),
            'tlsError' => $d->tls_error,
            'tlsCheckedAt' => $this->iso($d->tls_checked_at),
            'tlsNotAfter' => $this->iso($d->tls_not_after),
            'tlsIssuer' => $d->tls_issuer,
            'tlsDaysRemaining' => $tlsDaysRemaining,
            'tlsLastAttemptAt' => $this->iso($d->tls_last_attempt_at),
            'tlsNextRetryAt' => $this->iso($d->tls_next_retry_at),
            'tlsProbeFailures' => (int) $d->tls_probe_failures,
            'rootDestination' => $d->root_destination,
            'notFoundMode' => $d->not_found_mode,
            'isDefault' => (bool) $d->is_default,
            'linksCount' => $linksCount ?? (int) $d->links()->whereNull('deleted_at')->count(),
            'createdAt' => $this->iso($d->created_at),
        ];
    }

    private function canEdit(?string $role): bool
    {
        return in_array($role, ['owner', 'admin', 'editor'], true);
    }

    /**
     * Who may read the TXT challenge *value*.
     *
     * Sessions: anyone who may change DNS. API tokens: the scope is a ceiling —
     * a `domains:read` token never leaks the token value even when its creator
     * is an editor, because reading is all that token was issued for.
     */
    private function canReadChallenge(Request $request): bool
    {
        if (! $this->canEdit(UvhRequest::role($request))) {
            return false;
        }
        $apiToken = UvhRequest::apiToken($request);
        if ($apiToken === null) {
            return true;
        }

        return in_array('domains:write', (array) ($apiToken['scopes'] ?? []), true);
    }

    private function normalizeDomain(string $raw): ?string
    {
        $candidate = trim($raw, " \t\n\r\0\x0B.");
        if ($candidate === '' || ! mb_check_encoding($candidate, 'UTF-8')
            || preg_match('/[\x00-\x20\x7f]/', $candidate)) {
            return null;
        }

        if (preg_match('/[^\x20-\x7e]/', $candidate)) {
            $candidate = idn_to_ascii(
                $candidate,
                IDNA_NONTRANSITIONAL_TO_ASCII | IDNA_USE_STD3_RULES | IDNA_CHECK_BIDI | IDNA_CHECK_CONTEXTJ,
                INTL_IDNA_VARIANT_UTS46,
            );
            if (! is_string($candidate) || $candidate === '') {
                return null;
            }
        }

        return strtolower(rtrim($candidate, '.'));
    }

    private function verificationHost(string $domain): string
    {
        return '_uvh-verification.'.$domain;
    }

    /** @return list<string> */
    private function firstPartyHosts(): array
    {
        $hosts = [];
        foreach (['public_host', 'app_host'] as $key) {
            $host = strtolower(trim((string) config('uvh.'.$key), '.'));
            if ($host !== '') {
                $hosts[] = $host;
                $hosts[] = 'www.'.$host;
            }
        }
        $cnameTarget = $this->cnameTarget();
        if ($cnameTarget !== null) {
            $hosts[] = $cnameTarget;
        }

        return array_values(array_unique($hosts));
    }

    private function cnameTarget(): ?string
    {
        $target = strtolower(trim((string) config('uvh.custom_domains.cname_target'), '.'));

        return $target !== '' ? $target : null;
    }

    private function iso(mixed $value): ?string
    {
        return IsoDate::format($value);
    }
}
