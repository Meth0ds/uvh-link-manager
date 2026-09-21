<?php

declare(strict_types=1);

/**
 * Account exports: the request row, the private artifacts on disk, the seed the
 * crash drill fits, and the two schedules it advances (confirmation and
 * abandonment).
 */

use App\Jobs\GenerateDataExportJob;
use App\Support\Ids;
use App\Support\UvhCrypto;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

// One shape for every reader. The drill compares rows captured at different
// moments, so a field present in one reader and missing in another would read
// as a difference in the product rather than in this file.
$describe = static fn ($row): array => $row === null ? [] : [
    'id' => (int) $row->id,
    'status' => (string) $row->status,
    'artifact' => $row->artifact_path !== null ? basename((string) $row->artifact_path) : null,
    'ready_at' => $row->ready_at !== null ? (string) $row->ready_at : null,
    'downloaded_at' => $row->downloaded_at !== null ? (string) $row->downloaded_at : null,
    // Prefixes only: enough to match a bearer without ever printing usable or
    // reversible token material.
    'confirmation_hash' => is_string($row->confirmation_token_hash) ? substr($row->confirmation_token_hash, 0, 12) : null,
    'download_hash' => is_string($row->download_token_hash) ? substr($row->download_token_hash, 0, 12) : null,
];

return [
    'export' => static fn (string $argument): array => $describe(DB::table('data_export_requests')->where('id', (int) $argument)->first()),
    'export-latest' => static fn (string $argument): array => $describe(DB::table('data_export_requests')->orderByDesc('id')->first()),
    'export-seed' => static function (string $argument): array {
        [$email, $messages, $bytes] = array_pad(preg_split('/\s+/', trim($argument)) ?: [], 3, '');
        $requestedMessages = (int) $messages;
        $perMessageBytes = (int) $bytes;
        $user = DB::table('users')->whereRaw('lower(email) = ?', [mb_strtolower($email)])->first(['id', 'security_version']);
        if (! $user || $requestedMessages < 1 || $requestedMessages > 9_500 || $perMessageBytes < 64 || $perMessageBytes > 262_144) {
            return ['error' => 'expected "<email> <messages 1..9500> <bytes-per-message 64..262144>"'];
        }
        // The automated path's own budget, read from the job that applies it
        // rather than restated here: the fitting target and the drill's
        // assertions are then about that ceiling, not about a copy of it.
        $cap = (int) (new ReflectionClassConstant(GenerateDataExportJob::class, 'MAX_JSON_BYTES'))->getValue();
        $target = $cap - 512 * 1024;
        $requestId = (int) DB::table('privacy_rights_requests')->insertGetId([
            'user_id' => (int) $user->id,
            'security_version' => (int) $user->security_version,
            'type' => 'access',
            'status' => 'submitted',
            'generation_hash' => Ids::sha256Hex(Ids::randomToken(32)),
            'due_at' => now()->addDays(30),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $body = UvhCrypto::encryptAtRest(str_repeat('a', $perMessageBytes));
        $builder = new ReflectionMethod(GenerateDataExportJob::class, 'buildPayload');
        $builder->setAccessible(true);
        $job = new GenerateDataExportJob($requestId);
        $messageCount = $requestedMessages;
        $encoded = 0;
        for ($attempt = 0; $attempt < 4; $attempt++) {
            DB::table('privacy_rights_messages')->where('request_id', $requestId)->delete();
            $rows = [];
            for ($index = 0; $index < $messageCount; $index++) {
                $rows[] = [
                    'request_id' => $requestId,
                    'author_role' => 'system',
                    'author_user_id' => null,
                    'encrypted_body' => $body,
                    'created_at' => now(),
                ];
            }
            foreach (array_chunk($rows, 200) as $chunk) {
                DB::table('privacy_rights_messages')->insert($chunk);
            }
            unset($rows);
            $payload = $builder->invoke($job, (int) $user->id);
            $encoded = strlen(json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR));
            unset($payload);
            gc_collect_cycles();
            if ($encoded <= $target) {
                break;
            }
            $messageCount = max(1, (int) floor($messageCount * $target / $encoded) - 8);
        }

        return [
            'request_id' => $requestId,
            'requested_messages' => $requestedMessages,
            'messages' => $messageCount,
            'bytes_per_message' => $perMessageBytes,
            'plaintext_bytes' => $messageCount * $perMessageBytes,
            'json_bytes' => $encoded,
            'cap_bytes' => $cap,
            'headroom_bytes' => $cap - $encoded,
        ];
    },
    // Past the 30-minute window after which housekeeping retires a request
    // whose worker never came back. Same idea as `mail-outbox-stale`.
    // The retention and recovery stages of housekeeping run on their own
    // cadence (HOUSEKEEPING_INTERVAL_MINUTES). Opening that window now is the
    // same kind of lever as `mail-warp`: the stage and its logic are untouched,
    // only the clock that gates it is moved, so the drill can observe the
    // recovery a production deployment gets on its next heavy pass.

    'export-age' => static fn (string $argument): array => ['aged' => DB::table('data_export_requests')->where('id', (int) $argument)
        ->where('status', 'processing')->update(['updated_at' => now()->subMinutes(31)])],
    // What the private volume holds right now, so "no orphan" is a reading and
    // not a promise. Names and sizes only; the bytes are ciphertext.

    'export-artifacts' => static function (string $argument): array {
        $disk = Storage::disk('local');
        $files = [];
        foreach ($disk->files('account-exports') as $file) {
            $size = $disk->size($file);
            $files[] = ['name' => basename($file), 'bytes' => is_int($size) ? $size : -1];
        }
        usort($files, static fn (array $a, array $b): int => strcmp($a['name'], $b['name']));

        return $files;
    },
    // Re-runs the job that a killed worker was holding, which is what the
    // broker does when its reservation expires. The point of the drill is that
    // the second execution must be a no-op once the row is terminal.

    'export-dispatch' => static function (string $argument): array {
        GenerateDataExportJob::dispatch((int) $argument);

        return ['dispatched' => true];
    },
];
