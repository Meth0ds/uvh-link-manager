<?php

namespace App\Console\Commands;

use App\Support\Ids;
use App\Support\PrivateArtifact;
use App\Support\PrivateArtifactCleanup;
use App\Support\Streams;
use App\Support\UvhCrypto;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

/** Re-encrypt every live at-rest payload with the current APP_SECRET. */
final class RotateAppSecret extends Command
{
    protected $signature = 'uvh:crypto:rotate {--dry-run : Verify readability and report pending rows without writing}';

    protected $description = 'Re-encrypt UVH at-rest secrets with the current APP_SECRET';

    /** @var array<string, int> */
    private array $counts = [];

    public function handle(): int
    {
        // A rotation is intentionally a two-key operation. Refusing to run
        // without a previous key prevents an operator from discovering only
        // halfway through the scan that old ciphertext is already unreadable.
        if (count(UvhCrypto::secrets()) < 2) {
            $this->error('Configura APP_SECRET_PREVIOUS antes de iniciar una rotación.');

            return self::INVALID;
        }

        try {
            $lock = Cache::lock('uvh:crypto:rotation', 3600);
            if (! $lock->get()) {
                $this->error('Ya hay otra rotación criptográfica en curso.');

                return self::FAILURE;
            }
        } catch (\Throwable) {
            $this->error('El almacén compartido de locks no está disponible.');

            return self::FAILURE;
        }

        try {
            $dryRun = (bool) $this->option('dry-run');
            // Keep this inventory explicit. Adding a new encryptAtRest column
            // elsewhere must be accompanied by a new entry here and in the
            // rotation runbook; a broad schema scan could accidentally touch
            // unrelated ciphertext or application data.
            $this->rotateColumn('users', 'mfa_secret', $dryRun);
            $this->rotateColumn('users', 'mfa_pending_secret', $dryRun);
            $this->rotateColumn('webhooks', 'secret', $dryRun);
            $this->rotateColumn('mail_outbox', 'encrypted_envelope', $dryRun);
            $this->rotateColumn('privacy_rights_messages', 'encrypted_body', $dryRun);
            $this->rotateExportArtifacts($dryRun);

            foreach ($this->counts as $resource => $count) {
                $this->line($resource.': '.$count);
            }
            $this->info($dryRun
                ? 'Verificación completada; no se ha modificado ningún dato.'
                : 'Recifrado completado. Mantén las claves anteriores hasta agotar tokens y jobs anteriores.');

            return self::SUCCESS;
        } catch (\Throwable $e) {
            $this->error('Rotación detenida: '.$e->getMessage());
            $this->warn('No retires APP_SECRET_PREVIOUS. El comando es reanudable después de corregir el dato o almacenamiento afectado.');

            return self::FAILURE;
        } finally {
            try {
                $lock->release();
            } catch (\Throwable) {
                // The lease is bounded; failure to release must not hide the
                // result of the data rotation itself.
            }
        }
    }

    private function rotateColumn(string $table, string $column, bool $dryRun): void
    {
        $this->counts[$table.'.'.$column] = 0;

        DB::table($table)
            ->whereNotNull($column)
            ->where($column, '<>', '')
            ->select('id')
            ->orderBy('id')
            ->chunkById(100, function ($rows) use ($table, $column, $dryRun): void {
                foreach ($rows as $row) {
                    // Lock and re-read each row. A concurrent request may have
                    // already rewritten it with the current key after the ID
                    // page was selected; encryptedWithCurrentKey makes that
                    // race a harmless no-op instead of a double rewrite.
                    $changed = DB::transaction(function () use ($table, $column, $row, $dryRun): bool {
                        $locked = DB::table($table)->where('id', $row->id)->lockForUpdate()->first(['id', $column]);
                        if (! $locked) {
                            return false;
                        }
                        $ciphertext = $locked->{$column};
                        if (! is_string($ciphertext) || $ciphertext === '' || UvhCrypto::encryptedWithCurrentKey($ciphertext)) {
                            return false;
                        }

                        $plain = UvhCrypto::decryptAtRest($ciphertext);
                        if (! $dryRun) {
                            DB::table($table)->where('id', $row->id)->update([
                                $column => UvhCrypto::encryptAtRest($plain),
                            ]);
                        }

                        return true;
                    }, 3);

                    if ($changed) {
                        $this->counts[$table.'.'.$column]++;
                    }
                }
            });
    }

    private function rotateExportArtifacts(bool $dryRun): void
    {
        $resource = 'data_export_requests.artifact_path';
        $this->counts[$resource] = 0;

        DB::table('data_export_requests')
            ->whereNotNull('artifact_path')
            ->where('artifact_path', '<>', '')
            ->select('id')
            ->orderBy('id')
            ->chunkById(25, function ($rows) use ($resource, $dryRun): void {
                foreach ($rows as $row) {
                    $changed = DB::transaction(function () use ($row, $dryRun): bool {
                        $request = DB::table('data_export_requests')->where('id', $row->id)
                            ->lockForUpdate()->first(['id', 'artifact_path']);
                        $path = $request?->artifact_path;
                        if (! is_string($path) || $path === '') {
                            return false;
                        }
                        if (! PrivateArtifactCleanup::isManagedPath($path)) {
                            throw new \RuntimeException('ruta de artefacto privado inválida (id '.$row->id.')');
                        }

                        $disk = Storage::disk('local');
                        if (! $disk->exists($path)) {
                            throw new \RuntimeException('falta un artefacto privado de exportación (id '.$row->id.')');
                        }
                        $in = $disk->readStream($path);
                        if (! is_resource($in)) {
                            throw new \RuntimeException('no se pudo leer un artefacto privado de exportación (id '.$row->id.')');
                        }
                        // Recifrado por streaming, bloque a bloque: la
                        // generación sostiene el artefacto con la memoria de un
                        // bloque y la rotación también —un artefacto de 256 MiB
                        // jamás cabe en la RAM de una rotación—. El temporal
                        // vive en el mismo volumen privado para que el rename
                        // publique un blob completo y autenticado en una sola
                        // operación filesystem; la fila sigue bloqueada,
                        // serializando descargas y limpiezas contra el
                        // reemplazo del artefacto concreto.
                        $temporary = 'account-exports/.rotate-'.Ids::randomToken(18);
                        $disk->makeDirectory('account-exports');
                        $out = @fopen($disk->path($temporary), 'wb');
                        if (! is_resource($out)) {
                            fclose($in);
                            throw new \RuntimeException('no se pudo escribir un artefacto temporal de exportación (id '.$row->id.')');
                        }
                        try {
                            $changed = PrivateArtifact::reencryptStream($in, $out);
                            Streams::flush($out);
                        } finally {
                            fclose($in);
                            fclose($out);
                        }
                        // Sin cambios = ya estaba con la clave actual: el
                        // temporal se descarta. En dry-run también, dejando
                        // intacto el original.
                        if ($dryRun || ! $changed) {
                            $disk->delete($temporary);

                            return $changed;
                        }

                        $source = $disk->path($temporary);
                        $destination = $disk->path($path);
                        if (! @rename($source, $destination)) {
                            $disk->delete($temporary);
                            throw new \RuntimeException('no se pudo publicar el artefacto recifrado (id '.$row->id.')');
                        }

                        return true;
                    }, 3);

                    if ($changed) {
                        $this->counts[$resource]++;
                    }
                }
            });
    }
}
