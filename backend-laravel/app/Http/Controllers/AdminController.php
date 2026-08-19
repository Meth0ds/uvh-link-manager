<?php

namespace App\Http\Controllers;

use App\Support\Audit;
use App\Support\UvhRequest;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class AdminController
{
    public function overview()
    {
        return response()->json([
            'users' => DB::table('users')->whereNull('deleted_at')->count(),
            'workspaces' => DB::table('workspaces')->count(),
            'links' => DB::table('links')->whereNull('deleted_at')->count(),
            'clicks' => DB::table('click_events')->count(),
            'openReports' => DB::table('abuse_reports')->where('status', 'open')->count(),
            'blockedLinks' => DB::table('links')->where('state', 'blocked')->count(),
            'domains' => DB::table('custom_domains')->count(),
        ]);
    }

    public function users(Request $request)
    {
        $search = (string) $request->query('q', '');
        $query = DB::table('users as u')
            ->selectRaw('u.id, u.email, u.name, u.is_admin, u.email_verified_at, u.mfa_enabled, u.created_at, u.deleted_at,
                (SELECT COUNT(*) FROM memberships m WHERE m.user_id = u.id) AS workspaces,
                (SELECT COUNT(*) FROM links l WHERE l.created_by = u.id) AS links');

        if ($search !== '') {
            $like = "%{$search}%";
            $query->where(fn ($q) => $q->where('u.email', 'ilike', $like)->orWhere('u.name', 'ilike', $like));
        }

        $rows = $query->orderByDesc('u.created_at')->limit(100)->get();

        return response()->json(['users' => $rows]);
    }

    public function updateUser(Request $request, int $id)
    {
        $user = DB::table('users')->where('id', $id)->first();
        if (! $user) {
            return response()->json(['error' => 'Usuario no encontrado'], 404);
        }

        $isAdmin = $request->input('isAdmin');
        $blocked = $request->input('blocked');

        if (($isAdmin === false || $blocked === true) && (bool) $user->is_admin && ! $user->deleted_at) {
            $activeAdmins = DB::table('users')->where('is_admin', true)->whereNull('deleted_at')->count();
            if ($activeAdmins <= 1) {
                return response()->json(['error' => 'Debe quedar al menos un administrador activo'], 403);
            }
        }

        if ($isAdmin !== null) {
            DB::table('users')->where('id', $id)->update(['is_admin' => (bool) $isAdmin]);
            Audit::write(UvhRequest::user($request)->id, 'admin.user_role', 'user', $id, ['isAdmin' => (bool) $isAdmin], UvhRequest::ip($request));
        }
        if ($blocked !== null) {
            DB::table('users')->where('id', $id)->update(['deleted_at' => $blocked ? now() : null]);
            if ($blocked) {
                DB::table('sessions')->where('user_id', $id)->whereNull('revoked_at')->update(['revoked_at' => now()]);
                DB::table('api_tokens')->where('created_by', $id)->whereNull('revoked_at')->update(['revoked_at' => now()]);
            }
            Audit::write(UvhRequest::user($request)->id, 'admin.user_block', 'user', $id, ['blocked' => (bool) $blocked], UvhRequest::ip($request));
        }

        return response()->json(['ok' => true]);
    }

    public function reports(Request $request)
    {
        $status = (string) $request->query('status', '');
        $query = DB::table('abuse_reports as r')
            ->join('links as l', 'l.id', '=', 'r.link_id')
            ->select('r.*', 'l.alias', 'l.destination', 'l.state as link_state', 'l.workspace_id');

        if ($status !== '') {
            $query->where('r.status', $status);
        }

        $rows = $query->orderByDesc('r.created_at')->limit(100)->get();

        return response()->json(['reports' => $rows]);
    }

    public function updateReport(Request $request, int $id)
    {
        $status = (string) $request->input('status', '');
        if (! in_array($status, ['open', 'reviewed', 'actioned', 'dismissed'], true)) {
            return response()->json(['error' => 'Estado inválido'], 422);
        }

        $row = DB::table('abuse_reports')->where('id', $id)->first();
        if (! $row) {
            return response()->json(['error' => 'Denuncia no encontrada'], 404);
        }

        DB::table('abuse_reports')->where('id', $id)->update(['status' => $status]);
        Audit::write(UvhRequest::user($request)->id, 'admin.report_status', 'abuse_report', $id, ['status' => $status], UvhRequest::ip($request));

        return response()->json(['ok' => true]);
    }

    public function blockLink(Request $request, int $id)
    {
        $reason = (string) $request->input('reason', '');
        if (mb_strlen($reason) < 3 || mb_strlen($reason) > 500) {
            return response()->json(['error' => 'Motivo requerido'], 422);
        }

        $row = DB::table('links')->where('id', $id)->first();
        if (! $row) {
            return response()->json(['error' => 'Enlace no encontrado'], 404);
        }

        DB::table('links')->where('id', $id)->update(['state' => 'blocked', 'updated_at' => now()]);
        Audit::write(UvhRequest::user($request)->id, 'admin.link_block', 'link', $id, ['reason' => $reason], UvhRequest::ip($request));

        return response()->json(['ok' => true]);
    }

    public function unblockLink(Request $request, int $id)
    {
        $row = DB::table('links')->where('id', $id)->first();
        if (! $row) {
            return response()->json(['error' => 'Enlace no encontrado'], 404);
        }

        DB::table('links')->where('id', $id)->update(['state' => 'active', 'updated_at' => now()]);
        Audit::write(UvhRequest::user($request)->id, 'admin.link_unblock', 'link', $id, null, UvhRequest::ip($request));

        return response()->json(['ok' => true]);
    }

    public function domains()
    {
        $rows = DB::table('custom_domains as d')
            ->join('workspaces as w', 'w.id', '=', 'd.workspace_id')
            ->select('d.*', 'w.name as workspace_name')
            ->orderByDesc('d.created_at')
            ->limit(100)
            ->get();

        return response()->json(['domains' => $rows]);
    }

    public function audit(Request $request)
    {
        $page = (int) $request->query('page', 1);
        $page = $page > 0 ? $page : 1;
        $perPage = 50;

        $rows = DB::table('audit_events')->orderByDesc('created_at')
            ->offset(($page - 1) * $perPage)->limit($perPage)->get();
        $total = DB::table('audit_events')->count();

        return response()->json(['events' => $rows, 'total' => $total, 'page' => $page]);
    }
}
