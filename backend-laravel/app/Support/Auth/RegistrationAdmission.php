<?php

namespace App\Support\Auth;

use App\Models\EmailChangeRequest;
use App\Models\EmailToken;
use App\Models\PendingRegistration;
use App\Models\RegistrationAttempt;
use App\Models\User;
use App\Support\Audit;
use App\Support\FrontendUrl;
use App\Support\Ids;
use App\Support\MailAdmissionException;
use App\Support\PasswordStrength;
use App\Support\RegistrationEdit;
use App\Support\UvhMail;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

/**
 * Registration and mailbox activation own their complete SQL admission.
 * Callers validate request shape, legal versions and anti-abuse requirements;
 * this service keeps identity, bearer, workspace, consent and audit in one
 * commit. It does not issue sessions or decide HTTP/cookie responses.
 */
final class RegistrationAdmission
{
    public const TERMS_VERSION = '2026-10-09';

    public const PRIVACY_VERSION = '2026-10-09';

    /**
     * The caller supplies a validated, lowercase mailbox. No identity or
     * password proposal is persisted before proof of that mailbox.
     *
     * @return RegistrationAttempt The browser context, for every outcome.
     */
    public static function start(string $email): RegistrationAttempt
    {
        $token = Ids::randomToken(32);
        $tokenHash = Ids::sha256Hex($token);

        return DB::transaction(function () use ($email, $token, $tokenHash): RegistrationAttempt {
            $attempt = RegistrationAttempt::create(['email' => $email, 'expires_at' => RegistrationEdit::deadline()]);
            EmailAddressLock::acquire($email);
            $reserved = EmailChangeRequest::whereRaw('lower(new_email) = ?', [$email])
                ->where('expires_at', '>', now())->exists();
            if ($reserved
                || PendingRegistration::whereRaw('lower(email) = ?', [$email])->exists()
                || User::whereRaw('lower(email) = ?', [$email])->exists()) {
                // Pendiente, verificada, borrada en blando o reservada: las
                // cuatro son la misma respuesta y a ninguna se sustituye. Un
                // registro sin verificar nunca posee una dirección —la
                // prueba del buzón manda—, de modo que a una inscripción
                // anónima posterior no le queda nada que ganar: no hay fila
                // de usuario que reescribir, y el bearer que ya está en el
                // buzón del propietario sigue completando el registro. Tampoco
                // hay callejón sin salida: `resend-verification` emite otro.
                //
                // El desenlace paga exactamente como una inscripción real:
                // una admisión huérfana cuyo token no tiene fila, de modo
                // que los jobs de entrega la suprimen y ningún buzón se
                // toca.
                self::admitOrphanVerification($email);
                Audit::write(null, 'auth.register_duplicate', 'user', null);

                return $attempt;
            }

            $pending = PendingRegistration::create([
                'email' => $email,
                // Primera generación del secreto de edición, escrita
                // explícitamente para poder sellarla sin releer la fila.
                'security_version' => 1,
            ]);

            $attempt->update([
                'pending_registration_id' => (int) $pending->id,
                'pending_security_version' => 1,
                'legacy_pending_id' => (int) $pending->id,
                'legacy_security_version' => 1,
            ]);

            EmailToken::create([
                'id' => $tokenHash,
                'pending_registration_id' => (int) $pending->id,
                'kind' => 'verify',
                'expires_at' => now()->addDay(),
            ]);
            if (! UvhMail::verification(
                $email,
                FrontendUrl::base().'/auth/verify-email#token='.rawurlencode($token),
                $tokenHash,
            )) {
                throw new MailAdmissionException('Registration verification outbox admission failed');
            }

            Audit::write(null, 'auth.register', 'pending_registration', (string) $pending->id);
            Audit::write(null, 'auth.terms_accepted', 'consent', self::TERMS_VERSION);
            Audit::write(null, 'auth.privacy_notice_acknowledged', 'privacy_notice', self::PRIVACY_VERSION);

            return $attempt;
        });
    }

