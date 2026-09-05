<?php

namespace App\Support;

/**
 * Server-side mirror of the registration form's client-side strength meter.
 *
 * The browser shows an estimate ("Sólo en tu navegador"); the API must be the
 * real gate. This class ports the exact scoring heuristics from the compiled
 * frontend (function `Tt` in the auth bundle) so both surfaces agree, and adds
 * `isAcceptable()`: the hard server-side rule that rejects trivially weak
 * passwords at register, reset-password and change-password time.
 */
final class PasswordStrength
{
    /** Score bands mirror the UI: >=82 Fuerte, >=58 Buena, >=30 Mejorable, else Débil. */
    public const ACCEPT_MIN_SCORE = 30;

    public const MIN_LENGTH = 10;

    public const MAX_LENGTH = 72;

    /** UI label thresholds: Fuerte / Buena / Mejorable / Débil. */
    public const BANDS = ['strong' => 82, 'good' => 58, 'fair' => 30];

    public const COMMON_SUBSTRINGS = [
        'password', 'contrasena', 'qwerty', 'admin', 'welcome', 'bienvenido',
        'letmein', 'iloveyou', '123456', 'uvh',
    ];

    public const PATTERN_SEQUENCES = [
        '0123', '1234', '2345', '3456', '4567', '5678', '6789', '9876',
        'abcd', 'bcde', 'cdef', 'qwer', 'asdf',
    ];

    /**
     * Hard-reject substrings, applied to the folded password regardless of
     * score: mixed-case + digit-substitution variants of dictionary words
     * (Password1!, SuperMan-99) still appear in every cracking wordlist.
     * Plain substrings (not regex) so they can be shared with the browser
     * bundle verbatim; 'contrase' covers 'contrasena'/'contraseña' after folding.
     */
    public const REJECT_WORDS = [
        'password', 'contrase', 'qwerty', 'admin', 'welcome', 'bienvenido',
        'letmein', 'iloveyou', 'login', 'uvh',
    ];

    /**
     * Single source of truth for the user-facing feedback copy. The artisan
     * command `uvh:emit-password-policy` serializes every public constant of
     * this class into the browser bundle (frontend/public/uvh-password-policy.v1.js),
     * so the UI meter and this server logic can never drift apart.
     */
    public const FEEDBACK = [
        'empty' => 'Empieza con una frase larga que no uses en ningún otro sitio.',
        'common' => 'Evita palabras y contraseñas habituales: son las primeras que prueba un atacante.',
        'personal' => 'No incluyas tu nombre ni la parte visible de tu email.',
        'patterned' => 'Sustituye secuencias y repeticiones previsibles por palabras no relacionadas.',
        'short' => 'Añade más caracteres: el mínimo es 10 y recomendamos una frase más larga.',
        'variety' => 'Hazla más larga o combina tipos de caracteres para reducir patrones previsibles.',
        'default' => 'Buena base. Una frase única y larga es más fácil de recordar y más difícil de adivinar.',
    ];

