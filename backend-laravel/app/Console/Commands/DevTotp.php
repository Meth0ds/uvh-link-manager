<?php

namespace App\Console\Commands;

use App\Models\User;
use App\Support\Totp;
use App\Support\UvhCrypto;
use Illuminate\Console\Command;

/**
 * The authenticator the MFA flow expects, for development.
 *
 * Every gate around the admin console assumes the operator holds the account's
 * TOTP secret: the code at login, the code on `/auth/reauthenticate` when the
 * freshness window closes, and the code that confirms a new enrollment. In
 * production that secret lives in a phone. In development this command stands in
 * for the phone: it reads the account's own secret and prints the code the server
 * accepts right now, so the real screens can be exercised instead of only compiled.
 *
 * It hands out a second factor in clear text, so it fails closed: outside
 * local/testing it refuses to run, and it has no HTTP counterpart on purpose — an
 * endpoint that returns a factor is a far larger exposure than a console command
 * that already requires the access that can read the column.
 *
 * The flow it enables, end to end and without a single stubbed path:
 *
 *   php artisan uvh:dev:totp <email>              # código para entrar o reautenticar
 *   php artisan uvh:dev:totp <email> --show-secret # además el secreto y su URI de alta
 *   php artisan uvh:admin:promote <email>          # tras activar MFA, para ser administrador
 */
class DevTotp extends Command
{
    protected $signature = 'uvh:dev:totp
        {email? : Cuenta cuyo factor se resuelve}
        {--secret= : Secreto base32 en claro, para un alta que todavía no está activa}
        {--watch : No sale: emite el código de cada intervalo}
        {--show-secret : Muestra también el secreto y la URI de alta}';

    protected $description = 'Print the live TOTP code of a development account (local/testing only)';

    public function handle(): int
    {
        if (! app()->environment(['local', 'testing'])) {
            $this->error('uvh:dev:totp imprime un segundo factor en claro: sólo funciona con APP_ENV=local o testing.');

            return self::FAILURE;
        }

        $explicit = $this->option('secret');
        $user = null;

        if ($explicit === null) {
            $email = mb_strtolower(trim((string) $this->argument('email')));
            if (! filter_var($email, FILTER_VALIDATE_EMAIL)) {
                $this->error('Indica la cuenta (uvh:dev:totp <email>) o pasa el secreto con --secret=.');

                return self::FAILURE;
            }

            $user = User::query()->whereRaw('lower(email) = ?', [$email])->first();
            if (! $user) {
                $this->error('No existe una cuenta con ese email.');

                return self::FAILURE;
            }

            $this->describeAccount($user);
        }

        try {
            $factors = $this->factors($user, is_string($explicit) ? $explicit : null);
        } catch (\DomainException $error) {
            $this->error($error->getMessage());

            return self::FAILURE;
        }

        if ($this->option('show-secret')) {
            $this->exposeSecrets($user, $factors);
        }

        if ($this->option('watch')) {
            return $this->watch($factors);
        }

        if (! $this->printCodes($factors)) {
            return self::FAILURE;
        }

        $this->line('Se pide en la pantalla de inicio de sesión (segundo factor), en <comment>/auth/reauthenticate</comment>');
        $this->line('cuando la consola pide confirmar la identidad (ADMIN_MFA_FRESH_MINUTES) y al confirmar un alta de MFA.');

        return self::SUCCESS;
    }

    private function describeAccount(User $user): void
    {
        $mfa = $user->mfa_enabled
            ? 'activo'
            : ($user->mfa_pending_secret !== null ? 'alta en curso' : 'inactivo');

        $this->line(sprintf(
            'Cuenta <info>%s</info> (#%d) · email verificado: %s · administrador: %s · MFA: %s',
            $user->email,
            $user->id,
            $user->email_verified_at !== null ? 'sí' : 'no',
            $user->is_admin ? 'sí' : 'no',
            $mfa,
        ));

        if ($user->deleted_at !== null) {
            $this->warn('La cuenta está bloqueada: el inicio de sesión la rechazará.');
        }
        if (! $user->is_admin || ! $user->mfa_enabled) {
            $this->line('Para la consola: <comment>php artisan uvh:admin:promote '.$user->email.'</comment> (exige email verificado y MFA activa).');
        }
        $this->newLine();
    }