    /**
     * The caller validates the token shape, name, password and explicit legal
     * acceptance against the versions above. Live identity strength and all
     * bearer/account state are revalidated under lock. Null means an invalid
     * bearer; -1 means a password rejected against its live mailbox/name;
     * a positive id means activation committed. No session is created here.
     */
    public static function activate(string $token, string $password, string $name): ?int
    {
        $passwordHash = Hash::make($password);
        $tokenHash = Ids::sha256Hex($token);
        $snapshot = EmailToken::where('id', $tokenHash)
            ->where('kind', 'verify')->whereNull('used_at')->first(['id', 'pending_registration_id', 'user_id']);
        // Lifecycle mutex, browser context, pending row, bearer is the
        // global lifecycle lock order (the child FK is updated on deletion). The preflight row is untrusted and every property is
        // checked again under lock, so replacement or consumption races fail
        // closed.
        $userId = null;
        if ($snapshot && $snapshot->pending_registration_id) {
            $userId = DB::transaction(function () use ($snapshot, $tokenHash, $passwordHash, $password, $name): ?int {
                RegistrationAttemptContext::lockForPending((int) $snapshot->pending_registration_id);
                $pending = PendingRegistration::where('id', $snapshot->pending_registration_id)->lockForUpdate()->first();
                $row = EmailToken::where('id', $tokenHash)
                    ->where('pending_registration_id', $snapshot->pending_registration_id)
                    ->where('kind', 'verify')
                    ->whereNull('used_at')
                    ->lockForUpdate()
                    ->first();
                if (! $row || $row->expires_at->lte(now())) {
                    return null;
                }

                if (! $pending) {
                    // La activación ya lo consumió o una corrección lo retiró: el
                    // bearer no vuelve a abrir nada, y el desenlace es el mismo
                    // `Token inválido o caducado` de siempre.
                    return null;
                }
                if (! PasswordStrength::isAcceptable($password, $name, (string) $pending->email)) {
                    // Re-evaluate with the live identity while its row is locked. An
                    // activation must not accept a password derived from the name or
                    // mailbox merely because the preflight could not know that
                    // context (same contract as reset-password). The name that
                    // counts is the one typed HERE; the live mailbox is the row's.
                    return -1;
                }

                $now = now();
                $row->update(['used_at' => $now]);
                // La dirección se reclama en `users` con el advisory de esa misma
                // dirección —justo antes de escribirla, y con la fila pendiente ya
                // bloqueada, de modo que su correo no se mueve mientras tanto—. Es
                // lo que serializa esta creación con `register` y con cualquier
                // corrección que apunte al mismo destino: usuarios y registros
                // pendientes son dos tablas, y una dirección vive en una sola.
                EmailAddressLock::acquire(strtolower((string) $pending->email));
                $user = User::create([
                    'email' => (string) $pending->email,
                    // Identity decided at activation, exactly like the password:
                    // nothing an anonymous registration proposed is the account
                    // owner's to keep — there is no proposal stored at all.
                    'name' => $name,
                    'password_hash' => $passwordHash,
                    'email_verified_at' => $now,
                    // The credential was just settled: this is generation 1 of the
                    // account, and every later generation binds to a change of it.
                    'security_version' => 1,
                ]);
                // Registration accepts a longer personal name than the workspace
                // write contract. Keep the generated resource inside that contract
                // instead of creating an unreadable workspace.
                $workspace = $user->ownedWorkspaces()->create([
                    'name' => self::defaultWorkspaceName($name),
                    'slug' => 'ws-'.strtolower(Ids::randomToken(6)),
                ]);
                $workspace->memberships()->create(['user_id' => $user->id, 'role' => 'owner']);
                $workspace->quota()->create(['links_limit' => 1000]);
                // The legal acceptance that counts is the one made HERE, by whoever
                // proved the mailbox — not one an anonymous first registrant could
                // stamp on the victim's behalf hours earlier. Nothing provisional
                // was kept, so nothing provisional survives either: the pending row
                // and every bearer it still had die with it, in one cascade.
                self::acceptRegistrationLegal((int) $user->id, $now);
                $pending->delete();

                return (int) $user->id;
            });
        } elseif ($snapshot && $snapshot->user_id) {
            // Camino heredado: el bearer nombra una FILA DE USUARIO sin
            // verificar (dato anterior al modelo de registro pendiente, o
            // creado a mano). El buzón se demuestra exactamente igual, pero la
            // cuenta ya existe: se le fija la credencial elegida aquí y queda
            // verificada, sin crear andamio nuevo.
            $userId = DB::transaction(function () use ($snapshot, $tokenHash, $passwordHash, $password, $name): ?int {
                $user = User::where('id', $snapshot->user_id)->whereNull('deleted_at')->lockForUpdate()->first();
                $row = EmailToken::where('id', $tokenHash)
                    ->where('user_id', $snapshot->user_id)
                    ->where('kind', 'verify')
                    ->whereNull('used_at')
                    ->lockForUpdate()
                    ->first();
                if (! $user || $user->email_verified_at || ! $row || $row->expires_at->lte(now())) {
                    return null;
                }
                if (! PasswordStrength::isAcceptable($password, $name, (string) $user->email)) {
                    return -1;
                }

                $now = now();
                $row->update(['used_at' => $now]);
                $user->update([
                    'name' => $name,
                    'password_hash' => $passwordHash,
                    'email_verified_at' => $now,
                    // La credencial acaba de fijarse: nueva generación, como en
                    // cualquier cambio de contraseña.
                    'security_version' => (int) $user->security_version + 1,
                ]);
                self::acceptRegistrationLegal((int) $user->id, $now);

                return (int) $user->id;
            });
        }

        return $userId;
    }

