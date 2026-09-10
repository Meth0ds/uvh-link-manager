<?php

namespace App\Http\Controllers;

use App\Models\Invitation;
use App\Models\Membership;
use App\Models\User;
use App\Models\UvhSession;
use App\Models\Workspace;
use App\Support\Audit;
use App\Support\Ids;
use App\Support\InvitationBudgetExceeded;
use App\Support\InvitationBudgetUnavailable;
use App\Support\InvitationMailBudget;
use App\Support\MailAdmissionException;
use App\Support\MfaStepUp;
use App\Support\OperationalMetrics;
use App\Support\UvhMail;
use App\Support\UvhRequest;
use App\Support\WebhookService;
use App\Support\WorkspaceAccess;
use App\Support\WorkspaceLimits;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

class WorkspaceController
{
    private const MAX_OWNED_WORKSPACES = 20;

    private const MAX_ACTIVE_INVITATIONS = WorkspaceLimits::ACTIVE_INVITATIONS;

    public function index(Request $request)
    {
        $user = UvhRequest::user($request);

        $workspaces = Workspace::whereHas('memberships', fn ($q) => $q->where('user_id', $user->id))
            ->with(['memberships' => fn ($q) => $q->where('user_id', $user->id)])
            ->orderBy('created_at')
            ->get()
            ->map(fn ($w) => [
                'id' => $w->id,
                'name' => $w->name,
                'slug' => $w->slug,
                'role' => $w->memberships->first()?->role,
                'createdAt' => $this->iso($w->created_at),
            ]);

        return response()->json(['workspaces' => $workspaces]);
    }

    public function store(Request $request)
    {
        $user = UvhRequest::user($request);
        $name = trim(UvhRequest::inputString($request, 'name'));

        if (! mb_check_encoding($name, 'UTF-8') || mb_strlen($name) < 2 || mb_strlen($name) > 80 || preg_match('/[\x00-\x1f\x7f]/', $name)) {
            return response()->json(['error' => 'Nombre inválido'], 422);
        }

        $result = DB::transaction(function () use ($name, $user): array {
            // Lock the owner row so parallel browser tabs cannot both pass the
            // workspace quota check under PostgreSQL read-committed isolation.
            // The version comparison also rejects a request that authenticated
            // before a password, email, MFA or account-lifecycle rotation.
            $owner = User::where('id', $user->id)->whereNull('deleted_at')->lockForUpdate()->first();
            if (! $owner || ! $owner->email_verified_at
                || (int) $owner->security_version !== (int) $user->security_version) {
                return ['status' => 'stale'];
            }
            if (Workspace::where('owner_user_id', $user->id)->count() >= self::MAX_OWNED_WORKSPACES) {
                return ['status' => 'limit'];
            }
            $w = Workspace::create([
                'name' => $name,
                'slug' => 'ws-'.strtolower(Ids::randomToken(6)),
                'owner_user_id' => $user->id,
            ]);
            $w->memberships()->create(['user_id' => $user->id, 'role' => 'owner']);
            $w->quota()->create(['links_limit' => 1000]);

            return ['status' => 'created', 'workspace' => $w];
        });
        if ($result['status'] === 'stale') {
            return response()->json(['error' => 'La sesión cambió. Vuelve a iniciar sesión'], 409);
        }
        if ($result['status'] !== 'created') {
            return response()->json(['error' => 'Límite de workspaces alcanzado'], 429);
        }
        /** @var Workspace $workspace */
        $workspace = $result['workspace'];

        Audit::write($user->id, 'workspace.create', 'workspace', $workspace->id, null, UvhRequest::ip($request));

        return response()->json(['workspace' => [
            'id' => $workspace->id,
            'name' => $workspace->name,
            'slug' => $workspace->slug,
            'role' => 'owner',
            'createdAt' => $this->iso($workspace->created_at),
        ]], 201);
    }

    public function show(Request $request, int $id)
    {
        $user = UvhRequest::user($request);
        $m = WorkspaceAccess::getMembership($user->id, $id);
        if (! $m) {
            return response()->json(['error' => 'Sin acceso a este workspace'], 403);
        }

        $workspace = Workspace::find($id);
        if (! $workspace) {
            return response()->json(['error' => 'El workspace ya no existe'], 404);
        }

        [$memberPage, $memberPerPage] = $this->pagination($request, 'memberPage', 'memberPerPage');
        [$invitationPage, $invitationPerPage] = $this->pagination($request, 'invitationPage', 'invitationPerPage');
        $members = $this->membersOf($id, $memberPage, $memberPerPage);
        $invitations = WorkspaceAccess::roleAtLeast($m->role, 'admin')
            ? $this->invitationsOf($id, $invitationPage, $invitationPerPage)
            : ['items' => collect(), 'total' => 0];

        return response()->json([
            'workspace' => [
                'id' => $workspace->id,
                'name' => $workspace->name,
                'slug' => $workspace->slug,
                'role' => $m->role,
                'createdAt' => $this->iso($workspace->created_at),
            ],
            'members' => $members['items'],
            'membersPage' => [
                'page' => $memberPage,
                'perPage' => $memberPerPage,
                'total' => $members['total'],
            ],
            'invitations' => $invitations['items'],
            'invitationsPage' => [
                'page' => $invitationPage,
                'perPage' => $invitationPerPage,
                'total' => $invitations['total'],
            ],
        ]);
    }

