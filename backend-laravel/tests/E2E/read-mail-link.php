<?php

declare(strict_types=1);

use App\Support\MailDeliveryEligibility;
use App\Support\UvhCrypto;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\DB;

require dirname(__DIR__, 2).'/vendor/autoload.php';
$app = require dirname(__DIR__, 2).'/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

$database = (string) config('database.connections.'.config('database.default').'.database');
if (! app()->environment('testing') || ! str_ends_with($database, '_test')) {
    fwrite(STDERR, "Refusing to inspect mail outside APP_ENV=testing and a _test database.\n");
    exit(64);
}

$email = strtolower(trim((string) ($argv[1] ?? '')));
$kind = trim((string) ($argv[2] ?? ''));
if (! filter_var($email, FILTER_VALIDATE_EMAIL) || $kind === '') {
    fwrite(STDERR, "Usage: php tests/E2E/read-mail-link.php <email> <kind>\n");
    exit(64);
}

// Recipient and bearer URL are encrypted together. Decrypt only a bounded set
// inside the test process and print solely the requested URL to stdout.
//
// The outbox is read the way the delivery jobs read it, not the way it is
// written: an admission whose state has moved on is suppressed and never reaches
// a mailbox, so a helper that returned its link would hand the suite a bearer no
// inbox ever receives. `change-registration-email` pays exactly one of those for
// a destination that is already taken, and `register` pays another when the
// address is occupied, so this filter is also what keeps those two from looking
// like mail.
$rows = DB::table('mail_outbox')->where('kind', $kind)->orderByDesc('id')->limit(100)->get();
foreach ($rows as $row) {
    if (! MailDeliveryEligibility::isCurrent($row)) {
        continue;
    }
    try {
        $message = json_decode(UvhCrypto::decryptAtRest((string) $row->encrypted_envelope), true, 512, JSON_THROW_ON_ERROR);
    } catch (Throwable) {
        continue;
    }
    if (! is_array($message) || strtolower((string) ($message['to'] ?? '')) !== $email) {
        continue;
    }
    $text = is_string($message['text'] ?? null) ? $message['text'] : '';
    if (preg_match('~https?://[^\s<>"\']+~', $text, $match) === 1) {
        fwrite(STDOUT, rtrim($match[0], '.,);').PHP_EOL);
        exit(0);
    }
}

fwrite(STDERR, "No matching E2E mail link was found.\n");
exit(1);