    /**
     * Port of the frontend assessment. Returns the same shape the UI computes
     * so feedback text stays consistent between surfaces.
     *
     * @return array{score: int, common: bool, personal: bool, patterned: bool, feedback: string}
     */
    public static function assess(string $password, string $name = '', string $email = ''): array
    {
        if ($password === '') {
            return [
                'score' => 0,
                'common' => false,
                'personal' => false,
                'patterned' => false,
                'feedback' => self::FEEDBACK['empty'],
            ];
        }

        $lower = self::normalize($password);
        $common = self::containsAny($lower, self::COMMON_SUBSTRINGS);
        $patterned = preg_match('/(.)\1{2,}/u', $password) === 1
            || self::containsAny($lower, self::PATTERN_SEQUENCES);
        $personal = self::containsPersonalData($lower, $name, $email);

        $charClasses = (int) preg_match('/[a-z]/', $password)
            + (int) preg_match('/[A-Z]/', $password)
            + (int) preg_match('/\d/', $password)
            + (int) preg_match('/[^A-Za-z0-9]/', $password);

        $uniqueRatio = self::uniqueCharRatio($password);

        $score = min(42, mb_strlen($password) * 3) + $charClasses * 9 + (int) round($uniqueRatio * 12);
        if (mb_strlen($password) >= 14) {
            $score += 8;
        }
        if (mb_strlen($password) >= 18) {
            $score += 8;
        }
        if ($common) {
            $score -= 38;
        }
        if ($patterned) {
            $score -= 24;
        }
        if ($personal) {
            $score -= 28;
        }
        if (mb_strlen($password) < 10) {
            $score = min($score, 24);
        }
        $score = max(0, min(100, $score));

        $feedback = self::FEEDBACK['default'];
        if ($common) {
            $feedback = self::FEEDBACK['common'];
        } elseif ($personal) {
            $feedback = self::FEEDBACK['personal'];
        } elseif ($patterned) {
            $feedback = self::FEEDBACK['patterned'];
        } elseif (mb_strlen($password) < 10) {
            $feedback = self::FEEDBACK['short'];
        } elseif ($charClasses < 3 && mb_strlen($password) < 16) {
            $feedback = self::FEEDBACK['variety'];
        }

        return [
            'score' => $score,
            'common' => $common,
            'personal' => $personal,
            'patterned' => $patterned,
            'feedback' => $feedback,
        ];
    }

    /**
     * The API contract: long enough, never containing a common password
     * substring (hard reject regardless of score — mixed-case variants of
     * "password" still appear in every cracking wordlist), and scored above
     * the weak band. Personal data and patterns alone can be legitimate
     * (e.g. a long passphrase containing the user's name), so they only
     * reject via the resulting score.
     */
    public static function isAcceptable(string $password, string $name = '', string $email = ''): bool
    {
        if (mb_strlen($password) < 10 || mb_strlen($password) > 72) {
            return false;
        }

        $assessment = self::assess($password, $name, $email);

        if ($assessment['common']) {
            return false;
        }

        $folded = self::normalize($password);
        foreach (self::REJECT_WORDS as $word) {
            if (str_contains($folded, $word)) {
                return false;
            }
        }

        // Keyboard walks, digit/letter sequences and repeated characters are
        // exactly what cracking wordlists enumerate first — reject outright.
        // Passwords containing the user's own name/email local part go too:
        // targeted attackers try those first, and the register/reset flows
        // have no other server-side protection for them.
        if ($assessment['patterned'] || $assessment['personal']) {
            return false;
        }

        return $assessment['score'] >= self::ACCEPT_MIN_SCORE;
    }

    /** NFKD fold, strip diacritics, lowercase — same as the frontend's H(). */
    private static function normalize(string $value): string
    {
        $folded = normalizer_normalize($value, \Normalizer::FORM_KD);
        $folded = $folded === false || $folded === '' ? $value : $folded;

        return mb_strtolower((string) preg_replace('/[\x{0300}-\x{036F}]/u', '', $folded));
    }

    private static function containsAny(string $haystack, array $needles): bool
    {
        foreach ($needles as $needle) {
            if ($needle !== '' && str_contains($haystack, $needle)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Frontend rule: any word of the normalized name, or the local part of the
     * email (split on "@"), of length >= 3, appearing inside the password.
     */
    private static function containsPersonalData(string $lowerPassword, string $name, string $email): bool
    {
        $nameWords = preg_split('/[^a-z0-9]+/', self::normalize($name), -1, PREG_SPLIT_NO_EMPTY) ?: [];
        $emailLocal = explode('@', self::normalize($email))[0] ?? '';
        $candidates = array_merge($nameWords, [$emailLocal]);

        foreach ($candidates as $candidate) {
            if (mb_strlen($candidate) >= 3 && str_contains($lowerPassword, $candidate)) {
                return true;
            }
        }

        return false;
    }

    private static function uniqueCharRatio(string $password): float
    {
        $length = mb_strlen($password);
        if ($length === 0) {
            return 0.0;
        }

        $chars = mb_str_split($password);
        $unique = count(array_unique($chars));

        return $unique / $length;
    }
}