    public function rename(Request $request, int $id)
    {
        $user = UvhRequest::user($request);
        $name = trim(UvhRequest::inputString($request, 'name'));
        if (! mb_check_encoding($name, 'UTF-8') || mb_strlen($name) < 2 || mb_strlen($name) > 80 || preg_match('/[\x00-\x1f\x7f]/', $name)) {
            return response()->json(['error' => 'Nombre inválido'], 422);
        }

        $renamed = DB::transaction(function () use ($user, $id, $name): bool {
            if (! WorkspaceAccess::getMembershipLocked(
                $user->id,
                $id,
                'admin',
                expectedSecurityVersion: (int) $user->security_version,
            )) {
                return false;
            }
            Workspace::where('id', $id)->update(['name' => $name, 'updated_at' => now()]);

            return true;
        });
        if (! $renamed) {
            return response()->json(['error' => 'Tu acceso al workspace cambió. Recarga antes de continuar.'], 403);
        }
        Audit::write($user->id, 'workspace.rename', 'workspace', $id, null, UvhRequest::ip($request));

        return response()->json(['ok' => true]);
    }

    public function changeRole(Request $request, int $id, int $userId)
    {
        $user = UvhRequest::user($request);
        $role = UvhRequest::inputString($request, 'role');
        // Ownership is an invariant, not a selectable member role. A crafted
        // request must never be able to create a second owner or transfer
        // ownership without an explicit ownership workflow.
        if (! in_array($role, ['owner', 'admin', 'editor', 'viewer'], true)) {
            return response()->json(['error' => 'Rol inválido'], 422);
        }
        if ($role === 'owner') {
            return response()->json(['error' => 'La transferencia de propiedad requiere un flujo explícito'], 403);
        }

        // Authorise cheaply before taking an arbitrary target-user lock. The
        // same authority is re-read under the workspace lock below.
        $preflight = WorkspaceAccess::getMembership($user->id, $id);
        if (! $preflight || ! WorkspaceAccess::roleAtLeast($preflight->role, 'admin')) {
            return response()->json(['error' => 'Tu acceso al workspace cambió. Recarga antes de continuar.'], 403);
        }

        $result = DB::transaction(function () use ($user, $id, $userId, $role): string {
            // Target accounts are part of the authorization decision. Lock all
            // involved users first and in primary-key order so deletion cannot
            // race a promotion into a role that revives if the account returns.
            $users = User::whereIn('id', [(int) $user->id, $userId])
                ->orderBy('id')->lockForUpdate()->get()->keyBy('id');
            $lockedActor = $users->get((int) $user->id);
            $lockedTarget = $users->get($userId);
            if (! $lockedActor || $lockedActor->deleted_at || ! $lockedActor->email_verified_at
                || (int) $lockedActor->security_version !== (int) $user->security_version) {
                return 'forbidden';
            }
            if (! $lockedTarget || $lockedTarget->deleted_at || ! $lockedTarget->email_verified_at) {
                return 'target_inactive';
            }
            $actor = WorkspaceAccess::getMembershipLocked(
                $user->id,
                $id,
                'admin',
                expectedSecurityVersion: (int) $user->security_version,
            );
            if (! $actor) {
                return 'forbidden';
            }
            $target = Membership::where('user_id', $userId)->where('workspace_id', $id)->lockForUpdate()->first();
            if (! $target) {
                return 'not_found';
            }
            if ($target->role === 'owner') {
                return 'owner';
            }
            if ($actor->role !== 'owner' && ($role === 'admin' || $target->role === 'admin')) {
                return 'admin_forbidden';
            }
            if (WorkspaceAccess::roleAtLeast($target->role, 'editor')
                && ! WorkspaceAccess::roleAtLeast($role, 'editor')
                && ! WebhookService::deactivateOwnedBy($id, $userId)) {
                return 'busy';
            }
            if (WorkspaceAccess::roleAtLeast($target->role, 'admin')
                && ! WorkspaceAccess::roleAtLeast($role, 'admin')) {
                Invitation::where('workspace_id', $id)
                    ->where('invited_by', $userId)
                    ->where('status', 'pending')
                    ->update(['status' => 'cancelled']);
            }
            $target->update(['role' => $role]);

            return 'updated';
        });
        if ($result === 'forbidden') {
            return response()->json(['error' => 'Tu acceso al workspace cambió. Recarga antes de continuar.'], 403);
        }
        if ($result === 'not_found') {
            return response()->json(['error' => 'Miembro no encontrado'], 404);
        }
        if ($result === 'target_inactive') {
            return response()->json(['error' => 'La cuenta del miembro no está activa o verificada'], 409);
        }
        if ($result === 'owner') {
            return response()->json(['error' => 'No se puede cambiar el rol del propietario'], 403);
        }
        if ($result === 'admin_forbidden') {
            return response()->json(['error' => 'Solo el propietario puede asignar el rol de propietario o gestionar administradores'], 403);
        }
        if ($result === 'busy') {
            return response()->json(['error' => 'Hay una entrega de webhook en curso para este miembro. Espera unos segundos y vuelve a intentarlo.'], 409);
        }
        Audit::write($user->id, 'workspace.role_change', 'workspace', $id, ['userId' => $userId, 'role' => $role], UvhRequest::ip($request));

        return response()->json(['ok' => true]);
    }

