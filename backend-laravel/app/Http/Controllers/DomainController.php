<?php

namespace App\Http\Controllers;

use App\Jobs\VerifyDomainDnsJob;
use App\Jobs\ProvisionDomainTlsJob;
use App\Models\CustomDomain;
use App\Models\Link;
use App\Support\Audit;
use App\Support\DomainRevalidationSchedule;
use App\Support\Ids;
use App\Support\OperationalMetrics;
use App\Support\UvhRequest;
use App\Support\WorkspaceAccess;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

class DomainController
{
    private const MAX_DOMAINS_PER_WORKSPACE = \App\Support\WorkspaceLimits::DOMAINS;

    private const VERIFICATION_LOCK_SECONDS = 600;

    public function index(Request $request)
    {
        $workspaceId = UvhRequest::workspaceId($request);
        $includeVerificationToken = $this->canEdit(UvhRequest::role($request));
        $domains = CustomDomain::where('workspace_id', $workspaceId)
            ->orderByDesc('created_at')
            ->get()
            ->map(fn ($d) => $this->dto($d, $includeVerificationToken));

        return response()->json(['domains' => $domains]);
    }

    /**
     * Return one workspace-scoped diagnostic snapshot.
     *
     * The ownership challenge is projected only for roles allowed to change
     * DNS configuration. Viewers still receive operational health data.
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
            'domain' => $this->dto($domain, $this->canEdit(UvhRequest::role($request))),
        ]);
    }

    public function store(Request $request)
    {
        $workspaceId = UvhRequest::workspaceId($request);
        $user = UvhRequest::user($request);
        $apiTokenContext = UvhRequest::apiToken($request);

        $domain = strtolower(trim(UvhRequest::inputString($request, 'domain'), '.'));
        // Leave room for the _uvh-verification TXT owner name while keeping
        // the complete DNS name within the protocol limit of 253 characters.
        if (! preg_match('/^(?=.{4,235}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i', $domain)) {
            return response()->json(['error' => 'Dominio inválido'], 422);
        }
        if ($this->isReservedFirstPartyDomain($domain)) {
            return response()->json(['error' => 'Este hostname está reservado por UVH'], 422);
        }

        $token = 'uvh-verify='.Ids::randomToken(24);
        try {
            $result = DB::transaction(function () use ($workspaceId, $domain, $token, $user, $apiTokenContext): array {
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
                if (CustomDomain::where('workspace_id', $workspaceId)->count() >= self::MAX_DOMAINS_PER_WORKSPACE) {
                    return ['status' => 'limit'];
                }

                return ['status' => 'created', 'domain' => CustomDomain::create([
                    'workspace_id' => $workspaceId,
                    'domain' => $domain,
                    'verification_token' => $token,
                    'state' => 'pending',
                ])];
            });
        } catch (QueryException $e) {
            if (($e->errorInfo[0] ?? null) === '23505') {
                return response()->json(['error' => 'Este dominio ya está registrado'], 409);
            }
            throw $e;
        }
        if ($result['status'] === 'forbidden') {
            return response()->json(['error' => 'Tu acceso al workspace cambió. Recarga antes de continuar.'], 403);
        }
        if ($result['status'] !== 'created') {
            return response()->json(['error' => 'Límite de dominios alcanzado'], 429);
        }
        /** @var CustomDomain $d */
        $d = $result['domain'];

        Audit::write($user->id, 'domain.create', 'domain', $d->id, ['domain' => $domain], UvhRequest::ip($request), workspaceId: $workspaceId);

