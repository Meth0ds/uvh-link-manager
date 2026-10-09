<?php

namespace App\Support;

/** A complete, bounded public identity; shared by publication and release gates. */
final class LegalIdentity
{
    /**
     * @param  array<string, mixed>  $values
     * @return array{name: string, taxId: string, address: string, registryStatus: 'registered'|'not_registered', registry: ?string, hostingProvider: string, hostingRegion: string}|null
     */
    public static function publicProjection(array $values): ?array
    {
        // Existing deployments remain registered unless they explicitly declare
        // otherwise. Being an individual does not establish registration status.
        $status = array_key_exists('registry_status', $values) ? $values['registry_status'] : 'registered';
        if (! in_array($status, ['registered', 'not_registered'], true)) {
            return null;
        }

        $name = self::field($values['name'] ?? null, 2, 200);
        $taxId = self::field($values['tax_id'] ?? null, 3, 40);
        $address = self::field($values['address'] ?? null, 10, 500);
        $hostingProvider = self::field($values['hosting_provider'] ?? null, 2, 200);
        $hostingRegion = self::field($values['hosting_region'] ?? null, 2, 200);
        if ($name === null || $taxId === null || $address === null || $hostingProvider === null || $hostingRegion === null) {
            return null;
        }

        $registry = $values['registry'] ?? null;
        if ($status === 'registered') {
            $registry = self::field($registry, 3, 500);
            if ($registry === null) {
                return null;
            }
        } else {
            if ($registry !== null && (! is_string($registry) || trim($registry) !== '')) {
                return null;
            }
            $registry = null;
        }

        return [
            'name' => $name,
            'taxId' => $taxId,
            'address' => $address,
            'registryStatus' => $status,
            'registry' => $registry,
            'hostingProvider' => $hostingProvider,
            'hostingRegion' => $hostingRegion,
        ];
    }

    private static function field(mixed $raw, int $minimum, int $maximum): ?string
    {
        if (! is_string($raw)) {
            return null;
        }
        $value = trim($raw);
        if (! mb_check_encoding($value, 'UTF-8')
            || mb_strlen($value) < $minimum
            || mb_strlen($value) > $maximum
            || preg_match('/[\x00-\x1f\x7f]/u', $value)
            || preg_match('/(?:\bpendiente\b|por completar|\btodo\b|\btbd\b|change.?me|example)/iu', $value)) {
            return null;
        }

        return $value;
    }
}