    public function transferOwnership(Request $request, int $id)
    {
        $actor = UvhRequest::user($request);
        $targetInput = $request->input('targetUserId');
        $password = UvhRequest::inputString($request, 'password');
        $factorCode = trim(UvhRequest::inputString($request, 'factorCode'));
        if (! is_int($targetInput) || $targetInput <= 0 || $targetInput === (int) $actor->id
            || $password === '' || strlen($password) > 72 || strlen($factorCode) > 24) {
            return response()->json(['error' => 'Datos inválidos'], 422);
        }

        // Avoid allowing an arbitrary authenticated account to hold a victim's
        // user row while it waits to discover that it does not own this
        // workspace. Authority is still revalidated under locks below.
        $preflight = WorkspaceAccess::getMembership($actor->id, $id);
        if (! $preflight || $preflight->role !== 'owner') {
            return response()->json(['error' => 'Solo el propietario actual puede transferir el workspace'], 403);
        }

        $sessionId = UvhRequest::sessionId($request);
        try {
            $result = DB::transaction(function () use ($actor, $id, $targetInput, $password, $factorCode, $sessionId): array {
                // Account deletion starts with the user row and later removes
                // memberships. Lock every involved user first, in deterministic
                // order, before touching the workspace or membership rows.
                $users = User::whereIn('id', [(int) $actor->id, $targetInput])->whereNull('deleted_at')
                    ->orderBy('id')->lockForUpdate()->get()->keyBy('id');
                $lockedActor = $users->get((int) $actor->id);
                $target = $users->get($targetInput);
                $session = UvhSession::where('id', $sessionId)->where('user_id', $actor->id)
                    ->whereNull('revoked_at')->lockForUpdate()->first();
                if (! $lockedActor || ! $target || ! $target->email_verified_at || ! $session
                    || (int) $session->security_version !== (int) $lockedActor->security_version) {
                    return ['status' => 'stale'];
                }
                $workspace = Workspace::where('id', $id)->lockForUpdate()->first();
                if (! $workspace || (int) $workspace->owner_user_id !== (int) $actor->id) {
                    return ['status' => 'forbidden'];
                }
                $actorMembership = Membership::where('workspace_id', $id)->where('user_id', $actor->id)->lockForUpdate()->first();
                $targetMembership = Membership::where('workspace_id', $id)->where('user_id', $targetInput)->lockForUpdate()->first();
                if (! $actorMembership || $actorMembership->role !== 'owner') {
                    return ['status' => 'forbidden'];
                }
                if (! $targetMembership) {
                    return ['status' => 'not_found'];
                }
                // Receiving ownership consumes the same quota as store(). The
                // target user is already locked, serializing both entry points
                // and concurrent transfers under read-committed isolation.
                // Reject before step-up so a full quota cannot spend a TOTP
                // counter or a recovery code. Existing excess is not deleted.
                if (Workspace::where('owner_user_id', $target->id)->count() >= self::MAX_OWNED_WORKSPACES) {
                    return ['status' => 'limit'];
                }
                $stepUp = MfaStepUp::verify($lockedActor, $session, $password, $factorCode);
                if ($stepUp['status'] !== 'ok') {
                    return ['status' => $stepUp['status']];
                }
                if (isset($stepUp['recovery_codes'])) {
                    $lockedActor->update(['recovery_codes' => $stepUp['recovery_codes'], 'updated_at' => now()]);
                }

                $workspace->update(['owner_user_id' => $target->id, 'updated_at' => now()]);
                $actorMembership->update(['role' => 'admin']);
                $targetMembership->update(['role' => 'owner']);
                // Losing ownership permanently revokes grants that only an
                // owner may issue. Merely checking the issuer at acceptance
                // would let old admin links revive if ownership later returns.
                // Editor/viewer grants remain within the former owner's role.
                Invitation::where('workspace_id', $id)->where('invited_by', $actor->id)
                    ->where('role', 'admin')->where('status', 'pending')
                    ->update(['status' => 'cancelled']);
                // Both owners' notices must describe the same committed transfer.
                // Failure on the second envelope rolls back roles and the first.
                foreach (array_unique([$lockedActor->email, $target->email]) as $recipient) {
                    if (! UvhMail::workspaceOwnershipTransferred($recipient, $workspace->name)) {
                        throw new MailAdmissionException('Ownership transfer notices outbox admission failed');
                    }
                }

                return [
                    'status' => 'ok',
                    'target_user_id' => (int) $target->id,
                    'factor' => $stepUp['factor'],
                ];
            });
        } catch (MailAdmissionException) {
            Audit::write($actor->id, 'auth.email_delivery_failed', 'workspace', $id, ['kind' => 'workspace_ownership_transfer']);

            return response()->json(['error' => 'No se pudieron guardar los avisos. No se transfirió el workspace. Inténtalo de nuevo más tarde'], 503);
        }
        if ($result['status'] === 'forbidden') {
            return response()->json(['error' => 'Solo el propietario actual puede transferir el workspace'], 403);
        }
        if ($result['status'] === 'not_found') {
            return response()->json(['error' => 'El nuevo propietario debe ser miembro del workspace'], 404);
        }
        if ($result['status'] === 'limit') {
            return response()->json(['error' => 'El nuevo propietario ha alcanzado el límite de workspaces'], 429);
        }
        if ($result['status'] === 'stale') {
            return response()->json(['error' => 'La sesión cambió. Vuelve a iniciar sesión'], 409);
        }
        if ($result['status'] === 'password') {
            return response()->json(['error' => 'Contraseña incorrecta'], 403);
        }
        if ($result['status'] === 'factor') {
            return response()->json(['error' => 'El código de autenticación o recuperación es incorrecto'], 403);
        }

        Audit::write($actor->id, 'workspace.ownership_transfer', 'workspace', $id, [
            'targetUserId' => $result['target_user_id'],
            'factor' => $result['factor'],
        ], UvhRequest::ip($request));

        return response()->json(['ok' => true]);
    }

