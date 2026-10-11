<?php

namespace App\Support;

class DestinationHttpTransport
{
    /** @return array{status: int, body: string, headers: array<string, string>, truncated: bool} */
    public function request(string $url, string $method, int $timeoutMs, int $maxBytes): array
    {
        return Ssrf::safeRead($url, $method, $timeoutMs, $maxBytes);
    }
}