    /**
     * Pay for one outbox admission exactly like a real registration without
     * ever mailing the occupant: the token hash has no backing row, so the
     * delivery jobs suppress the envelope (`MailDeliveryEligibility` ->
     * `obsolete`) and no mailbox is touched — least of all the caller's own.
     */
    private static function admitOrphanVerification(string $email): void
    {
        if (! UvhMail::verification(
            $email,
            FrontendUrl::base().'/auth/verify-email#token='.rawurlencode(Ids::randomToken(32)),
            Ids::sha256Hex(Ids::randomToken(32)),
        )) {
            throw new MailAdmissionException('Registration verification outbox admission failed');
        }
    }

    /**
     * Legal acceptance: business evidence of THIS request. The table allows one
     * row per user/document/version (`legal_acceptance_user_document_unique`),
     * so each new acceptance refreshes the current version's row instead of
     * colliding with the superseded one. Only the activation (`verifyEmail`)
     * calls it: the acceptance that counts is the one made by whoever proves
     * the mailbox, never one an anonymous first registrant could stamp.
     */
    private static function acceptRegistrationLegal(int $userId, Carbon $acceptedAt): void
    {
        foreach ([
            ['document_type' => 'terms', 'version' => self::TERMS_VERSION],
            ['document_type' => 'privacy_notice', 'version' => self::PRIVACY_VERSION],
        ] as $document) {
            DB::table('legal_acceptances')->updateOrInsert(
                ['user_id' => $userId, ...$document],
                ['source' => 'registration', 'accepted_at' => $acceptedAt],
            );
        }
        // Activation and its exact events share admission: failure rolls back
        // the credential, bearer consumption and legal evidence together.
        Audit::write($userId, 'auth.email_verified', 'user', $userId);
        Audit::write($userId, 'auth.terms_accepted', 'consent', self::TERMS_VERSION);
        Audit::write($userId, 'auth.privacy_notice_acknowledged', 'privacy_notice', self::PRIVACY_VERSION);
    }

    private static function defaultWorkspaceName(string $userName): string
    {
        $prefix = 'Workspace de ';
        $maximumWorkspaceCharacters = 80;
        $availableCharacters = $maximumWorkspaceCharacters - mb_strlen($prefix, 'UTF-8');

        // mb_substr counts Unicode code points, matching the backend's name
        // validation and the frontend decoder's explicit code-point count.
        return $prefix.mb_substr($userName, 0, $availableCharacters, 'UTF-8');
    }
}
