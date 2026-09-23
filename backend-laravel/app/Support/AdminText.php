<?php

namespace App\Support;

/**
 * The free text an operator supplies with a moderation decision.
 *
 * A reason for blocking a link, a reason for blocking a destination, a note on
 * an appeal: every surface that accepts one applies the same two rules — valid
 * UTF-8 carrying none of the control characters nothing legitimate produces,
 * and a length bound the trail can hold. Those rules live here once; the message
 * that explains a rejection belongs to the surface that asked, which is why the
 * callers keep their own wording.
 */
final class AdminText
{
    /** Control characters that no legitimate reason or note contains. */
    private const CONTROL = '/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u';

    /** Whether the value can be stored and printed back. */
    public static function encodable(string $value): bool
    {
        return mb_check_encoding($value, 'UTF-8') && preg_match(self::CONTROL, $value) === 0;
    }

    /** Whether the value is encodable and its length falls inside the bounds. */
    public static function bounded(string $value, int $min, int $max): bool
    {
        return self::encodable($value) && mb_strlen($value) >= $min && mb_strlen($value) <= $max;
    }
}
