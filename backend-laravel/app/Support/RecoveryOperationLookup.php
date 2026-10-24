<?php

namespace App\Support;

final class RecoveryOperationLookup
{
    /** @param array<string, mixed> $snapshot
     * @return array<string, mixed>|null
     */
    public static function find(array $snapshot, string $id): ?array
    {
        foreach ([$snapshot['operation'] ?? null, ...($snapshot['history'] ?? [])] as $operation) {
            if (is_array($operation) && ($operation['id'] ?? null) === $id) {
                return $operation;
            }
        }

        return null;
    }

    /** @param array<string, mixed> $operation
     * @return list<array<string, mixed>>
     */
    public static function events(array $operation, int $cursor): array
    {
        /** @var list<array<string, mixed>> $events */
        $events = array_values(array_filter(
            $operation['events'] ?? [],
            static fn ($event): bool => is_array($event) && ($event['sequence'] ?? 0) > $cursor,
        ));

        return $events;
    }
}
