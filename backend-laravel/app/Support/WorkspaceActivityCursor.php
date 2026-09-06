<?php

namespace App\Support;

use Illuminate\Contracts\Encryption\DecryptException;
use Illuminate\Support\Facades\Crypt;

/** Authenticated pagination position; possession never grants workspace access. */
final class WorkspaceActivityCursor
{
    public const TTL = 3600;

    public static function issue(int $workspaceId, int $userId, int $version, string $createdAt, string $id, int $expiresAt): string
    {
        return Crypt::encryptString(json_encode([
            'purpose' => 'workspace-activity-v1', 'workspaceId' => $workspaceId,
            'userId' => $userId, 'securityVersion' => $version,
            'createdAt' => $createdAt, 'id' => $id, 'expiresAt' => $expiresAt,
        ], JSON_THROW_ON_ERROR));
    }

    /** @return array{createdAt: string, id: string, expiresAt: int} */
    public static function read(string $cursor, int $workspaceId, int $userId, int $version): array
    {
        if (strlen($cursor) > 2048 || $cursor === '') {
            throw new \InvalidArgumentException('Invalid activity cursor');
        }
        $decoded = base64_decode($cursor, true);
        if ($decoded === false || base64_encode($decoded) !== $cursor) {
            // Do not accept alternate encodings/trailing junk that a permissive
            // base64 decoder would silently ignore before authenticating the MAC.
            throw new \InvalidArgumentException('Invalid activity cursor');
        }
        try {
            $data = json_decode(Crypt::decryptString($cursor), true, 16, JSON_THROW_ON_ERROR);
        } catch (DecryptException|\JsonException $error) {
            throw new \InvalidArgumentException('Invalid activity cursor', 0, $error);
        }
        if (! is_array($data) || ($data['purpose'] ?? null) !== 'workspace-activity-v1'
            || ($data['workspaceId'] ?? null) !== $workspaceId || ($data['userId'] ?? null) !== $userId
            || ($data['securityVersion'] ?? null) !== $version
            || ! is_int($data['expiresAt'] ?? null) || $data['expiresAt'] <= now()->timestamp
            || $data['expiresAt'] > now()->timestamp + self::TTL
            || ! is_string($data['id'] ?? null) || ! preg_match('/^[1-9][0-9]{0,18}$/D', $data['id'])
            || filter_var($data['id'], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]) === false
            || ! is_string($data['createdAt'] ?? null)
            || ! preg_match('/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}\+00:00$/D', $data['createdAt'])) {
            throw new \InvalidArgumentException('Invalid activity cursor');
        }
        $date = \DateTimeImmutable::createFromFormat('!Y-m-d\TH:i:s.uP', $data['createdAt']);
        if (! $date || $date->format('Y-m-d\TH:i:s.uP') !== $data['createdAt']) {
            throw new \InvalidArgumentException('Invalid activity cursor');
        }

        // Keep the original expiry across pages; pagination cannot renew a
        // stolen cursor indefinitely. Account rotations also invalidate it.
        return ['createdAt' => $data['createdAt'], 'id' => $data['id'], 'expiresAt' => $data['expiresAt']];
    }
}
