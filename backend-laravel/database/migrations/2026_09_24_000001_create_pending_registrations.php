<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Un registro sin verificar vive AQUÍ y nunca en `users`.
     *
     * Hasta que un buzón se demuestra no hay cuenta: no nombre, no workspace,
     * no aceptación legal. El modelo anterior creaba la fila de usuario en el
     * primer paso —con nombre, andamio de workspace y aceptaciones estampadas
     * por el primer registrante— y la activación tenía que sustituirlas después.
     * Aquí no hay nada que heredar: la activación crea la cuenta desde cero con
     * lo que el que abre el buzón decide. De la inscripción solo viaja la
     * dirección: ni nombre, ni contraseña. La propuesta se valida —el mismo
     * contrato que la activación— para dar feedback temprano, pero no se
     * guarda: sin propuesta en disco, `login` no puede distinguir a un
     * registrante de una dirección desconocida, y la orientación al buzón vive
     * en la entrada pública «Reenviar verificación», no en una señal de ciclo
     * de vida que el servidor revelara.
     */
    public function up(): void
    {
        Schema::create('pending_registrations', function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->string('email');
            // Generación del secreto de edición (`RegistrationEdit`): rota en
            // cada corrección, que es lo que gasta el secreto que la autorizó.
            $table->integer('security_version')->default(1);
            $table->timestampsTz();
        });
        DB::statement('CREATE UNIQUE INDEX pending_registrations_email_unique ON pending_registrations (lower(email))');

        Schema::table('email_tokens', function (Blueprint $table) {
            // Un bearer `verify` nombra un registro pendiente; los demás kinds
            // nombran un usuario. La comprobación de exactamente uno evita que
            // un token quede huérfano de ambas autoridades.
            $table->foreignId('pending_registration_id')->nullable()->after('user_id')
                ->constrained('pending_registrations')->cascadeOnDelete();
        });
        DB::statement('ALTER TABLE email_tokens ALTER COLUMN user_id DROP NOT NULL');
        DB::statement('ALTER TABLE email_tokens ADD CONSTRAINT email_tokens_owner_check CHECK ((user_id IS NULL) <> (pending_registration_id IS NULL))');
        DB::statement('CREATE INDEX idx_email_tokens_pending_registration ON email_tokens (pending_registration_id)');

        $this->moveUnverifiedRegistrations();
    }

    public function down(): void
    {
        // Irreversible hacia atrás: una fila pendiente no tiene forma de
        // usuario que recuperar —nombre y aceptaciones se deciden en la
        // activación y aquí no existen—. Se retira la atadura y se deja la
        // tabla; un down que fabricara usuarios sería mentira sobre los datos.
        DB::statement('ALTER TABLE email_tokens DROP CONSTRAINT IF EXISTS email_tokens_owner_check');
        Schema::table('email_tokens', function (Blueprint $table) {
            $table->dropConstrainedForeignId('pending_registration_id');
        });
        Schema::dropIfExists('pending_registrations');
    }

    /**
     * Registros sin verificar del modelo anterior → filas pendientes.
     *
     * La fila de usuario que `register` creaba llevaba andamio —aceptaciones
     * legales, workspace vacío, membership, quota, quizás una sesión legacy—
     * que hoy nada honra: se retira con la fila. El bearer `verify` vivo se
     * reencadena al registro pendiente conservando su generación, de modo que
     * el enlace que ya está en un buzón sigue completando el registro y el
     * secreto de edición en el navegador sigue autorizando su corrección.
     *
     * Los usuarios sin verificar no pueden tener contenido propio
     * (`VERIFIED_REQUIRED_TO_CREATE` impide crear enlaces antes de verificar),
     * pero si algún despliegue lo hubiera permitido, la migración se detiene en
     * vez de borrar trabajo ajeno: convertir una cuenta con datos es una
     * decisión de operador, no de una migración.
     */
    private function moveUnverifiedRegistrations(): void
    {
        $withContent = DB::table('users as u')
            ->whereNull('u.email_verified_at')
            ->where(function ($query): void {
                $query->whereExists(function ($owned): void {
                    $owned->select(DB::raw('1'))->from('links as l')
                        ->join('workspaces as w', 'w.id', '=', 'l.workspace_id')
                        ->whereColumn('w.owner_user_id', 'u.id');
                })->orWhereExists(function ($created): void {
                    $created->select(DB::raw('1'))->from('links as l')
                        ->whereColumn('l.created_by', 'u.id');
                });
            })
            ->count();
        if ($withContent > 0) {
            throw new RuntimeException(
                "Hay {$withContent} registro(s) sin verificar con enlaces propios; conviértelos a mano antes de migrar: esta migración no borra contenido."
            );
        }

        foreach (DB::table('users')->whereNull('email_verified_at')->orderBy('id')
            ->get(['id', 'email', 'security_version', 'created_at']) as $user) {
            DB::transaction(function () use ($user): void {
                $pendingId = DB::table('pending_registrations')->insertGetId([
                    'email' => (string) $user->email,
                    // La propuesta del modelo anterior NO viaja: no abría nada
                    // y era la señal de ciclo de vida que `login` revelaba. La
                    // retirada la cierra: el registro convertido contesta como
                    // una dirección desconocida, y la guía al buzón es la
                    // entrada pública de reenvío.
                    'security_version' => max(1, (int) $user->security_version),
                    'created_at' => $user->created_at,
                    'updated_at' => $user->created_at,
                ]);
                // El bearer vivo cambia de dueño; los demás kinds (reset,
                // mfa_recovery, security_revoke) no tienen sentido sin cuenta
                // verificada y mueren con su fila.
                DB::table('email_tokens')->where('user_id', $user->id)
                    ->where('kind', 'verify')
                    ->update(['pending_registration_id' => $pendingId, 'user_id' => null]);
                DB::table('email_tokens')->where('user_id', $user->id)->delete();
                DB::table('legal_acceptances')->where('user_id', $user->id)->delete();
                DB::table('invitations')->where('invited_by', $user->id)->delete();
                DB::table('memberships')->where('user_id', $user->id)->delete();
                // El workspace del registro era andamio vacío; sus cuotas,
                // dominios e invitaciones caen en cascada con él.
                DB::table('workspaces')->where('owner_user_id', $user->id)->delete();
                DB::table('sessions')->where('user_id', $user->id)->delete();
                DB::table('users')->where('id', $user->id)->delete();
            });
        }
    }
};