    public function removeMember(Request $request, int $id, int $userId)
    {
        $user = UvhRequest::user($request);
        $removed = DB::transaction(function () use ($id, $userId, $user): string {
            // The workspace lock serializes this removal with webhook creation,
            // whose controller rechecks membership while holding the same row.
            $actor = WorkspaceAccess::getMembershipLocked(
                $user->id,
                $id,
                'admin',
                expectedSecurityVersion: (int) $user->security_version,
            );
            if (! $actor) {
                return 'forbidden';
            }
            $target = Membership::where('user_id', $userId)->where('workspace_id', $id)->lockForUpdate()->first();
            if (! $target) {
                return 'not_found';
            }
            if ($target->role === 'owner') {
                return 'owner';
            }
            if ($actor->role !== 'owner' && $target->role === 'admin') {
                return 'admin_forbidden';
            }
            if (! WebhookService::deactivateOwnedBy($id, $userId)) {
                return 'busy';
            }
            DB::table('memberships')->where('workspace_id', $id)->where('user_id', $userId)->delete();
            DB::table('api_tokens')
                ->where('workspace_id', $id)
                ->where('created_by', $userId)
                ->whereNull('revoked_at')
                ->update(['revoked_at' => now()]);
            Invitation::where('workspace_id', $id)
                ->where('invited_by', $userId)
                ->where('status', 'pending')
                ->update(['status' => 'cancelled']);

            return 'removed';
        });
        if ($removed === 'forbidden') {
            return response()->json(['error' => 'Tu acceso al workspace cambió. Recarga antes de continuar.'], 403);
        }
        if ($removed === 'not_found') {
            return response()->json(['error' => 'Miembro no encontrado'], 404);
        }
        if ($removed === 'owner') {
            return response()->json(['error' => 'No se puede eliminar al propietario'], 403);
        }
        if ($removed === 'admin_forbidden') {
            return response()->json(['error' => 'Solo el propietario puede eliminar administradores'], 403);
        }
        if ($removed === 'busy') {
            return response()->json(['error' => 'Hay una entrega de webhook en curso para este miembro. Espera unos segundos y vuelve a intentarlo.'], 409);
        }
        Audit::write($user->id, 'workspace.member_remove', 'workspace', $id, ['userId' => $userId], UvhRequest::ip($request));

        return response()->json(['ok' => true]);
    }

    public function leave(Request $request, int $id)
    {
        $user = UvhRequest::user($request);
        $left = DB::transaction(function () use ($id, $user): string {
            $membership = WorkspaceAccess::getMembershipLocked(
                $user->id,
                $id,
                expectedSecurityVersion: (int) $user->security_version,
            );
            if (! $membership) {
                return 'not_member';
            }
            if ($membership->role === 'owner') {
                return 'owner';
            }
            if (! WebhookService::deactivateOwnedBy($id, $user->id)) {
                return 'busy';
            }
            DB::table('memberships')->where('workspace_id', $id)->where('user_id', $user->id)->delete();
            DB::table('api_tokens')
                ->where('workspace_id', $id)
                ->where('created_by', $user->id)
                ->whereNull('revoked_at')
                ->update(['revoked_at' => now()]);
            Invitation::where('workspace_id', $id)
                ->where('invited_by', $user->id)
                ->where('status', 'pending')
                ->update(['status' => 'cancelled']);

            return 'left';
        });
        if ($left === 'not_member') {
            return response()->json(['error' => 'No eres miembro'], 404);
        }
        if ($left === 'owner') {
            return response()->json(['error' => 'El propietario no puede abandonar el workspace'], 403);
        }
        if ($left === 'busy') {
            return response()->json(['error' => 'Hay una entrega de webhook en curso. Espera unos segundos y vuelve a intentarlo.'], 409);
        }
        Audit::write($user->id, 'workspace.leave', 'workspace', $id, null, UvhRequest::ip($request));

        return response()->json(['ok' => true]);
    }