    /**
     * Every factor the operator may be asked for, in the order the server checks
     * them: the active one, then a staged enrollment.
     *
     * @return array<string, string> label => base32 secret
     */
    private function factors(?User $user, ?string $explicit): array
    {
        if ($explicit !== null) {
            $secret = self::normalizeSecret($explicit);
            if ($secret === null) {
                throw new \DomainException('El secreto debe ser base32 (A-Z y 2-7), entre 16 y 128 caracteres.');
            }

            return ['--secret' => $secret];
        }

        if ($user === null) {
            throw new \DomainException('No hay cuenta ni secreto que resolver.');
        }

        $found = [];
        $staged = $user->mfa_pending_secret;

        if ($staged !== null && $user->mfa_pending_expires_at !== null && $user->mfa_pending_expires_at->isPast()) {
            // The enrollment window is ten minutes; a code from an expired stage
            // is refused with "la configuración MFA ha caducado", which reads as
            // a wrong code. Say what actually happened.
            $this->warn('El alta pendiente caducó: vuelve a empezar «Verificación en dos pasos» en Ajustes.');
            $staged = null;
        }

        foreach (['activo' => $user->mfa_secret, 'alta pendiente' => $staged] as $label => $encrypted) {
            if (! is_string($encrypted) || $encrypted === '') {
                continue;
            }

            try {
                $secret = UvhCrypto::decryptAtRest($encrypted);
            } catch (\Throwable) {
                $this->warn("No se pudo descifrar el secreto «{$label}» con la APP_SECRET actual.");

                continue;
            }

            $normalized = self::normalizeSecret($secret);
            if ($normalized !== null) {
                $found[$label] = $normalized;
            }
        }

        if ($found === []) {
            throw new \DomainException(sprintf(
                'La cuenta %s no tiene un factor TOTP utilizable. Empieza el alta en Ajustes → «Verificación en dos pasos»: '
                .'el servidor guarda el secreto pendiente y este comando ya puede entregar el código que la confirma.',
                $user->email,
            ));
        }

        return $found;
    }

    /** @param array<string, string> $factors */
    private function exposeSecrets(?User $user, array $factors): void
    {
        foreach ($factors as $label => $secret) {
            $this->line(sprintf('%s  <comment>%s</comment>', str_pad($label, 22), $secret));
            if ($user !== null) {
                $this->line('  '.Totp::provisioningUri($user->email, 'UVH', $secret));
            }
        }
        $this->newLine();
    }

    /** @param array<string, string> $factors */
    private function printCodes(array $factors): bool
    {
        $remaining = Totp::secondsRemaining();
        $ok = true;

        foreach ($factors as $label => $secret) {
            $code = Totp::currentCode($secret);
            if ($code === null) {
                $this->error("El secreto «{$label}» no admite un código TOTP.");
                $ok = false;

                continue;
            }

            $this->line(sprintf('%s  <info>%s</info>  <comment>válido %d s</comment>', str_pad($label, 22), $code, $remaining));
        }
        $this->newLine();

        return $ok;
    }

    /**
     * Stream a block per interval until the operator interrupts the process.
     * There is no natural end: the codes keep rolling.
     *
     * @param  array<string, string>  $factors
     */
    private function watch(array $factors): int
    {
        $this->line('Emitiendo un bloque por intervalo. Ctrl-C para salir.');
        $this->newLine();
        $this->printCodes($factors);

        for (; ;) {
            // The first second of an interval is the only one that reports the
            // whole period, so it is also the only moment worth printing.
            if (Totp::secondsRemaining() !== Totp::PERIOD) {
                usleep(250000);

                continue;
            }

            $this->printCodes($factors);
            sleep(1);
        }
    }

    /**
     * Accept the shapes an operator pastes: spaces, lower case and the padding
     * `=` of a base32 block. Anything the verifier would refuse is rejected here
     * instead of being turned into a code the server ignores.
     */
    private static function normalizeSecret(string $secret): ?string
    {
        $normalized = rtrim(strtoupper((string) preg_replace('/[\s-]+/', '', trim($secret))), '=');

        return Totp::isUsableSecret($normalized) ? $normalized : null;
    }
}
