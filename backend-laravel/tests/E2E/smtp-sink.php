<?php

declare(strict_types=1);

/**
 * Minimal SMTP sink for the async E2E stack.
 *
 * `UvhMail::sendNow` only bypasses the transport for `log`/`array` mailers,
 * so proving the real mail chain (outbox row -> queue worker -> SMTP
 * acceptance -> `sent`) requires a reachable SMTP server. This one speaks
 * just enough ESMTP for Symfony Mailer and records every attempt on disk.
 *
 * Two properties matter more than they look:
 *
 *  * Symfony Mailer pools the connection for the lifetime of a worker and
 *    reuses it, so one connection carries many transactions. Each DATA block
 *    is therefore a separate message with its own body and its own file; the
 *    idle timeout must never fire between two deliveries.
 *  * Behaviour is driven by the shared fixture state (see fixture-control.php)
 *    so a scenario can force a provider failure without restarting anything:
 *      {"mode": "accept"}   -> 250 after DATA (default)
 *      {"mode": "reject"}   -> 451 after DATA, so the outbox must retry
 *      {"rejectNext": 1}    -> reject one attempt, then accept again
 *
 * messages/<connection>-<sequence>.eml holds what the provider received and
 * attempts.jsonl holds one line per transaction, so a scenario can assert both
 * the number of provider attempts and the message behind each of them.
 */
$stateFile = (string) (getenv('UVH_FIXTURE_STATE') ?: '/state/mail.json');
$stateDir = dirname($stateFile);
$messagesDir = $stateDir.'/messages';
$port = (int) (getenv('UVH_SMTP_SINK_PORT') ?: 1025);

@mkdir($messagesDir, 0777, true);
@mkdir($stateDir, 0777, true);

$state = static function () use ($stateFile): array {
    $raw = @file_get_contents($stateFile);
    $decoded = is_string($raw) ? json_decode($raw, true) : null;

    return is_array($decoded) ? $decoded : [];
};

$record = static function (array $entry) use ($stateDir): void {
    @file_put_contents(
        $stateDir.'/attempts.jsonl',
        json_encode($entry, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR)."\n",
        FILE_APPEND,
    );
};

$server = @stream_socket_server('tcp://0.0.0.0:'.$port, $errno, $errstr);
if ($server === false) {
    fwrite(STDERR, "smtp-sink: cannot listen on {$port}: {$errstr}\n");
    exit(1);
}
fwrite(STDOUT, "smtp-sink listening on {$port}\n");

$connection = 0;

while (true) {
    $conn = @stream_socket_accept($server, -1);
    if ($conn === false) {
        continue;
    }
    // Symfony Mailer pools the connection for the lifetime of the mail worker
    // and reuses it for the next job. A short idle timeout here made the first
    // delivery succeed and every later one fail with a broken pipe, which
    // looks exactly like a product bug.
    stream_set_timeout($conn, 3600);
    $connection++;
    $sequence = 0;

    $from = '';
    $rcpt = [];
    $data = '';

    $send = static function (string $line) use ($conn): void {
        @fwrite($conn, $line."\r\n");
    };
    $line = static function () use ($conn): ?string {
        $read = @fgets($conn, 8192);

        return is_string($read) ? rtrim($read, "\r\n") : null;
    };

    $send('220 uvh-mail-sink ESMTP');

    while (($command = $line()) !== null) {
        $upper = strtoupper($command);
        if (str_starts_with($upper, 'EHLO') || str_starts_with($upper, 'HELO')) {
            // Pipelining is deliberately not advertised: the sink answers one
            // command at a time, so the client must wait for each reply.
            $send('250-uvh-mail-sink');
            $send('250-8BITMIME');
            $send('250 SIZE 10485760');
        } elseif (str_starts_with($upper, 'MAIL FROM')) {
            // A new transaction must not inherit the previous message body.
            $from = trim((string) preg_replace('/^MAIL FROM:\s*/i', '', $command), '<>');
            $rcpt = [];
            $data = '';
            $send('250 2.1.0 Ok');
        } elseif (str_starts_with($upper, 'RCPT TO')) {
            $rcpt[] = trim((string) preg_replace('/^RCPT TO:\s*/i', '', $command), '<>');
            $send('250 2.1.5 Ok');
        } elseif (str_starts_with($upper, 'DATA')) {
            $send('354 End data with <CR><LF>.<CR><LF>');
            while (($chunk = $line()) !== null) {
                if ($chunk === '.') {
                    break;
                }
                // RFC 5321 transparency: a leading dot is doubled by the client.
                $data .= (str_starts_with($chunk, '..') ? substr($chunk, 1) : $chunk)."\n";
            }
            $sequence++;

            $current = $state();
            $mode = (string) ($current['mode'] ?? 'accept');
            $rejectNext = max(0, (int) ($current['rejectNext'] ?? 0));
            if ($mode !== 'reject' && $rejectNext > 0) {
                $current['rejectNext'] = $rejectNext - 1;
                @file_put_contents($stateFile.'.tmp', json_encode($current, JSON_UNESCAPED_SLASHES));
                @rename($stateFile.'.tmp', $stateFile);
            }
            $rejected = $mode === 'reject' || $rejectNext > 0;

            if ($rejected) {
                $send('451 4.4.1 Temporary provider failure');
                $record([
                    'connection' => $connection,
                    'sequence' => $sequence,
                    'from' => $from,
                    'rcpt' => $rcpt,
                    'accepted' => false,
                ]);

                continue;
            }

            $file = sprintf('%s/%04d-%02d.eml', $messagesDir, $connection, $sequence);
            @file_put_contents($file, $data);
            $record([
                'connection' => $connection,
                'sequence' => $sequence,
                'message' => $file,
                'from' => $from,
                'rcpt' => $rcpt,
                'accepted' => true,
            ]);
            $send('250 2.0.0 Ok: queued');
        } elseif (str_starts_with($upper, 'RSET')) {
            $from = '';
            $rcpt = [];
            $data = '';
            $send('250 2.0.0 Ok');
        } elseif (str_starts_with($upper, 'NOOP')) {
            $send('250 2.0.0 Ok');
        } elseif (str_starts_with($upper, 'QUIT')) {
            $send('221 2.0.0 Bye');
            break;
        } else {
            $send('250 2.0.0 Ok');
        }
    }

    @fclose($conn);
}
