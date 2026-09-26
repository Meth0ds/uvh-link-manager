<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * Valores por defecto con los que crear un enlace. El payload sólo contiene
 * campos del contrato de enlace (destino, notas, UTM, etiquetas, límites) y
 * nunca un alias: el alias identifica un enlace concreto.
 *
 * @property Carbon $created_at
 * @property array<string, mixed> $payload
 */
class LinkTemplate extends Model
{
    const UPDATED_AT = null;

    protected $fillable = ['workspace_id', 'created_by', 'name', 'payload'];

    /** @return array<string, mixed> */
    protected function casts(): array
    {
        return ['payload' => 'array', 'created_at' => 'datetime'];
    }

    /** @return BelongsTo<Workspace, $this> */
    public function workspace(): BelongsTo
    {
        return $this->belongsTo(Workspace::class);
    }
}
