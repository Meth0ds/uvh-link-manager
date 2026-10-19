<?php

namespace App\Support;

use Illuminate\Support\Carbon;

/** Render system-owned context only; legacy subjects and resource names stay literal. */
final class NotificationSubject
{
    /** @param array<string, mixed>|null $data */
    public static function render(?string $fallback, ?array $data = null): ?string
    {
        if (! $data || ($data['version'] ?? null) !== 1) {
            return $fallback;
        }
        $label = $data['label'] ?? null;
        if (! is_string($label) || mb_strlen($label) > 120) {
            return $fallback;
        }
        if (($data['type'] ?? null) === 'expiry' && is_string($data['expiresAt'] ?? null)) {
            try {
                $date = Carbon::parse($data['expiresAt'])->utc();
            } catch (\Throwable) {
                return $fallback;
            }

            $language = Language::current();

            return __('notifications.subject_expiry', [
                'label' => $label,
                'date' => $date->locale($language)->translatedFormat($language === 'es' ? 'd/m/Y H:i' : 'j M Y, H:i'),
            ]);
        }
        if (($data['type'] ?? null) === 'remaining' && is_int($data['remaining'] ?? null) && $data['remaining'] >= 0) {
            return trans_choice('notifications.subject_remaining', $data['remaining'], ['label' => $label, 'count' => $data['remaining']]);
        }
        if (($data['type'] ?? null) === 'review') {
            return __('notifications.subject_review');
        }

        return $fallback;
    }

    /** @param object{subject?: ?string, subject_data?: mixed} $row */
    public static function forRow(object $row): ?string
    {
        $data = $row->subject_data ?? null;
        if (is_string($data)) {
            $data = json_decode($data, true);
        }

        return self::render($row->subject ?? null, is_array($data) ? $data : null);
    }
}
