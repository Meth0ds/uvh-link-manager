<?php

declare(strict_types=1);

use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;

require dirname(__DIR__, 2).'/vendor/autoload.php';
$app = require dirname(__DIR__, 2).'/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

$database = (string) config('database.connections.'.config('database.default').'.database');
if (! app()->environment('testing') || ! str_ends_with($database, '_test')) {
    fwrite(STDERR, "Refusing to mutate sessions outside APP_ENV=testing and a _test database.\n");
    exit(64);
}

$email = mb_strtolower(trim((string) ($argv[1] ?? '')));
if (! filter_var($email, FILTER_VALIDATE_EMAIL)) {
    fwrite(STDERR, "Usage: php tests/E2E/age-mfa-session.php <email>\n");
    exit(64);
}

$updated = DB::transaction(function () use ($email): int {
    $userId = DB::table('users')->whereRaw('lower(email) = ?', [$email])->value('id');
    if (! is_int($userId)) {
        return 0;
    }

    // Age only the sole live MFA-authenticated session. Sixty-one minutes is
    // beyond the maximum configurable freshness window, while expiry and every
    // other security attribute remain untouched.
    return DB::table('sessions')
        ->where('user_id', $userId)
        ->whereNull('revoked_at')
        ->whereNotNull('mfa_verified_at')
        ->update(['mfa_verified_at' => now()->subMinutes(61)]);
}, 3);

if ($updated !== 1) {
    fwrite(STDERR, "Expected exactly one live MFA session; updated {$updated}.\n");
    exit(1);
}

fwrite(STDOUT, "aged\n");
