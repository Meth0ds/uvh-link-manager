<?php

namespace App\Console\Commands;

use App\Support\UvhLimiters;
use Illuminate\Cache\DatabaseStore;
use Illuminate\Cache\RedisStore;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * Solo pruebas: devuelve a cero los presupuestos de rate limit gastados, y SOLO
 * eso.
 *
 * La suite E2E habla desde una sola dirección durante minutos y el despliegue
 * dimensiona sus techos por dirección para una persona: treinta casos que
 * registran una cuenta cada uno agotan el presupuesto de verificación mucho
 * antes del último spec, y los que llegan después contestan «Demasiados
 * intentos» por tráfico de casos anteriores. Eso es un problema del arnés, no
 * de la aplicación.
 *
 * Antes esto se resolvía con `cache:clear`, que borraba TODO el store —retos MFA
 * en vuelo, guardas de replay TOTP, deduplicación de verificación de dominios,
 * cachés de aplicación— mientras su comentario prometía «sólo los contadores».
 * Este comando borra exactamente dos namespaces, que son los presupuestos:
 *
 *  - `uvh:mfa:attempts:*` — los dos niveles de `MfaAttempts` (por propósito y
 *    por cuenta) y sus llaves `:timer`.
 *  - Las llaves del `RateLimiter` de Laravel, que `ThrottleRequests` hashea
 *    (`md5(ubicaciónLimiter.llave)` → 32 hex; el camino numérico usa `sha1` →
 *    40 hex) con compañeras `:timer`. Su namespace es la FORMA, no un prefijo
 *    con nombre: por eso aquí caben tanto las hasheadas como la grafía sin
 *    hashear (`uvh-…`), por si una instalación desactiva el hash de claves.
 *
 * Y deja deliberadamente vivos lo que no son presupuestos: retos MFA
 * (`uvh:mfa:challenge:*`), guardas de replay (`uvh:mfa:totp-used:*`), locks,
 * latidos de salud y el resto de estado de aplicación. Un reto en vuelo entre
 * dos pasos de un caso es comportamiento del sistema, no ruido del arnés, y
 * borrarlo ocultaría interacciones que existirían entre pasos.
 *
 * Dónde se cuenta importa tanto como qué se borra: los limiters de
 * disponibilidad viven sobre la cadena `failover` y pueden haber caído ya al
 * segundo backend. Limpiar sólo el miembro vivo dejaría los budgets del
 * secundario gastados, así que se recorren TODOS los stores configurados —el
 * por defecto, el de limiters, el de credenciales y cada miembro de cada
 * cadena— y se borra en cada uno.
 */
final class UvhE2eResetLimits extends Command
{
    protected $signature = 'uvh:e2e:reset-limits';

    protected $description = 'Solo pruebas: reinicia los presupuestos de rate limit sin tocar el resto del caché';

    /** Presupuestos de `MfaAttempts` (por propósito y global) y sus timers. */
    private const BUDGET_PREFIX = 'uvh:mfa:attempts:';

    public function handle(): int
    {
        // Mutilar el caché de un despliegue real es exactamente lo que este
        // comando existe para no hacer: fuera de la suite no se ejecuta.
        if (! app()->environment('testing')) {
            $this->error('uvh:e2e:reset-limits sólo existe para la suite E2E (APP_ENV=testing).');

            return self::FAILURE;
        }

        $removed = 0;
        foreach ($this->stores() as $name) {
            $count = $this->resetStore($name);
            $removed += $count;
            $this->line("  {$name}: {$count} claves de presupuesto borradas");
        }
        $this->info("Presupuestos reiniciados: {$removed} claves.");

        return self::SUCCESS;
    }

    /**
     * Cada store que puede estar contando presupuestos, con las cadenas
     * `failover` descompuestas en sus miembros reales.
     *
     * La cadena EN SÍ no entra en la lista: `FailoverStore` no habla por
     * llaves —su trabajo es elegir miembro sano, no borrar—, y sus miembros ya
     * se recorren por separado. Dejar el nombre de la cadena entre las
     * candidatas fue el fallo de la primera ejecución E2E: `resetStore()`
     * recibió `failover`, abortó sin fingir, y el `beforeEach` del fixture
     * tumbó los treinta casos.
     *
     * @return list<string>
     */
    private function stores(): array
    {
        $candidates = [
            (string) config('cache.default'),
            UvhLimiters::availabilityStore(),
            UvhLimiters::securityStore(),
        ];

        $seen = [];
        $concrete = [];
        foreach ($candidates as $name) {
            if (is_string($name) && $name !== '') {
                $this->expand($name, $seen, $concrete);
            }
        }

        return array_keys($concrete);
    }

