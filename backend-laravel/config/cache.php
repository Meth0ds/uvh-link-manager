<?php

use Illuminate\Support\Str;

return [

    /*
    |--------------------------------------------------------------------------
    | Default Cache Store
    |--------------------------------------------------------------------------
    |
    | This option controls the default cache store that will be used by the
    | framework. This connection is utilized if another isn't explicitly
    | specified when running a cache operation inside the application.
    |
    */

    'default' => env('CACHE_STORE', 'database'),

    /*
    |--------------------------------------------------------------------------
    | Rate Limiter Cache Store
    |--------------------------------------------------------------------------
    |
    | Laravel resolves the rate limiter with this store, so every throttle
    | middleware counts its attempts here. It is separate from the default
    | store because throttling is the one cache consumer that must keep working
    | when Redis is unavailable: the public redirect surface is guarded by it.
    | Production points this at the failover store. Leaving it empty keeps the
    | default store, which is what every non-Redis environment uses.
    |
    */

    'limiter' => env('CACHE_LIMITER'),

    /*
    |--------------------------------------------------------------------------
    | Security Rate Limiter Cache Store
    |--------------------------------------------------------------------------
    |
    | Credential surfaces —login, MFA, verificación, recuperación de cuenta,
    | restablecimiento, reautenticación y registro— count on this second store
    | instead of the one above.
    |
    | The reason is that the two limits do not trade the same thing. For a
    | public redirect, availability wins: if the preferred backend is down, the
    | attempt is counted on the second member of the chain and traffic keeps
    | being served. For a credential surface a second backend is not a fallback
    | but a *second window*: the counter starts at zero, so an outage grants
    | the attacker a fresh budget, and when the first backend returns its older
    | counters reappear and can block a legitimate account that had already
    | forgotten the attempt.
    |
    | This store therefore must be a single shared backend, never a failover
    | chain, and production rejects Redis here: Redis is the dependency whose
    | outage this separation exists to survive, and login must keep working when
    | it falls. `CACHE_LIMITER_SECURITY=database` is the shipped value. Leaving
    | it empty — the default outside production — keeps the store above, which
    | is the behaviour this deployment had before the split.
    |
    */

    'limiter_security' => env('CACHE_LIMITER_SECURITY'),

    /*
    |--------------------------------------------------------------------------
    | Cache Stores
    |--------------------------------------------------------------------------
    |
    | Here you may define all of the cache "stores" for your application as
    | well as their drivers. You may even define multiple stores for the
    | same cache driver to group types of items stored in your caches.
    |
    | Supported drivers: "array", "database", "file", "memcached",
    |                    "redis", "dynamodb", "storage", "octane",
    |                    "session", "failover", "null"
    |
    */

    'stores' => [

        'array' => [
            'driver' => 'array',
            'serialize' => false,
        ],

        'database' => [
            'driver' => 'database',
            'connection' => env('DB_CACHE_CONNECTION'),
            'table' => env('DB_CACHE_TABLE', 'cache'),
            'lock_connection' => env('DB_CACHE_LOCK_CONNECTION'),
            'lock_table' => env('DB_CACHE_LOCK_TABLE'),
        ],

        'file' => [
            'driver' => 'file',
            'path' => storage_path('framework/cache/data'),
            'lock_path' => storage_path('framework/cache/data'),
        ],

        'storage' => [
            'driver' => 'storage',
            'disk' => env('CACHE_STORAGE_DISK'),
            'path' => env('CACHE_STORAGE_PATH', 'framework/cache/data'),
        ],

        'memcached' => [
            'driver' => 'memcached',
            'persistent_id' => env('MEMCACHED_PERSISTENT_ID'),
            'sasl' => [
                env('MEMCACHED_USERNAME'),
                env('MEMCACHED_PASSWORD'),
            ],
            'options' => [
                // Memcached::OPT_CONNECT_TIMEOUT => 2000,
            ],
            'servers' => [
                [
                    'host' => env('MEMCACHED_HOST', '127.0.0.1'),
                    'port' => env('MEMCACHED_PORT', 11211),
                    'weight' => 100,
                ],
            ],
        ],

        'redis' => [
            'driver' => 'redis',
            'connection' => env('REDIS_CACHE_CONNECTION', 'cache'),
            'lock_connection' => env('REDIS_CACHE_LOCK_CONNECTION', 'default'),
        ],

        'dynamodb' => [
            'driver' => 'dynamodb',
            'key' => env('AWS_ACCESS_KEY_ID'),
            'secret' => env('AWS_SECRET_ACCESS_KEY'),
            'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
            'table' => env('DYNAMODB_CACHE_TABLE', 'cache'),
            'endpoint' => env('DYNAMODB_ENDPOINT'),
        ],

        'octane' => [
            'driver' => 'octane',
        ],

        // Counting attempts on a second backend keeps public traffic served
        // while the first backend is down. Locks deliberately do NOT run on a
        // failover store: a lock needs one owner, and moving it silently to
        // another backend would let two processes believe they hold it. The
        // members are configurable so a deployment can order them as it likes;
        // the default assumes Redis is the fast path and PostgreSQL the net.
        'failover' => [
            'driver' => 'failover',
            'stores' => array_values(array_filter(array_map(
                'trim',
                explode(',', (string) env('CACHE_FAILOVER_STORES', 'redis,database')),
            ))),
        ],

    ],

    /*
    |--------------------------------------------------------------------------
    | Cache Key Prefix
    |--------------------------------------------------------------------------
    |
    | When utilizing the APC, database, memcached, Redis, and DynamoDB cache
    | stores, there might be other applications using the same cache. For
    | that reason, you may prefix every cache key to avoid collisions.
    |
    */

    'prefix' => env('CACHE_PREFIX', Str::slug((string) env('APP_NAME', 'laravel')).'-cache-'),

    /*
    |--------------------------------------------------------------------------
    | Serializable Classes
    |--------------------------------------------------------------------------
    |
    | This value determines the classes that can be unserialized from cache
    | storage. By default, no PHP classes will be unserialized from your
    | cache to prevent gadget chain attacks if your APP_KEY is leaked.
    |
    */

    'serializable_classes' => false,

];
