<?php

namespace App\Cache;

use Illuminate\Cache\RateLimiter;
use Illuminate\Contracts\Cache\Repository as Cache;

/**
 * The named rate limiters, reusable against more than one store.
 *
 * The framework binds a single `RateLimiter` to a single cache store, and every
 * `RateLimiter::for(...)` definition lives in that one instance. Swapping the
 * store by resolving a second `RateLimiter` would therefore resolve an empty
 * one, with no named limiters in it and no way to register them again from the
 * middleware.
 *
 * `withStore()` instead returns a copy that shares the limiter registry and
 * points at another repository, so `ThrottleRequests` can keep using its own
 * `$this->limiter->limiter($name)` lookup while counting somewhere else. The
 * registry is copied by value and the closures are stateless, so the copy is
 * safe to build per request.
 */
final class UvhRateLimiter extends RateLimiter
{
    public function withStore(Cache $cache): self
    {
        $copy = clone $this;
        $copy->cache = $cache;

        return $copy;
    }
}