    public function destroy(Request $request, int $id)
    {
        $user = UvhRequest::user($request);
        $password = UvhRequest::inputString($request, 'password');
        $factorCode = trim(UvhRequest::inputString($request, 'factorCode'));
        $confirmation = trim(UvhRequest::inputString($request, 'confirmation'));
        if ($password === '' || strlen($password) > 72 || strlen($factorCode) > 24
            || $confirmation === '' || mb_strlen($confirmation) > 120) {
            return response()->json(['error' => 'Confirma el nombre del workspace y tus credenciales'], 422);
        }
        $sessionId = UvhRequest::sessionId($request);
        try {
            $deleted = DB::transaction(function () use ($id, $user, $password, $factorCode, $confirmation, $sessionId): array {
                // Match account deletion's user -> session -> workspace lock order.
                $lockedUser = User::where('id', $user->id)->whereNull('deleted_at')->lockForUpdate()->first();
                $session = UvhSession::where('id', $sessionId)->where('user_id', $user->id)
                    ->whereNull('revoked_at')->lockForUpdate()->first();
                if (! $lockedUser || ! $lockedUser->email_verified_at || ! $session
                    || (int) $session->security_version !== (int) $lockedUser->security_version) {
                    return ['status' => 'stale'];
                }
                // Serialize deletion with webhook configuration and delivery. A
                // workspace cannot disappear while an old endpoint is still sent
                // a payload from it.
                $membership = WorkspaceAccess::getMembershipLocked(
                    $user->id,
                    $id,
                    'owner',
                    expectedSecurityVersion: (int) $user->security_version,
                );
                if (! $membership || $membership->role !== 'owner') {
                    return ['status' => 'forbidden'];
                }
                $workspace = Workspace::where('id', $id)->first();
                if (! $workspace || ! hash_equals($workspace->name, $confirmation)) {
                    return ['status' => 'confirmation'];
                }
                $stepUp = MfaStepUp::verify($lockedUser, $session, $password, $factorCode);
                if ($stepUp['status'] !== 'ok') {
                    return ['status' => $stepUp['status']];
                }
                if (! WebhookService::deactivateWorkspace($id)) {
                    return ['status' => 'busy'];
                }
                // A busy webhook returns normally from this transaction. Persist
                // recovery-code consumption only after that rejection point so a
                // rejected deletion does not silently spend a one-use credential.
                if (isset($stepUp['recovery_codes'])) {
                    $lockedUser->update(['recovery_codes' => $stepUp['recovery_codes'], 'updated_at' => now()]);
                }
                DB::table('invitations')->where('workspace_id', $id)->delete();
                DB::table('memberships')->where('workspace_id', $id)->delete();
                DB::table('workspaces')->where('id', $id)->delete();

                // The outbox is independent of workspace foreign keys, so the
                // deletion and its historical notice can commit together.
                if (! UvhMail::workspaceDeleted($lockedUser->email, $workspace->name)) {
                    throw new MailAdmissionException('Workspace deletion notice outbox admission failed');
                }

                return ['status' => 'deleted', 'factor' => $stepUp['factor']];
            });
        } catch (MailAdmissionException) {
            Audit::write($user->id, 'auth.email_delivery_failed', 'workspace', $id, ['kind' => 'workspace_deleted']);

            return response()->json(['error' => 'No se pudo guardar el aviso de seguridad. No se eliminó el workspace. Inténtalo de nuevo más tarde'], 503);
        }
        if ($deleted['status'] === 'forbidden') {
            return response()->json(['error' => 'Solo el propietario puede eliminar el workspace'], 403);
        }
        if ($deleted['status'] === 'confirmation') {
            return response()->json(['error' => 'El nombre de confirmación no coincide'], 422);
        }
        if ($deleted['status'] === 'stale') {
            return response()->json(['error' => 'La sesión cambió. Vuelve a iniciar sesión'], 409);
        }
        if ($deleted['status'] === 'password') {
            return response()->json(['error' => 'Contraseña incorrecta'], 403);
        }
        if ($deleted['status'] === 'factor') {
            return response()->json(['error' => 'El código de autenticación o recuperación es incorrecto'], 403);
        }
        if ($deleted['status'] === 'busy') {
            return response()->json(['error' => 'Hay una entrega de webhook en curso. Espera unos segundos y vuelve a intentarlo.'], 409);
        }

        Audit::write($user->id, 'workspace.delete', 'workspace', $id, ['factor' => $deleted['factor']], UvhRequest::ip($request));

        return response()->json(['ok' => true]);
    }

    public function invite(Request $request, int $id)
    {
        $user = UvhRequest::user($request);
        $m = WorkspaceAccess::getMembership($user->id, $id);
        if (! $m || ! WorkspaceAccess::roleAtLeast($m->role, 'admin')) {
            return response()->json(['error' => 'Permisos insuficientes'], 403);
        }

        $email = trim(UvhRequest::inputString($request, 'email'));
        $role = UvhRequest::inputString($request, 'role');
        if (! filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 254 || ! in_array($role, ['admin', 'editor', 'viewer'], true)) {
            return response()->json(['error' => 'Datos inválidos'], 422);
        }

        $email = strtolower($email);
        if ($role === 'admin' && $m->role !== 'owner') {
            return response()->json(['error' => 'Solo el propietario puede invitar administradores'], 403);
        }

        $existing = DB::table('memberships')
            ->where('workspace_id', $id)
            ->whereIn('user_id', DB::table('users')->whereRaw('lower(email) = ?', [$email])->select('id'))
            ->exists();
        if ($existing) {
            return response()->json(['error' => 'Este usuario ya es miembro'], 409);
        }

        $token = Ids::randomToken(32);
        $tokenHash = Ids::sha256Hex($token);
        try {
            $result = DB::transaction(function () use ($id, $email, $role, $user, $token, $tokenHash, $request): array {
                // One parent-row lock serializes invitations for this workspace,
                // including the check below and the partial unique index.
                $actor = WorkspaceAccess::getMembershipLocked(
                    $user->id,
                    $id,
                    'admin',
                    expectedSecurityVersion: (int) $user->security_version,
                );
                if (! $actor || ($role === 'admin' && $actor->role !== 'owner')) {
                    return ['status' => 'forbidden'];
                }
                // The partial unique index sees status, not time. Retire stale
                // pending rows under the workspace lock before reusing one;
                // admission failure rolls back this expiry and the new bearer.
                Invitation::where('workspace_id', $id)->where('email', $email)
                    ->where('status', 'pending')->where('expires_at', '<=', now())
                    ->update(['status' => 'expired']);
                $memberExists = DB::table('memberships')
                    ->where('workspace_id', $id)
                    ->whereIn('user_id', DB::table('users')->whereRaw('lower(email) = ?', [$email])->select('id'))
                    ->exists();
                if ($memberExists || Invitation::where('workspace_id', $id)->where('email', $email)->where('status', 'pending')->exists()) {
                    return ['status' => 'conflict'];
                }
                // This hard capacity is independent of request throttling.
                // The workspace row serializes admission by different admins;
                // expired/terminal invitations do not occupy an active slot.
                if (Invitation::where('workspace_id', $id)->where('status', 'pending')
                    ->where('expires_at', '>', now())->count() >= self::MAX_ACTIVE_INVITATIONS) {
                    return ['status' => 'limit'];
                }

                // Reserve after authorization/conflicts, before changing bearer.
                // A denied budget or mail INSERT failure rolls back the whole unit.
                InvitationMailBudget::reserve((int) $user->id, $id, $email, UvhRequest::ip($request));

                // Reuse a terminal invitation instead of retaining a permanent
                // unique-email tombstone. A new random token invalidates its link.
                $existing = Invitation::where('workspace_id', $id)->where('email', $email)
                    ->orderByDesc('id')->lockForUpdate()->first();
                $values = [
                    'role' => $role,
                    'token' => $tokenHash,
                    'invited_by' => $user->id,
                    'status' => 'pending',
                    'expires_at' => now()->addDays(7),
                ];
                if ($existing) {
                    $existing->update($values);
                    $invitation = $existing->fresh();
                } else {
                    $invitation = Invitation::create(['workspace_id' => $id, 'email' => $email, ...$values]);
                }
                $workspaceName = Workspace::where('id', $id)->value('name');
                if (! is_string($workspaceName) || ! UvhMail::invitation(
                    $email,
                    $this->appUrl().'/invitations/accept#token='.rawurlencode($token)
                        .'&expiresAt='.rawurlencode($invitation->expires_at->toIso8601String()),
                    $workspaceName,
                    $role,
                    (int) $invitation->id,
                    $tokenHash,
                )) {
                    throw new MailAdmissionException('Invitation outbox admission failed');
                }

                return ['status' => 'created'];
            });
        } catch (MailAdmissionException) {
            Audit::write($user->id, 'workspace.invitation_delivery_failed', 'workspace', $id);

            return response()->json(['error' => 'No se pudo poner en cola la invitación. Inténtalo de nuevo.'], 503);
        } catch (InvitationBudgetExceeded $error) {
            OperationalMetrics::increment('invitation.budget_rejected');

            return response()->json(['error' => 'Límite temporal de correo de invitaciones alcanzado. Inténtalo más tarde.'], 429)
                ->header('Retry-After', (string) $error->retryAfter);
        } catch (InvitationBudgetUnavailable) {
            OperationalMetrics::increment('invitation.budget_unavailable');

            return response()->json(['error' => 'No se pudo comprobar el presupuesto de correo. No se ha enviado la invitación.'], 503);
        }
        if ($result['status'] === 'forbidden') {
            return response()->json(['error' => 'Tu acceso o rol en el workspace cambió. Recarga antes de continuar.'], 403);
        }
        if ($result['status'] !== 'created') {
            if ($result['status'] === 'limit') {
                return response()->json(['error' => 'Límite de invitaciones activas alcanzado en este workspace'], 429);
            }

            return response()->json(['error' => 'Este usuario ya es miembro o ya tiene una invitación pendiente'], 409);
        }
        Audit::write($user->id, 'workspace.invite', 'workspace', $id, ['role' => $role], UvhRequest::ip($request));

        return response()->json(['ok' => true], 201);
    }

