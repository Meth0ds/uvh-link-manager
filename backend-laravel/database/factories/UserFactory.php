<?php

namespace Database\Factories;

use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Facades\Hash;

/**
 * @extends Factory<User>
 */
class UserFactory extends Factory
{
    /**
     * The current password being used by the factory.
     */
    protected static ?string $password;

    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'name' => fake()->name(),
            'email' => fake()->unique()->safeEmail(),
            'email_verified_at' => now(),
            'password_hash' => static::$password ??= Hash::make('correct horse battery staple'),
            'is_admin' => false,
            'mfa_enabled' => false,
            'security_version' => 1,
        ];
    }

    // No hay estado `unverified` a propósito: un registro sin verificar vive
    // en `pending_registrations` y sólo la activación crea usuario. Una fila de
    // usuario sin verificar es un residuo del modelo anterior que la migración
    // `2026_09_24_000001` convierte; un test que necesite fabricar ese residuo
    // lo hace con `create(['email_verified_at' => null])`, a sabiendas.
}