        return response()->json(['domain' => $this->dto($d, true)], 201);
    }

    public function verify(Request $request, int $id)
    {
        return $this->queueVerification($request, $id, false);
    }

    public function activate(Request $request, int $id)
    {
        $workspaceId = UvhRequest::workspaceId($request);
        $user = UvhRequest::user($request);
        $apiTokenContext = UvhRequest::apiToken($request);

        $prepared = DB::transaction(function () use ($id, $workspaceId, $user, $apiTokenContext): array {
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
            if ($domain->state === 'active' && $domain->edge_eligible && $domain->tls_ready_at !== null) {
                return ['status' => 'active'];
            }
            if ($domain->state === 'provisioning' && $domain->edge_eligible) {
                return ['status' => 'provisioning'];
            }
            if ($domain->state !== 'verified' || $domain->verified_at === null) {
                return ['status' => 'not_verified'];
            }
            if ($domain->ownership_verified_at === null
                || $domain->routing_verified_at === null
                || $domain->dns_error !== null) {
                return ['status' => 'not_ready'];
            }
            $freshHours = max(1, (int) config('uvh.custom_domains.verification_fresh_hours', 24));
            if ($domain->verified_at->lt(now()->subHours($freshHours))) {
                return ['status' => 'stale_verification'];
            }

            $tlsVersion = (int) $domain->tls_version + 1;
            $domain->update([
                'state' => 'provisioning',
                'edge_eligible' => true,
                'tls_version' => $tlsVersion,
                'tls_ready_at' => null,
                'tls_error' => null,
                'updated_at' => now(),
            ]);

            return [
                'status' => 'ready',
                'domain' => $domain->domain,
                'version' => $tlsVersion,
            ];
        });

        $error = match ($prepared['status']) {
            'forbidden' => ['Tu acceso al workspace cambió. Recarga antes de continuar.', 403],
            'not_found' => ['Dominio no encontrado', 404],
            'not_verified' => ['El dominio debe estar verificado antes de activarlo', 422],
            'not_ready' => ['El dominio aún no tiene propiedad y ruta DNS confirmadas. Revalídalo antes de activarlo.', 409],
            'stale_verification' => ['La verificación ha caducado. Revalida el dominio antes de activarlo.', 409],
            default => null,
        };
        if ($error !== null) {
            return response()->json(['error' => $error[0]], $error[1]);
        }
        if (in_array($prepared['status'], ['active', 'provisioning'], true)) {
            return response()->json([
                'ok' => true,
                'state' => $prepared['status'],
            ], $prepared['status'] === 'active' ? 200 : 202);
        }

        try {
            ProvisionDomainTlsJob::dispatch(
                $id,
                $workspaceId,
                $user->id,
                $prepared['domain'],
                $prepared['version'],
            )->afterCommit();
        } catch (\Throwable $e) {
            CustomDomain::where('id', $id)
                ->where('workspace_id', $workspaceId)
                ->where('state', 'provisioning')
                ->where('tls_version', $prepared['version'])
                ->update([
                    'state' => 'verified',
                    'edge_eligible' => false,
                    'tls_error' => 'queue_unavailable',
                    'updated_at' => now(),
                ]);
            report($e);

            return response()->json(['error' => 'No se pudo iniciar la emisión TLS. Inténtalo de nuevo.'], 503);
        }

        Audit::write($user->id, 'domain.tls_requested', 'domain', $id, null, UvhRequest::ip($request), workspaceId: $workspaceId);

        return response()->json(['ok' => true, 'state' => 'provisioning'], 202);
    }

    public function disable(Request $request, int $id)
    {
        [$ok, $response] = $this->transition($request, $id, 'disabled', 'domain.disable');
        if (! $ok) {
            return $response;
        }

        return response()->json(['ok' => true, 'state' => 'disabled']);
    }

    public function destroy(Request $request, int $id)
    {
        $workspaceId = UvhRequest::workspaceId($request);
        $user = UvhRequest::user($request);
        $apiTokenContext = UvhRequest::apiToken($request);

        $result = DB::transaction(function () use ($workspaceId, $user, $id, $apiTokenContext): string {
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
            $domain = CustomDomain::where('id', $id)->where('workspace_id', $workspaceId)->lockForUpdate()->first();
            if (! $domain) {
                return 'not_found';
            }
            // Include soft-deleted links. Otherwise nullOnDelete silently
            // detaches them and a later restore changes their public URL.
            if (Link::withTrashed()->where('domain_id', $domain->id)->exists()) {
                return 'in_use';
            }
            $domain->delete();

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

    public function revalidate(Request $request, int $id)
    {
        return $this->queueVerification($request, $id, true);
    }

    private function transition(Request $request, int $id, string $target, string $auditAction): array
    {
        $workspaceId = UvhRequest::workspaceId($request);
        $user = UvhRequest::user($request);
        $apiTokenContext = UvhRequest::apiToken($request);

        $result = DB::transaction(function () use ($id, $workspaceId, $target, $user, $apiTokenContext): string {
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
            $domain = CustomDomain::where('id', $id)->where('workspace_id', $workspaceId)->lockForUpdate()->first();
            if (! $domain) {
                return 'not_found';
            }
            if ($domain->state === $target && ! ($target === 'disabled' && $domain->edge_eligible)) {
                return 'unchanged';
            }
            if ($target === 'disabled' && ! in_array($domain->state, ['verified', 'provisioning', 'active'], true)) {
                return 'invalid_state';
            }
            $changes = [
                'state' => $target,
                'edge_eligible' => $target === 'active',
                'updated_at' => now(),
            ];
            if ($domain->state === 'provisioning') {
                $changes['tls_error'] = 'provisioning_cancelled';
            }
            $domain->update($changes);

            return 'ok';
        });
        if ($result === 'forbidden') {
            return [false, response()->json(['error' => 'Tu acceso al workspace cambió. Recarga antes de continuar.'], 403)];
        }
        if ($result === 'not_found') {
            return [false, response()->json(['error' => 'Dominio no encontrado'], 404)];
        }
        if ($result === 'not_verified') {
            return [false, response()->json(['error' => 'El dominio debe estar verificado antes de activarlo'], 422)];
        }
        if ($result === 'stale_verification') {
            return [false, response()->json([
                'error' => 'La verificación ha caducado. Revalida el dominio antes de activarlo.',
            ], 409)];
        }
        if ($result === 'not_ready') {
            return [false, response()->json([
                'error' => 'El dominio aún no tiene propiedad y ruta DNS confirmadas. Revalídalo antes de activarlo.',
            ], 409)];
        }
        if ($result === 'invalid_state') {
            return [false, response()->json(['error' => 'El dominio no se puede desactivar desde su estado actual'], 409)];
        }
        if ($result !== 'unchanged') {
            Audit::write($user->id, $auditAction, 'domain', $id, null, UvhRequest::ip($request), workspaceId: $workspaceId);
        }

        return [true, null];
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
                $allowed = $revalidation
                    ? in_array($domain->state, ['verified', 'active', 'disabled'], true)
                    : in_array($domain->state, ['pending', 'error'], true);
                if (! $allowed) {
                    return ['status' => 'invalid_state'];
                }
                $previousState = $domain->state;
                $verificationVersion = (int) $domain->verification_version + 1;
                $domain->update([
                    'verification_version' => $verificationVersion,
                    'state' => $revalidation ? $previousState : 'verifying',
                    'dns_check_started_at' => now(),
                    'dns_error' => null,
                    'updated_at' => now(),
                ]);

                return [
                    'status' => 'ready',
                    'domain' => $domain->domain,
                    'token' => $domain->verification_token,
                    'previous' => $previousState,
                    'version' => $verificationVersion,
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
                    $prepared['domain'],
                    $prepared['token'],
                    $prepared['previous'],
                    $prepared['version'],
                    $dedupeKey,
                    $verificationLock->owner(),
                )->afterCommit();
                $dispatched = true;
            } catch (\Throwable $e) {
                $recovery = [
                    'dns_check_completed_at' => now(),
                    'dns_error' => 'queue_unavailable',
                    'updated_at' => now(),
                ];
                if (! $revalidation) {
                    $recovery['state'] = $prepared['previous'];
                }
                CustomDomain::where('id', $id)->where('workspace_id', $workspaceId)
                    ->where('verification_version', $prepared['version'])
                    ->where('state', $revalidation ? $prepared['previous'] : 'verifying')
                    ->update($recovery);
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

    private function dto(CustomDomain $d, bool $includeVerificationToken): array
    {
        $automaticRetry = $d->state === 'active';
        $nextDnsCheckAt = DomainRevalidationSchedule::nextAt($d);

        return [
            'id' => $d->id,
            'domain' => $d->domain,
            'state' => $d->state,
            'verificationHost' => $includeVerificationToken ? $this->verificationHost($d->domain) : null,
            'verificationToken' => $includeVerificationToken ? $d->verification_token : null,
            'cnameTarget' => $this->cnameTarget(),
            'verifiedAt' => $this->iso($d->verified_at),
            'ownershipVerifiedAt' => $this->iso($d->ownership_verified_at),
            'routingVerifiedAt' => $this->iso($d->routing_verified_at),
            'dnsCheckStartedAt' => $this->iso($d->dns_check_started_at),
            'dnsCheckCompletedAt' => $this->iso($d->dns_check_completed_at),
            'dnsError' => $d->dns_error,
            'dnsCheckInProgress' => DomainRevalidationSchedule::isInProgress($d),
            'automaticDnsRetry' => $automaticRetry,
            'dnsRetryIntervalHours' => $automaticRetry ? DomainRevalidationSchedule::intervalHours($d) : null,
            'nextDnsCheckAt' => $this->iso($nextDnsCheckAt),
            'dnsCheckDue' => DomainRevalidationSchedule::isDue($d),
            'edgeEligible' => (bool) $d->edge_eligible,
            'tlsReadyAt' => $this->iso($d->tls_ready_at),
            'tlsError' => $d->tls_error,
            'createdAt' => $this->iso($d->created_at),
        ];
    }

    private function canEdit(?string $role): bool
    {
        return in_array($role, ['owner', 'admin', 'editor'], true);
    }

    private function verificationHost(string $domain): string
    {
        return '_uvh-verification.'.$domain;
    }

    private function isReservedFirstPartyDomain(string $domain): bool
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

        return in_array($domain, array_unique($hosts), true);
    }

    private function cnameTarget(): ?string
    {
        $target = strtolower(trim((string) config('uvh.custom_domains.cname_target'), '.'));

        return $target !== '' ? $target : null;
    }

    private function iso(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }

        return $value instanceof \DateTimeInterface
            ? $value->format('Y-m-d\TH:i:s.v\Z')
            : (string) $value;
    }
}
