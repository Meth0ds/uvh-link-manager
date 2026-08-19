<?php

namespace App\Http\Controllers;

use App\Models\Invitation;
use App\Models\Workspace;
use App\Support\Audit;
use App\Support\Ids;
use App\Support\UvhMail;
use App\Support\UvhRequest;
use App\Support\WorkspaceAccess;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class WorkspaceController
{
    private const MAX_OWNED_WORKSPACES = 20;

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
        $name = trim((string) $request->input('name', ''));

        if (mb_strlen($name) < 2 || mb_strlen($name) > 80 || preg_match('/[\x00-\x1f\x7f]/', $name)) {
            return response()->json(['error' => 'Nombre inválido'], 422);
        }

        $owned = Workspace::where('owner_user_id', $user->id)->count();
        if ($owned >= self::MAX_OWNED_WORKSPACES) {
            return response()->json(['error' => 'Límite de workspaces alcanzado'], 429);
        }

        $workspace = DB::transaction(function () use ($name, $user) {
            $w = Workspace::create([
                'name' => $name,
                'slug' => 'ws-'.strtolower(Ids::randomToken(6)),
                'owner_user_id' => $user->id,
            ]);
            $w->memberships()->create(['user_id' => $user->id, 'role' => 'owner']);
            $w->quota()->create(['links_limit' => 1000]);

            return $w;
        });

        Audit::write($user->id, 'workspace.create', 'workspace', $workspace->id, null, UvhRequest::ip($request));

        return response()->json(['workspace' => [
            'id' => $workspace->id,
            'name' => $workspace->name,
            'slug' => $workspace->slug,
            'role' => null,
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

        return response()->json([
            'workspace' => [
                'id' => $workspace->id,
                'name' => $workspace->name,
                'slug' => $workspace->slug,
                'role' => $m->role,
                'createdAt' => $this->iso($workspace->created_at),
            ],
            'members' => $this->membersOf($id),
            'invitations' => WorkspaceAccess::roleAtLeast($m->role, 'admin') ? $this->invitationsOf($id) : [],
        ]);
    }

    public function rename(Request $request, int $id)
    {
        $user = UvhRequest::user($request);
        $m = WorkspaceAccess::getMembership($user->id, $id);
        if (! $m || ! WorkspaceAccess::roleAtLeast($m->role, 'admin')) {
            return response()->json(['error' => 'Permisos insuficientes'], 403);
        }

        $name = trim((string) $request->input('name', ''));
        if (mb_strlen($name) < 2 || mb_strlen($name) > 80 || preg_match('/[\x00-\x1f\x7f]/', $name)) {
            return response()->json(['error' => 'Nombre inválido'], 422);
        }

        Workspace::where('id', $id)->update(['name' => $name, 'updated_at' => now()]);
        Audit::write($user->id, 'workspace.rename', 'workspace', $id, null, UvhRequest::ip($request));

        return response()->json(['ok' => true]);
    }

    public function changeRole(Request $request, int $id, int $userId)
    {
        $user = UvhRequest::user($request);
        $m = WorkspaceAccess::getMembership($user->id, $id);
        if (! $m || ! WorkspaceAccess::roleAtLeast($m->role, 'admin')) {
            return response()->json(['error' => 'Permisos insuficientes'], 403);
        }

        $role = (string) $request->input('role', '');
        // Ownership is an invariant, not a selectable member role. A crafted
        // request must never be able to create a second owner or transfer
        // ownership without an explicit ownership workflow.
        if (! in_array($role, ['owner', 'admin', 'editor', 'viewer'], true)) {
            return response()->json(['error' => 'Rol inválido'], 422);
        }
        if ($role === 'owner') {
            return response()->json(['error' => 'La transferencia de propiedad requiere un flujo explícito'], 403);
        }

        $target = WorkspaceAccess::getMembership($userId, $id);
        if (! $target) {
            return response()->json(['error' => 'Miembro no encontrado'], 404);
        }
        if ($target->role === 'owner') {
            return response()->json(['error' => 'No se puede cambiar el rol del propietario'], 403);
        }
        if ($m->role !== 'owner' && ($role === 'owner' || $target->role === 'admin')) {
            return response()->json(['error' => 'Solo el propietario puede asignar el rol de propietario o gestionar administradores'], 403);
        }

        $target->update(['role' => $role]);
        Audit::write($user->id, 'workspace.role_change', 'workspace', $id, ['userId' => $userId, 'role' => $role], UvhRequest::ip($request));

        return response()->json(['ok' => true]);
    }

    public function removeMember(Request $request, int $id, int $userId)
    {
        $user = UvhRequest::user($request);
        $m = WorkspaceAccess::getMembership($user->id, $id);
        if (! $m || ! WorkspaceAccess::roleAtLeast($m->role, 'admin')) {
            return response()->json(['error' => 'Permisos insuficientes'], 403);
        }

        $target = WorkspaceAccess::getMembership($userId, $id);
        if (! $target) {
            return response()->json(['error' => 'Miembro no encontrado'], 404);
        }
        if ($target->role === 'owner') {
            return response()->json(['error' => 'No se puede eliminar al propietario'], 403);
        }
        if ($m->role !== 'owner' && $target->role === 'admin') {
            return response()->json(['error' => 'Solo el propietario puede eliminar administradores'], 403);
        }

        $target->delete();
        Audit::write($user->id, 'workspace.member_remove', 'workspace', $id, ['userId' => $userId], UvhRequest::ip($request));

        return response()->json(['ok' => true]);
    }

    public function leave(Request $request, int $id)
    {
        $user = UvhRequest::user($request);
        $m = WorkspaceAccess::getMembership($user->id, $id);
        if (! $m) {
            return response()->json(['error' => 'No eres miembro'], 404);
        }
        if ($m->role === 'owner') {
            return response()->json(['error' => 'El propietario no puede abandonar el workspace'], 403);
        }

        $m->delete();
        Audit::write($user->id, 'workspace.leave', 'workspace', $id, null, UvhRequest::ip($request));

        return response()->json(['ok' => true]);
    }

    public function destroy(Request $request, int $id)
    {
        $user = UvhRequest::user($request);
        $m = WorkspaceAccess::getMembership($user->id, $id);
        if (! $m || $m->role !== 'owner') {
            return response()->json(['error' => 'Solo el propietario puede eliminar el workspace'], 403);
        }

        DB::transaction(function () use ($id) {
            DB::table('invitations')->where('workspace_id', $id)->delete();
            DB::table('memberships')->where('workspace_id', $id)->delete();
            DB::table('workspaces')->where('id', $id)->delete();
        });

        Audit::write($user->id, 'workspace.delete', 'workspace', $id, null, UvhRequest::ip($request));

        return response()->json(['ok' => true]);
    }

    public function invite(Request $request, int $id)
    {
        $user = UvhRequest::user($request);
        $m = WorkspaceAccess::getMembership($user->id, $id);
        if (! $m || ! WorkspaceAccess::roleAtLeast($m->role, 'admin')) {
            return response()->json(['error' => 'Permisos insuficientes'], 403);
        }

        $email = trim((string) $request->input('email', ''));
        $role = (string) $request->input('role', '');
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

        $pending = Invitation::where('workspace_id', $id)->where('email', $email)->where('status', 'pending')->exists();
        if ($pending) {
            return response()->json(['error' => 'Ya existe una invitación pendiente'], 409);
        }

        $token = Ids::randomToken(32);
        Invitation::create([
            'workspace_id' => $id,
            'email' => $email,
            'role' => $role,
            'token' => Ids::sha256Hex($token),
            'invited_by' => $user->id,
            'status' => 'pending',
            'expires_at' => now()->addDays(7),
        ]);

        $workspace = Workspace::find($id);
        UvhMail::invitation($email, $this->appUrl().'/invitations/accept?token='.rawurlencode($token), $workspace->name, $role);

        Audit::write($user->id, 'workspace.invite', 'workspace', $id, ['email' => $email, 'role' => $role], UvhRequest::ip($request));

        return response()->json(['ok' => true], 201);
    }

    public function acceptInvitation(Request $request)
    {
        $user = UvhRequest::user($request);
        $token = (string) $request->input('token', '');
        if ($token === '') {
            return response()->json(['error' => 'Token inválido'], 422);
        }

        $inv = Invitation::where('token', Ids::sha256Hex($token))->first();
        if (! $inv || $inv->status !== 'pending' || $inv->expires_at->isPast()) {
            return response()->json(['error' => 'Invitación inválida o caducada'], 400);
        }
        if (strtolower($inv->email) !== strtolower($user->email)) {
            return response()->json(['error' => 'Esta invitación no está dirigida a tu cuenta'], 403);
        }

        DB::transaction(function () use ($inv, $user) {
            $inv->update(['status' => 'accepted']);
            DB::table('memberships')->updateOrInsert(
                ['workspace_id' => $inv->workspace_id, 'user_id' => $user->id],
                ['role' => $inv->role, 'created_at' => now()],
            );
        });

        Audit::write($user->id, 'workspace.invitation_accepted', 'workspace', $inv->workspace_id, null, UvhRequest::ip($request));

        return response()->json(['ok' => true, 'workspaceId' => $inv->workspace_id]);
    }

    public function rejectInvitation(Request $request)
    {
        $user = UvhRequest::user($request);
        $token = (string) $request->input('token', '');
        if ($token === '') {
            return response()->json(['error' => 'Token inválido'], 422);
        }

        $inv = Invitation::where('token', Ids::sha256Hex($token))->first();
        if (! $inv || $inv->status !== 'pending' || strtolower($inv->email) !== strtolower($user->email)) {
            return response()->json(['error' => 'Invitación inválida'], 400);
        }

        $inv->update(['status' => 'rejected']);

        return response()->json(['ok' => true]);
    }

    public function cancelInvitation(Request $request, int $id, int $invitationId)
    {
        $user = UvhRequest::user($request);
        $m = WorkspaceAccess::getMembership($user->id, $id);
        if (! $m || ! WorkspaceAccess::roleAtLeast($m->role, 'admin')) {
            return response()->json(['error' => 'Permisos insuficientes'], 403);
        }

        $inv = Invitation::where('id', $invitationId)->where('workspace_id', $id)->first();
        if (! $inv) {
            return response()->json(['error' => 'Invitación no encontrada'], 404);
        }

        $inv->update(['status' => 'cancelled']);
        Audit::write($user->id, 'workspace.invitation_cancelled', 'workspace', $id, null, UvhRequest::ip($request));

        return response()->json(['ok' => true]);
    }

    public function resendInvitation(Request $request, int $id, int $invitationId)
    {
        $user = UvhRequest::user($request);
        $m = WorkspaceAccess::getMembership($user->id, $id);
        if (! $m || ! WorkspaceAccess::roleAtLeast($m->role, 'admin')) {
            return response()->json(['error' => 'Permisos insuficientes'], 403);
        }

        $inv = Invitation::where('id', $invitationId)->where('workspace_id', $id)->first();
        if (! $inv || $inv->status !== 'pending') {
            return response()->json(['error' => 'Invitación no encontrada o no pendiente'], 404);
        }

        $newToken = Ids::randomToken(32);
        $inv->update(['token' => Ids::sha256Hex($newToken), 'expires_at' => now()->addDays(7)]);

        $workspace = Workspace::find($id);
        UvhMail::invitation($inv->email, $this->appUrl().'/invitations/accept?token='.rawurlencode($newToken), $workspace->name, $inv->role);

        return response()->json(['ok' => true]);
    }

    // ---------------- helpers ----------------

    private function membersOf(int $workspaceId)
    {
        return DB::table('memberships as m')
            ->join('users as u', 'u.id', '=', 'm.user_id')
            ->where('m.workspace_id', $workspaceId)
            ->orderByRaw("CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'editor' THEN 2 ELSE 3 END")
            ->orderBy('u.name')
            ->get(['u.id', 'u.email', 'u.name', 'm.role', 'm.created_at as joined_at'])
            ->map(fn ($r) => [
                'id' => $r->id,
                'email' => $r->email,
                'name' => $r->name,
                'role' => $r->role,
                'joined_at' => $this->iso($r->joined_at),
            ]);
    }

    private function invitationsOf(int $workspaceId)
    {
        return Invitation::where('workspace_id', $workspaceId)
            ->orderByDesc('created_at')
            ->get(['id', 'email', 'role', 'status', 'expires_at', 'created_at'])
            ->map(fn ($i) => [
                'id' => $i->id,
                'email' => $i->email,
                'role' => $i->role,
                'status' => $i->status,
                'expires_at' => $this->iso($i->expires_at),
                'created_at' => $this->iso($i->created_at),
            ]);
    }

    private function appUrl(): string
    {
        return rtrim((string) config('app.url'), '/');
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
