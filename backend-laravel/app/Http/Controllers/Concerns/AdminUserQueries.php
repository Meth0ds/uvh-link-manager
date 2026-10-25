<?php

namespace App\Http\Controllers\Concerns;

use App\Models\User;
use App\Support\UvhRequest;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

trait AdminUserQueries
{
    public function users(Request $request)
    {
        [$page, $perPage] = $this->pagination($request);
        $search = $this->search($request);
        $status = UvhRequest::queryString($request, 'status');
        // Sin `unverified`: una fila de usuario está verificada por definición
        // —el registro sin verificar vive en `pending_registrations` y sólo la
        // activación crea usuario—. Lo que una vez fue ese filtro es la cola de
        // «Registros pendientes»; filtrar aquí por `email_verified_at` miraría
        // una columna que ya no significa lo que su nombre dice.
        if (! in_array($status, ['', 'active', 'blocked', 'admin', 'mfa'], true)) {
            return response()->json(['error' => __('messages.error_47d0d60336607f')], 422);
        }

        $columns = ['u.id', 'u.email', 'u.name', 'u.is_admin', 'u.email_verified_at', 'u.mfa_enabled', 'u.created_at', 'u.deleted_at'];
        $query = DB::table('users as u')->select($columns);

        if ($search !== '') {
            $query->where(fn ($q) => $q->where('u.email', 'ilike', $search)->orWhere('u.name', 'ilike', $search));
        }

        match ($status) {
            'active' => $query->whereNull('u.deleted_at'),
            'blocked' => $query->whereNotNull('u.deleted_at'),
            'admin' => $query->whereNull('u.deleted_at')->where('u.is_admin', true),
            'mfa' => $query->whereNull('u.deleted_at')->where('u.mfa_enabled', true),
            default => null,
        };

        $total = (clone $query)->count();
        // Deterministic tiebreaker: rows created in the same second must not
        // reorder between pages, or a page boundary would repeat one and skip
        // another.
        $userPage = $query->orderByDesc('u.created_at')->orderByDesc('u.id')
            ->offset(($page - 1) * $perPage)
            ->limit($perPage);
        // Resolve the page before counting. Counts in the inner projection
        // would also run for every user skipped by OFFSET, even on empty pages.
        $rows = DB::query()->fromSub($userPage, 'u')->select($columns)
            ->selectRaw('(SELECT COUNT(*) FROM memberships m WHERE m.user_id = u.id) AS workspaces,
                (SELECT COUNT(*) FROM links l WHERE l.created_by = u.id AND l.deleted_at IS NULL) AS links')
            ->orderByDesc('u.created_at')->orderByDesc('u.id')
            ->get();

        return response()->json([
            'users' => $rows,
            'total' => $total,
            'page' => $page,
            'perPage' => $perPage,
        ]);
    }

    /**
     * Registros sin verificar: la cola que el filtro `unverified` de usuarios
     * dejó de representar cuando el registro pasó a vivir en su propia tabla.
     *
     * Sólo email, alta, último correo de verificación emitido y la caducidad de
     * su enlace: lo que un operador necesita para responder «¿llegó el correo?
     * ¿sigue vivo el enlace?», y nada más. Ni propuesta de contraseña —no se
     * guarda—, ni bearers, ni existencia de cuentas asociadas: esta lista nombra
     * registros pendientes y sólo eso. Admin-gated como el resto de la consola:
     * un listado de direcciones que aún no tienen cuenta no debe salir de aquí.
     */
    public function pendingRegistrations(Request $request): JsonResponse
    {
        [$page, $perPage] = $this->pagination($request);
        $search = $this->search($request);

        // El último correo de verificación es el bearer `verify` más reciente:
        // token y sobre salen en la misma transacción, así que su creación es la
        // emisión del correo. La caducidad que se muestra es la del enlace de
        // ese mismo correo (un día), no la retención de la fila (30 días desde
        // la última actividad, la purga de housekeeping).
        $query = DB::table('pending_registrations as p')
            ->select('p.id', 'p.email', 'p.created_at')
            ->selectRaw("(SELECT MAX(t.created_at) FROM email_tokens t WHERE t.pending_registration_id = p.id AND t.kind = 'verify') AS last_mail_at")
            ->selectRaw("(SELECT MAX(t.expires_at) FROM email_tokens t WHERE t.pending_registration_id = p.id AND t.kind = 'verify') AS link_expires_at");

        if ($search !== '') {
            $query->where('p.email', 'ilike', $search);
        }

        $total = (clone $query)->count();
        $rows = $query->orderByDesc('p.created_at')->orderByDesc('p.id')
            ->offset(($page - 1) * $perPage)
            ->limit($perPage)
            ->get();

        return response()->json([
            'registrations' => $rows,
            'total' => $total,
            'page' => $page,
            'perPage' => $perPage,
        ]);
    }
}
