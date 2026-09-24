<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Un registro sin verificar: una dirección y la generación de su secreto de
 * edición. Nada más.
 *
 * Ni nombre, ni workspace, ni aceptación legal, ni contraseña: eso se decide en
 * la activación, con el token que llega al buzón. Guardarlo aquí sería dejarle
 * a un tercero algo que heredar —el pre-hijack que la separación de esta tabla
 * viene a cerrar—. Ni siquiera queda la propuesta de contraseña de la
 * inscripción: `register` la valida para dar feedback temprano con el mismo
 * contrato que la activación, pero no la persiste, de modo que `login` no puede
 * distinguir este registro de una dirección desconocida y ninguna señal de
 * ciclo de vida se filtra por el servidor.
 */
class PendingRegistration extends Model
{
    protected $fillable = ['email', 'security_version'];

    protected function casts(): array
    {
        return ['security_version' => 'integer'];
    }

    /** @return HasMany<EmailToken, $this> */
    public function tokens(): HasMany
    {
        return $this->hasMany(EmailToken::class, 'pending_registration_id');
    }
}
