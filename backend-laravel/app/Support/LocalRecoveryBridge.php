<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;

/** Local transport only. No host commands, credentials or arbitrary filesystem paths. */
final class LocalRecoveryBridge
{
    private function path(string $file): string
    {
        if (! config('recovery.enabled') || app()->environment('production')) {
            throw new RuntimeException('El centro de recuperación solo está disponible en el entorno local.');
        }
        $root = config('recovery.bridge');
        if (! is_string($root) || ! is_dir($root) || is_link($root)) {
            throw new RuntimeException('Inicia UVH Control y configura el puente local de recuperación.');
        }

        return $root.'/'.$file;
    }

    private function key(): string
    {
        $path = $this->path('key');
        if (! is_file($path) || is_link($path) || filesize($path) !== 64) {
            throw new RuntimeException('El puente local no está emparejado.');
        }
        $key = file_get_contents($path);
        if (! is_string($key) || preg_match('/^[a-f0-9]{64}$/D', $key) !== 1) {
            throw new RuntimeException('Clave del puente local no válida.');
        }

        return $key;
    }

    /** @param array<string, mixed> $value
     * @return array{body: string, mac: string}
     */
    public function sign(array $value): array
    {
        $body = json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);

        return ['body' => $body, 'mac' => hash_hmac('sha256', $body, $this->key())];
    }

    /** @return array<string, mixed> */
    public function read(string $file): array
    {
        $path = $this->path($file);
        if (! is_file($path) || is_link($path) || filesize($path) > 4 * 1024 * 1024) {
            throw new RuntimeException('El controlador no ha publicado un estado válido.');
        }
        $frame = json_decode((string) file_get_contents($path), true, 32, JSON_THROW_ON_ERROR);
        if (! is_array($frame) || ! is_string($frame['body'] ?? null) || ! is_string($frame['mac'] ?? null)
            || ! hash_equals(hash_hmac('sha256', $frame['body'], $this->key()), $frame['mac'])) {
            throw new RuntimeException('No se pudo autenticar el estado del controlador.');
        }
        $value = json_decode($frame['body'], true, 32, JSON_THROW_ON_ERROR);
        if (! is_array($value)) {
            throw new RuntimeException('Estado local no válido.');
        }

        return $value;
    }

    /** @return array<string, mixed> */
    public function snapshot(): array
    {
        $value = $this->read('snapshot.json');
        if (! is_numeric($value['expires'] ?? null) || $value['expires'] < (int) floor(microtime(true) * 1000)) {
            throw new RuntimeException('El estado del controlador está desactualizado. Inicia UVH Control.');
        }

        return $value;
    }

    /** Independent receipts are replayed after a DB restore, without duplicate audit events.
     * @param  array<string, mixed>  $snapshot
     */
    public function reconcileAudit(array $snapshot): void
    {
        $events = [];
        foreach (array_slice($snapshot['auditEvents'] ?? [], -1000) as $event) {
            if (! is_array($event) || ! Str::isUuid($event['id'] ?? '') || ! is_string($event['action'] ?? null)
                || preg_match('/^[a-z._-]{1,100}$/D', $event['action']) !== 1) {
                continue;
            }
            // The previous per-event loop admitted the first occurrence.
            $events[$event['id']] ??= $event;
        }
        if ($events === []) {
            return;
        }
        $received = DB::table('local_recovery_audit_receipts')->whereIn('event_id', array_keys($events))->pluck('event_id')->all();
        foreach ($received as $id) {
            unset($events[$id]);
        }
        // insertOrIgnore inside each transaction still arbitrates concurrent
        // reconcilers; the batch read only removes already completed work.
        foreach ($events as $event) {
            DB::transaction(function () use ($event): void {
                if (DB::table('local_recovery_audit_receipts')->insertOrIgnore(['event_id' => $event['id'], 'received_at' => now()]) === 0) {
                    return;
                }
                $actor = is_numeric($event['actor'] ?? null) ? (int) $event['actor'] : null;
                if ($actor !== null && ! DB::table('users')->where('id', $actor)->exists()) {
                    $actor = null;
                }
                Audit::write($actor, 'local_recovery.'.$event['action'], 'local_operation', $event['id']);
            });
        }
    }

    public function ticket(int $actor): string
    {
        return rtrim(strtr(base64_encode(json_encode($this->sign([
            'purpose' => 'recovery-access', 'id' => (string) Str::uuid(), 'actor' => $actor,
            'expires' => (int) floor(microtime(true) * 1000) + 60000,
        ]), JSON_THROW_ON_ERROR)), '+/', '-_'), '=');
    }

    /** @param array<string, mixed> $target */
    public function enqueue(string $id, int $actor, string $action, array $target): void
    {
        $path = $this->path('requests/'.$id.'.json');
        $value = $this->sign([
            'purpose' => 'recovery-command', 'id' => $id, 'actor' => $actor, 'action' => $action,
            'target' => $target === [] ? (object) [] : $target,
            'expires' => (int) floor(microtime(true) * 1000) + 120000,
        ]);
        $temporary = $path.'.'.Str::uuid().'.tmp';
        try {
            $handle = fopen($temporary, 'x');
            if ($handle === false) {
                throw new RuntimeException('No se pudo entregar la solicitud al controlador.');
            }
            try {
                chmod($temporary, 0600);
                $bytes = json_encode($value, JSON_THROW_ON_ERROR);
                if (fwrite($handle, $bytes) !== strlen($bytes) || ! fflush($handle)) {
                    throw new RuntimeException('No se pudo persistir la solicitud local.');
                }
            } finally {
                fclose($handle);
            }
            if (! rename($temporary, $path)) {
                throw new RuntimeException('No se pudo admitir la solicitud local.');
            }
        } finally {
            if (is_file($temporary)) {
                unlink($temporary);
            }
        }
    }
}
