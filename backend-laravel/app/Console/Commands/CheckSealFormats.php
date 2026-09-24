<?php

namespace App\Console\Commands;

use App\Support\SealFormatTelemetry;
use App\Support\UvhCrypto;
use Carbon\Carbon;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * Verifica si quedan sellos del formato legacy (sin key-id) en vuelo y cuándo
 * puede retirarse el fallback de `SealedToken`/`SignedToken`.
 *
 * Los sellos viven en cookies y enlaces del cliente: el servidor no puede
 * enumerarlos. Lo que sí puede es (a) registrar toda apertura legacy que
 * ocurra de verdad (`SealFormatTelemetry`) y (b) acotar cuándo dejaron de
 * emitirse con el marcador de primera emisión v2. Con el TTL más largo de las
 * superficies, la ventana se cierra sola: pasado `última huella legacy +
 * TTL máximo`, ningún sello legacy puede seguir vivo —ni válido, ni abierto— y
 * el fallback es código muerto que puede borrarse.
 *
 * La huella legacy más reciente es el máximo entre la última apertura observada
 * y el final de la emisión legacy (el `--since` del operador, o el marcador v2,
 * que acota por arriba por el arranque rodante).
 *
 * Códigos de salida: 0 = retirada certificada (ningún legacy en vuelo),
 * 2 = aún en vuelo o ventana sin cerrar, 1 = no evaluable (ni marcador ni
 * `--since`).
 */
final class CheckSealFormats extends Command
{
    protected $signature = 'uvh:crypto:seals
        {--since= : Fecha ISO-8601 en la que dejaron de emitirse sellos legacy; por defecto, el marcador v2 observado}
        {--json : Informe legible por máquina}';

    protected $description = 'Comprueba si quedan sellos legacy en vuelo y cuándo puede retirarse el fallback de formato';

