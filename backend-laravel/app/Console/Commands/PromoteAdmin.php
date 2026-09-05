<?php

namespace App\Console\Commands;

use App\Models\AuditEvent;
use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class PromoteAdmin extends Command
{
    protected $signature = 'uvh:admin:promote {email : Email exacto de la cuenta existente}';

    protected $description = 'Promote an active, verified, MFA-enabled account to platform administrator';

    public function handle(): int
    {
        $email = mb_strtolower(trim((string) $this->argument('email')));
        if (! filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $this->error('El email no es válido.');

            return self::INVALID;
        }

        try {
            [$user, $promoted] = DB::transaction(function () use ($email): array {
                /** @var User|null $user */
                $user = User::query()
                    ->whereRaw('lower(email) = ?', [$email])
                    ->lockForUpdate()
                    ->first();

                if (! $user) {
                    throw new \DomainException('No existe una cuenta con ese email.');
                }
                if ($user->deleted_at !== null) {
                    throw new \DomainException('La cuenta está bloqueada.');
                }
                if ($user->email_verified_at === null) {
                    throw new \DomainException('La cuenta debe verificar el email antes de ser administradora.');
                }
                if (! $user->mfa_enabled || blank($user->mfa_secret)) {
                    throw new \DomainException('La cuenta debe activar MFA antes de ser administradora.');
                }
                if ($user->is_admin) {
                    return [$user, false];
                }

                $user->update(['is_admin' => true]);
                AuditEvent::create([
                    'user_id' => $user->id,
                    'action' => 'system.admin_promote',
                    'resource_type' => 'user',
                    'resource_id' => (string) $user->id,
                    'metadata' => ['actor' => 'console'],
                ]);

                return [$user->fresh(), true];
            }, 3);
        } catch (\DomainException $e) {
            $this->error($e->getMessage());

            return self::FAILURE;
        }

        if (! $promoted) {
            $this->info("{$user->email} ya es administrador.");

            return self::SUCCESS;
        }

        $this->info("{$user->email} ha sido promovido a administrador.");

        return self::SUCCESS;
    }
}