    /**
     * @param  array<string, true>  $seen  todo nombre visitado (guardia de ciclos)
     * @param  array<string, true>  $concrete  stores que responden llave a llave
     */
    private function expand(string $name, array &$seen, array &$concrete): void
    {
        if (isset($seen[$name])) {
            return;
        }
        $seen[$name] = true;

        if (config("cache.stores.{$name}.driver") === 'failover') {
            foreach ((array) config("cache.stores.{$name}.stores", []) as $member) {
                if (is_string($member) && $member !== '') {
                    $this->expand($member, $seen, $concrete);
                }
            }

            return;
        }

        $concrete[$name] = true;
    }

    private function resetStore(string $name): int
    {
        $store = Cache::store($name)->getStore();
        // El prefijo del store lo pone el CacheManager desde `cache.prefix` en
        // todos los drivers; es lo que separa la clave lógica de la almacenada.
        $prefix = (string) config('cache.prefix');

        return match (true) {
            $store instanceof RedisStore => $this->resetRedisStore($name, $prefix, $store),
            $store instanceof DatabaseStore => $this->resetDatabaseStore($name, $prefix),
            default => throw new \RuntimeException(
                "uvh:e2e:reset-limits no sabe borrar presupuestos del store [{$name}] (".get_class($store).'): no finge: amplía el comando para ese driver.',
            ),
        };
    }

    private function resetDatabaseStore(string $name, string $prefix): int
    {
        $configured = config("cache.stores.{$name}.connection");
        $database = DB::connection(is_string($configured) && $configured !== '' ? $configured : null);
        $table = (string) config("cache.stores.{$name}.table", 'cache');

        $removed = 0;
        foreach ($database->table($table)->pluck('key') as $key) {
            $key = (string) $key;
            if (! str_starts_with($key, $prefix) || ! self::isBudgetKey(substr($key, strlen($prefix)))) {
                continue;
            }
            $removed += $database->table($table)->where('key', $key)->delete();
        }

        return $removed;
    }

    private function resetRedisStore(string $name, string $prefix, RedisStore $store): int
    {
        $client = $store->connection()->client();
        if (! $client instanceof \Redis) {
            throw new \RuntimeException("uvh:e2e:reset-limits sólo soporta phpredis; el store [{$name}] usa otro cliente.");
        }

        // En Redis la clave real es PREFIJO_CONEXIÓN . prefijo_de_cache . clave
        // lógica. El script corre en el servidor —sin el recubrimiento del
        // cliente—, así que el patrón necesita los dos prefijos completos y filtra
        // sobre la parte lógica. `KEYS` bloquea, y aquí está bien: es una pila
        // de pruebas efímera, no un despliegue.
        $fullPrefix = (string) ($client->getOption(\Redis::OPT_PREFIX) ?: '').$prefix;

        // El predicado es el de `isBudgetKey()` escrito para Lua (sin
        // alternación en patrones): prefijo fijo de presupuesto, grafía
        // `uvh-…` sin hashear, o hex de 32/40 con `:timer` opcional.
        // Mantener AMBOS predicados juntos.
        $script = <<<'LUA'
local prefix = ARGV[1]
local removed = 0
for _, key in ipairs(redis.call('KEYS', prefix .. '*')) do
    local logical = string.sub(key, #prefix + 1)
    local hex, suffix = string.match(logical, '^(%x+)(.*)$')
    local limiter = hex ~= nil and (#hex == 32 or #hex == 40) and (suffix == '' or suffix == ':timer')
    local budget = string.find(logical, 'uvh:mfa:attempts:', 1, true) == 1
        or string.find(logical, 'uvh-', 1, true) == 1
    if budget or limiter then
        removed = removed + redis.call('DEL', key)
    end
end
return removed
LUA;

        // Firma phpredis: `eval(script, args, numKeys)`. Los `ARGV` del script
        // llegan crudos al servidor —sin el prefijo del cliente—, que es justo
        // lo que el patrón necesita.
        return (int) $client->eval($script, [$fullPrefix], 0);
    }

    /** ¿Es esta clave lógica un presupuesto de rate limit y nada más que eso? */
    private static function isBudgetKey(string $logical): bool
    {
        return str_starts_with($logical, self::BUDGET_PREFIX)
            || str_starts_with($logical, 'uvh-')
            || preg_match('/^([0-9a-f]{32}|[0-9a-f]{40})(:timer)?$/D', $logical) === 1;
    }
}