    public function handle(): int
    {
        $surfaces = $this->surfaces();
        $maxTtl = max(array_column($surfaces, 'ttl'));

        $opens = DB::table('audit_events')
            ->where('action', SealFormatTelemetry::ACTION_LEGACY_OPENED)
            ->selectRaw('resource_id as kind, count(*) as total, min(created_at) as first_seen, max(created_at) as last_seen')
            ->groupBy('resource_id')
            ->orderBy('resource_id')
            ->get();
        $lastOpen = $opens->max('last_seen') !== null ? Carbon::parse($opens->max('last_seen')) : null;
        $marker = DB::table('audit_events')
            ->where('action', SealFormatTelemetry::ACTION_V2_FIRST_ISSUED)
            ->min('created_at');

        $since = null;
        if (($option = trim((string) $this->option('since'))) !== '') {
            try {
                $since = Carbon::parse($option);
            } catch (Throwable) {
                $this->error("--since no es una fecha ISO-8601 válida: {$option}");

                return 1;
            }
        }
        $legacyEnd = $since ?? ($marker !== null ? Carbon::parse($marker) : null);

        // La huella legacy más reciente acota cuándo pudo emitirse el último
        // sello viejo: el final de la emisión o la última apertura observada.
        $footprint = $legacyEnd;
        if ($lastOpen !== null) {
            $footprint = $footprint === null ? $lastOpen : $footprint->max($lastOpen);
        }
        $closesAt = $footprint === null ? null : $footprint->copy()->addSeconds($maxTtl);

        if ($footprint === null) {
            $verdict = 'unknown';
            $code = 1;
            $message = 'No evaluable: no hay marcador v2 ni --since. Despliega la versión con telemetría o pasa --since con la fecha del despliegue.';
        } elseif ($closesAt !== null && now()->greaterThanOrEqualTo($closesAt)) {
            $verdict = 'clear';
            $code = 0;
            $message = 'Retirada certificada: ningún sello legacy puede seguir vivo (la huella más reciente ya superó el TTL máximo).';
        } else {
            $verdict = 'in_flight';
            $code = 2;
            $message = 'Aún en vuelo: la ventana cierra el '.$closesAt->toIso8601String()
                .' (faltan '.now()->diffInHours($closesAt).' h). No retires el fallback todavía.';
        }

        $report = [
            'verdict' => $verdict,
            'message' => $message,
            'max_ttl_seconds' => $maxTtl,
            'legacy_issuance_ended_at' => $legacyEnd?->toIso8601String(),
            'v2_marker_at' => $marker !== null ? Carbon::parse($marker)->toIso8601String() : null,
            'last_legacy_open_at' => $lastOpen?->toIso8601String(),
            'fallback_retires_at' => $closesAt?->toIso8601String(),
            'legacy_opens' => $opens->map(fn ($row) => [
                'kind' => (string) $row->kind,
                'total' => (int) $row->total,
                'first_seen' => Carbon::parse($row->first_seen)->toIso8601String(),
                'last_seen' => Carbon::parse($row->last_seen)->toIso8601String(),
            ])->all(),
            'surfaces' => $surfaces,
            'keyring' => [
                'current_key_id' => UvhCrypto::keyId(UvhCrypto::secret()),
                'previous_keys' => count((array) config('uvh.secret_previous', [])),
                'rotation_until' => (string) config('uvh.secret_rotation_until', ''),
            ],
        ];

        if ($this->option('json')) {
            $this->line((string) json_encode($report, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));

            return $code;
        }

        $this->info('Formatos de sello en vuelo');
        $this->newLine();
        $this->table(
            ['Superficie', 'Familia', 'TTL (s)'],
            array_map(fn (array $surface): array => [$surface['surface'], $surface['family'], (string) $surface['ttl']], $surfaces),
        );
        $this->line('TTL máximo: '.$maxTtl.' s');
        $this->line('Keyring: '.$report['keyring']['current_key_id']
            .' (+'.$report['keyring']['previous_keys'].' anteriores, rotación hasta «'
            .$report['keyring']['rotation_until'].'»)');
        $this->newLine();
        if ($opens->isEmpty()) {
            $this->line('Aperturas legacy observadas: ninguna.');
        } else {
            $this->table(
                ['Familia', 'Aperturas', 'Primera', 'Última'],
                $opens->map(fn ($row) => [
                    (string) $row->kind,
                    (string) $row->total,
                    Carbon::parse($row->first_seen)->toIso8601String(),
                    Carbon::parse($row->last_seen)->toIso8601String(),
                ])->all(),
            );
        }
        $this->newLine();
        $this->line('Emisión legacy acotada en: '.($legacyEnd?->toIso8601String() ?? 'desconocida'));
        $this->line('El fallback puede retirarse el: '.($closesAt?->toIso8601String() ?? 'desconocida'));
        $this->newLine();
        match ($verdict) {
            'clear' => $this->info($message),
            'in_flight' => $this->warn($message),
            default => $this->error($message),
        };

        return $code;
    }

    /**
     * Cada superficie por la que viaja un sello, con su TTL real: el comando
     * calcula el techo con la configuración viva, no con constantes.
     *
     * @return list<array{surface: string, family: string, ttl: int}>
     */
    private function surfaces(): array
    {
        return [
            [
                'surface' => 'Cookie de edición de registro (RegistrationEdit)',
                'family' => 'sealed',
                'ttl' => max(60, (int) config('uvh.registration_edit_ttl_hours') * 3600),
            ],
            [
                'surface' => 'Cookie de aparcamiento de invitación (PendingHandoff)',
                'family' => 'signed',
                'ttl' => max(60, (int) config('uvh.invitation_ttl_days') * 86400),
            ],
            [
                'surface' => 'Cookie de aparcamiento de intención (PendingHandoff)',
                'family' => 'signed',
                'ttl' => max(60, (int) config('uvh.intent_ttl_hours') * 3600),
            ],
            [
                // El desbloqueo de enlace con contraseña dura 10 minutos
                // (RedirectController); no es configurable.
                'surface' => 'Cookie de desbloqueo de enlace (unlock)',
                'family' => 'signed',
                'ttl' => 600,
            ],
        ];
    }
}
