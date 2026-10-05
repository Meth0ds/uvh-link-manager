<?php

namespace App\Http\Controllers\Concerns;

/** Common response-duration floor for public verification and reset requests. */
trait EqualizesPublicMailDuration
{
    /**
     * Iguala el coste de las ramas que contestan `ok` hasta el suelo de
     * configured for each public mail request.
     *
     * La rama completa (transacción + token + admisión al outbox) suele pasar
     * el suelo por sí sola; las ramas que no envían —dirección desconocida,
     * cooldown, consumo concurrente, fallo de admisión— duermen el resto. El
     * residuo que queda fuera del suelo (la varianza de la base de datos bajo
     * carga) está documentado como límite conocido de la compensación temporal.
     */
    private function equalizePublicMailDuration(float $startedAt, string $configKey): void
    {
        $floorMs = max(0, (int) config('uvh.'.$configKey));
        $remainingUs = ($floorMs * 1000) - (hrtime(true) - $startedAt) / 1000;
        if ($remainingUs > 0) {
            usleep((int) round($remainingUs));
        }
    }
}