    public function acceptInvitation(Request $request)
    {
        $user = UvhRequest::user($request);
        $token = UvhRequest::inputString($request, 'token');
        if ($token === '' || strlen($token) > 256) {
            return response()->json(['error' => 'Token inválido'], 422);
        }

        $tokenHash = Ids::sha256Hex($token);
        $snapshot = Invitation::where('token', $tokenHash)->first(['workspace_id', 'invited_by']);
        $workspaceId = $snapshot ? (int) $snapshot->workspace_id : null;
        $inv = $snapshot ? DB::transaction(function () use ($tokenHash, $workspaceId, $snapshot, $user): ?Invitation {
            // Global mutation order is users -> workspace -> child resources.
            // Transfer of ownership follows this order too; locking the issuer
            // only after the workspace created a deterministic deadlock cycle.
            $userIds = array_values(array_unique([(int) $user->id, (int) $snapshot->invited_by]));
            sort($userIds, SORT_NUMERIC);
            $lockedUsers = User::whereIn('id', $userIds)->orderBy('id')->lockForUpdate()->get()->keyBy('id');
            $target = $lockedUsers->get((int) $user->id);
            $issuer = $lockedUsers->get((int) $snapshot->invited_by);
            if (! $target || $target->deleted_at || ! $target->email_verified_at
                || (int) $target->security_version !== (int) $user->security_version) {
                return null;
            }
            if (! Workspace::where('id', $workspaceId)->lockForUpdate()->first()) {
                return null;
            }
            $locked = Invitation::where('token', $tokenHash)->where('workspace_id', $workspaceId)->lockForUpdate()->first();
            if (! $locked || $locked->status !== 'pending' || $locked->expires_at->lte(now())
                || (int) $locked->invited_by !== (int) $snapshot->invited_by
                || strtolower($locked->email) !== strtolower($target->email)) {
                return null;
            }
            // An invitation is not a permanent delegation of authority. Its
            // issuer must still be active and retain the role needed for the
            // invited role at the instant the capability is consumed.
            $issuerMembership = Membership::where('workspace_id', $workspaceId)
                ->where('user_id', $locked->invited_by)->first();
            $issuerCanInvite = $issuer && ! $issuer->deleted_at && $issuer->email_verified_at && $issuerMembership
                && ($locked->role === 'admin'
                    ? $issuerMembership->role === 'owner'
                    : WorkspaceAccess::roleAtLeast($issuerMembership->role, 'admin'));
            if (! $issuerCanInvite) {
                $locked->update(['status' => 'cancelled']);

                return null;
            }
            if (Membership::where('workspace_id', $workspaceId)->where('user_id', $target->id)->exists()) {
                return null;
            }
            $locked->update(['status' => 'accepted']);
            Membership::create(['workspace_id' => $locked->workspace_id, 'user_id' => $target->id, 'role' => $locked->role]);

            return $locked->fresh();
        }) : null;
        if (! $inv) {
            return response()->json(['error' => 'Invitación inválida, cancelada o caducada'], 400);
        }

        Audit::write($user->id, 'workspace.invitation_accepted', 'workspace', $inv->workspace_id, null, UvhRequest::ip($request));

        return response()->json(['ok' => true, 'workspaceId' => $inv->workspace_id]);
    }

