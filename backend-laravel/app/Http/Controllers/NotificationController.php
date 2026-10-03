<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Support\Auth\AccountReadContext;
use App\Support\IsoDate;
use App\Support\NotificationInbox;
use App\Support\NotificationKinds;
use App\Support\NotificationPreferences;
use App\Support\SecurityContext;
use App\Support\StaleSecurityContext;
use App\Support\UvhRequest;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * El centro de notificaciones de la cuenta: bandeja paginada, lectura
 * individual o total y preferencias de aviso.
 *
 * Todo queda atado a la sesión: cada consulta filtra por la cuenta autenticada,
 * de modo que un identador ajeno no encuentra nada que leer ni marcar. La
 * respuesta minimiza: identidad del evento, nombre visible ya capturado y
 * ruta interna; nunca secretos, URLs bearer ni contenido de correo.
 */
final class NotificationController extends Controller
{
    private const PAGE_SIZE = 20;

    /** Bandeja, de más reciente a más antigua, con paginación por cursor. */
    public function index(Request $request): JsonResponse
    {
        $user = $this->liveReadUser($request);
        if ($user === null) {
            return response()->json(['error' => 'No autenticado'], 401);
        }
        $limit = self::boundedLimit($request->query('limit'));
        $before = $request->query('before');
        $cursor = is_string($before) && preg_match('/^[1-9][0-9]*$/D', $before) === 1 ? (int) $before : null;

        $query = DB::table('notifications')->where('user_id', (int) $user->id);
        if ($cursor !== null) {
            $query->where('id', '<', $cursor);
        }
        // Un id extra por página distingue «hay más» de «se acabó» sin una
        // segunda consulta de conteo.
        $rows = $query->orderByDesc('id')->limit($limit + 1)->get();
        $page = $rows->take($limit);
        $notifications = $page->map(fn ($row): array => [
            'id' => (int) $row->id,
            'kind' => (string) $row->kind,
            'subject' => is_string($row->subject) ? $row->subject : null,
            'workspaceId' => $row->workspace_id !== null ? (int) $row->workspace_id : null,
            'route' => is_string($row->route) ? $row->route : null,
            'createdAt' => IsoDate::format($row->created_at),
            'readAt' => IsoDate::format($row->read_at),
        ])->values()->all();

        return response()->json([
            'notifications' => $notifications,
            'unread' => NotificationInbox::unreadCount((int) $user->id),
            'nextCursor' => $rows->count() > $limit ? (int) $page->last()->id : null,
        ]);
    }

    /** Sólo el contador, para la campana del panel. */
    public function unread(Request $request): JsonResponse
    {
        $user = $this->liveReadUser($request);
        if ($user === null) {
            return response()->json(['error' => 'No autenticado'], 401);
        }

        return response()->json(['unread' => NotificationInbox::unreadCount((int) $user->id)]);
    }

    /** Marca una notificación propia como leída; una ajena no existe. */
    public function read(Request $request, string $id): JsonResponse
    {
        $unread = DB::transaction(function () use ($request, $id): ?int {
            $user = $this->lockedUser($request);
            $updated = DB::table('notifications')
                ->where('user_id', (int) $user->id)
                ->where('id', (int) $id)
                ->whereNull('read_at')
                ->update(['read_at' => now()]);

            if ($updated === 0) {
                $exists = DB::table('notifications')
                    ->where('user_id', (int) $user->id)
                    ->where('id', (int) $id)
                    ->exists();
                if (! $exists) {
                    return null;
                }
            }

            return NotificationInbox::unreadCount((int) $user->id);
        });
        if ($unread === null) {
            return response()->json(['error' => 'Notificación no encontrada'], 404);
        }

        return response()->json(['unread' => $unread]);
    }

    /** Marca toda la bandeja como leída. */
    public function readAll(Request $request): JsonResponse
    {
        DB::transaction(function () use ($request): void {
            $user = $this->lockedUser($request);
            DB::table('notifications')
                ->where('user_id', (int) $user->id)
                ->whereNull('read_at')
                ->update(['read_at' => now()]);
        });

        return response()->json(['unread' => 0]);
    }

    /** El catálogo entero con la entrega efectiva de cada kind. */
    public function preferences(Request $request): JsonResponse
    {
        $user = $this->liveReadUser($request);
        if ($user === null) {
            return response()->json(['error' => 'No autenticado'], 401);
        }

        return response()->json(['preferences' => $this->preferenceView((int) $user->id)]);
    }

    /**
     * Aplica cambios de preferencia. El lote se valida entero antes de
     * escribir: un kind desconocido, un kind obligatorio o una entrega fuera
     * del catálogo rechazan la petición completa sin tocar nada.
     */
    public function updatePreferences(Request $request): JsonResponse
    {
        $input = $request->input('preferences');
        if (! is_array($input) || $input === []) {
            return response()->json(['error' => 'Datos inválidos'], 422);
        }

        $changes = [];
        foreach ($input as $entry) {
            if (! is_array($entry)
                || ! isset($entry['kind'], $entry['delivery'])
                || ! is_string($entry['kind'])
                || ! is_string($entry['delivery'])) {
                return response()->json(['error' => 'Datos inválidos'], 422);
            }
            if (array_key_exists($entry['kind'], $changes)) {
                return response()->json(['error' => 'Datos inválidos'], 422);
            }
            $changes[$entry['kind']] = $entry['delivery'];
        }

        try {
            $preferences = DB::transaction(function () use ($request, $changes): array {
                $user = $this->lockedUser($request);
                NotificationPreferences::update((int) $user->id, $changes, $request->ip());

                return $this->preferenceView((int) $user->id);
            });
        } catch (\InvalidArgumentException) {
            // El mensaje distingue lo que el usuario puede arreglar (entrega
            // inválida) de lo que nunca se acepta (silenciar un aviso crítico).
            $locked = array_filter(
                array_keys($changes),
                static fn (string $kind): bool => NotificationKinds::exists($kind) && NotificationKinds::isMandatory($kind),
            );
            if ($locked !== []) {
                return response()->json(['error' => 'Los avisos de seguridad no se pueden desactivar'], 422);
            }

            return response()->json(['error' => 'Datos inválidos'], 422);
        }

        return response()->json(['preferences' => $preferences]);
    }

    private function liveReadUser(Request $request): ?User
    {
        return AccountReadContext::resolve(UvhRequest::user($request), UvhRequest::sessionId($request))?->user;
    }

    /** Only inside the transaction that will commit the notification command. */
    private function lockedUser(Request $request): User
    {
        $context = SecurityContext::lock(UvhRequest::user($request), UvhRequest::sessionId($request), true);
        if ($context === null) {
            throw new StaleSecurityContext;
        }

        return $context->user;
    }

    /** @return list<array{kind: string, category: string, delivery: string}> */
    private function preferenceView(int $userId): array
    {
        $deliveries = NotificationPreferences::deliveriesFor($userId);

        return array_map(
            static fn (string $kind, array $shape): array => [
                'kind' => $kind,
                'category' => $shape['category'],
                'delivery' => $deliveries[$kind],
            ],
            array_keys(NotificationKinds::all()),
            array_values(NotificationKinds::all()),
        );
    }

    private function boundedLimit(mixed $raw): int
    {
        return is_string($raw) && preg_match('/^[1-9][0-9]{0,2}$/D', $raw) === 1
            ? min((int) $raw, self::PAGE_SIZE)
            : self::PAGE_SIZE;
    }
}