    public function rejectInvitation(Request $request)
    {
        $user = UvhRequest::user($request);
        $token = UvhRequest::inputString($request, 'token');
        if ($token === '' || strlen($token) > 256) {
            return response()->json(['error' => 'Token inválido'], 422);
        }

        $tokenHash = Ids::sha256Hex($token);
        $workspaceId = Invitation::where('token', $tokenHash)->value('workspace_id');
        $inv = $workspaceId ? DB::transaction(function () use ($tokenHash, $workspaceId, $user): ?Invitation {
            // Bearer rejection is still an authenticated account mutation.
            // Revalidate identity before the workspace to match the global lock
            // order and prevent a stale pre-rotation request using an old email.
            $lockedUser = User::where('id', $user->id)->lockForUpdate()->first();
            if (! $lockedUser || $lockedUser->deleted_at || ! $lockedUser->email_verified_at
                || (int) $lockedUser->security_version !== (int) $user->security_version) {
                return null;
            }
            if (! Workspace::where('id', $workspaceId)->lockForUpdate()->first()) {
                return null;
            }
            $locked = Invitation::where('token', $tokenHash)->where('workspace_id', $workspaceId)->lockForUpdate()->first();
            if (! $locked || $locked->status !== 'pending' || $locked->expires_at->lte(now())
                || strtolower($locked->email) !== strtolower($lockedUser->email)) {
                return null;
            }
            $locked->update(['status' => 'rejected']);

            return $locked;
        }) : null;
        if (! $inv) {
            return response()->json(['error' => 'Invitación inválida'], 400);
        }

        Audit::write($user->id, 'workspace.invitation_rejected', 'workspace', $inv->workspace_id, null, UvhRequest::ip($request));

        return response()->json(['ok' => true]);
    }

    public function cancelInvitation(Request $request, int $id, int $invitationId)
    {
        $user = UvhRequest::user($request);
        $changed = DB::transaction(function () use ($id, $invitationId, $user): string {
            $actor = WorkspaceAccess::getMembershipLocked(
                $user->id,
                $id,
                'admin',
                expectedSecurityVersion: (int) $user->security_version,
            );
            if (! $actor) {
                return 'access_changed';
            }
            $invitation = Invitation::where('id', $invitationId)->where('workspace_id', $id)->lockForUpdate()->first();
            if (! $invitation) {
                return 'not_found';
            }
            if ($invitation->status !== 'pending') {
                return 'not_pending';
            }
            if ($actor->role !== 'owner' && $invitation->role === 'admin') {
                return 'forbidden';
            }
            $invitation->update(['status' => 'cancelled']);

            return 'ok';
        });
        if ($changed === 'access_changed') {
            return response()->json(['error' => 'Tu acceso al workspace cambió. Recarga antes de continuar.'], 403);
        }
        if ($changed === 'not_found') {
            return response()->json(['error' => 'Invitación no encontrada'], 404);
        }
        if ($changed === 'not_pending') {
            return response()->json(['error' => 'La invitación ya no está pendiente'], 409);
        }
        if ($changed === 'forbidden') {
            return response()->json(['error' => 'Solo el propietario puede gestionar invitaciones de administrador'], 403);
        }
        Audit::write($user->id, 'workspace.invitation_cancelled', 'workspace', $id, null, UvhRequest::ip($request));

        return response()->json(['ok' => true]);
    }

    public function resendInvitation(Request $request, int $id, int $invitationId)
    {
        $user = UvhRequest::user($request);
        $newToken = Ids::randomToken(32);
        $newTokenHash = Ids::sha256Hex($newToken);
        try {
            $result = DB::transaction(function () use ($id, $invitationId, $user, $newToken, $newTokenHash, $request): array {
                $actor = WorkspaceAccess::getMembershipLocked(
                    $user->id,
                    $id,
                    'admin',
                    expectedSecurityVersion: (int) $user->security_version,
                );
                if (! $actor) {
                    return ['status' => 'forbidden'];
                }
                $invitation = Invitation::where('id', $invitationId)->where('workspace_id', $id)->lockForUpdate()->first();
                if (! $invitation || ! in_array($invitation->status, ['pending', 'expired'], true)
                    || ($actor->role !== 'owner' && $invitation->role === 'admin')) {
                    return ['status' => 'not_found'];
                }
                // An old terminal row must not create a second pending grant,
                // nor should resending imply access for an existing member.
                $memberExists = DB::table('memberships')->where('workspace_id', $id)
                    ->whereIn('user_id', DB::table('users')->whereRaw('lower(email) = ?', [strtolower($invitation->email)])->select('id'))
                    ->exists();
                $otherPending = Invitation::where('workspace_id', $id)
                    ->whereRaw('lower(email) = ?', [strtolower($invitation->email)])
                    ->where('id', '!=', $invitation->id)->where('status', 'pending')->exists();
                if ($memberExists || $otherPending) {
                    return ['status' => 'conflict'];
                }
                // A live resend reuses its slot, even with legacy excess;
                // renewing an expired row needs a new one. Use the same instant
                // for this classification and the count while holding the parent.
                $asOf = now();
                if (($invitation->status !== 'pending' || $invitation->expires_at->lte($asOf))
                    && Invitation::where('workspace_id', $id)->where('status', 'pending')
                        ->where('expires_at', '>', $asOf)->count() >= self::MAX_ACTIVE_INVITATIONS) {
                    return ['status' => 'limit'];
                }
                // The recipient comes from the locked invitation, NEVER from a
                // resend body or header that a caller can swap to bypass cooldown.
                InvitationMailBudget::reserve((int) $user->id, $id, $invitation->email, UvhRequest::ip($request));
                $invitation->update([
                    'status' => 'pending',
                    'token' => $newTokenHash,
                    'invited_by' => $user->id,
                    'expires_at' => now()->addDays(7),
                ]);
                $workspaceName = Workspace::where('id', $id)->value('name');
                if (! is_string($workspaceName) || ! UvhMail::invitation(
                    $invitation->email,
                    $this->appUrl().'/invitations/accept#token='.rawurlencode($newToken)
                        .'&expiresAt='.rawurlencode($invitation->expires_at->toIso8601String()),
                    $workspaceName,
                    $invitation->role,
                    (int) $invitation->id,
                    $newTokenHash,
                )) {
                    throw new MailAdmissionException('Invitation resend outbox admission failed');
                }

                return ['status' => 'updated'];
            });
        } catch (MailAdmissionException) {
            Audit::write($user->id, 'workspace.invitation_delivery_failed', 'workspace', $id);

            return response()->json(['error' => 'No se pudo poner en cola el reenvío. Se conservan el enlace y la caducidad anteriores.'], 503);
        } catch (InvitationBudgetExceeded $error) {
            OperationalMetrics::increment('invitation.budget_rejected');

            return response()->json(['error' => 'Límite temporal de correo de invitaciones alcanzado. Inténtalo más tarde.'], 429)
                ->header('Retry-After', (string) $error->retryAfter);
        } catch (InvitationBudgetUnavailable) {
            OperationalMetrics::increment('invitation.budget_unavailable');

            return response()->json(['error' => 'No se pudo comprobar el presupuesto de correo. Se conserva la invitación anterior.'], 503);
        }
        if ($result['status'] === 'forbidden') {
            return response()->json(['error' => 'Tu acceso al workspace cambió. Recarga antes de continuar.'], 403);
        }
        if ($result['status'] !== 'updated') {
            if ($result['status'] === 'limit') {
                return response()->json(['error' => 'Límite de invitaciones activas alcanzado en este workspace'], 429);
            }
            if ($result['status'] === 'conflict') {
                return response()->json(['error' => 'Este usuario ya es miembro o tiene otra invitación pendiente'], 409);
            }

            return response()->json(['error' => 'Invitación no encontrada, no renovable o sin permisos'], 404);
        }
        Audit::write($user->id, 'workspace.invitation_resent', 'workspace', $id, null, UvhRequest::ip($request));

        return response()->json(['ok' => true]);
    }

    // ---------------- helpers ----------------

    /** @return array{items: Collection, total: int} */
    private function membersOf(int $workspaceId, int $page, int $perPage): array
    {
        $query = DB::table('memberships as m')
            ->join('users as u', 'u.id', '=', 'm.user_id')
            ->where('m.workspace_id', $workspaceId);
        $total = (clone $query)->count();
        $items = $query
            ->orderByRaw("CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'editor' THEN 2 ELSE 3 END")
            ->orderBy('u.name')
            ->orderBy('u.id')
            ->offset(($page - 1) * $perPage)
            ->limit($perPage)
            ->get(['u.id', 'u.email', 'u.name', 'm.role', 'm.created_at as joined_at'])
            ->map(fn ($r) => [
                'id' => $r->id,
                'email' => $r->email,
                'name' => $r->name,
                'role' => $r->role,
                'joined_at' => $this->iso($r->joined_at),
            ]);

        return ['items' => $items, 'total' => $total];
    }

    /** @return array{items: Collection, total: int} */
    private function invitationsOf(int $workspaceId, int $page, int $perPage): array
    {
        // Present effective expiry without writing during GET. A worker need
        // not have materialized status=expired for the panel to be accurate.
        $asOf = now();
        $query = Invitation::where('workspace_id', $workspaceId);
        $total = (clone $query)->count();
        $items = $query
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->offset(($page - 1) * $perPage)
            ->limit($perPage)
            ->get(['id', 'email', 'role', 'status', 'expires_at', 'created_at'])
            ->map(fn ($i) => [
                'id' => $i->id,
                'email' => $i->email,
                'role' => $i->role,
                'status' => $i->status === 'pending' && $i->expires_at->lte($asOf) ? 'expired' : $i->status,
                'expires_at' => $this->iso($i->expires_at),
                'created_at' => $this->iso($i->created_at),
            ]);

        return ['items' => $items, 'total' => $total];
    }

    /** @return array{0: int, 1: int} */
    private function pagination(Request $request, string $pageKey, string $perPageKey): array
    {
        $page = $this->positiveInteger($request->query($pageKey), 1, 10_000);
        $perPage = $this->positiveInteger($request->query($perPageKey), 25, 100);

        return [$page, $perPage];
    }

    private function positiveInteger(mixed $value, int $default, int $max): int
    {
        if (is_string($value) && preg_match('/^[0-9]+$/D', $value)) {
            $value = (int) $value;
        }

        return is_int($value) && $value >= 1 ? min($value, $max) : $default;
    }

    private function appUrl(): string
    {
        return rtrim((string) config('app.url'), '/');
    }

    private function iso(mixed $value): ?string
    {
        return \App\Support\IsoDate::format($value);
    }
}
