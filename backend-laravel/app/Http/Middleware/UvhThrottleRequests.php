<?php

namespace App\Http\Middleware;

use App\Cache\UvhRateLimiter;
use App\Support\UvhLimiters;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Support\Facades\Cache;
use Symfony\Component\HttpFoundation\Response;

/**
 * Named throttles, counted on the store each class of risk belongs to.
 *
 * Only `handleRequestUsingNamedLimiter` is overridden, and that is deliberate:
 * the framework decides between a named limiter and a numeric `throttle:60,1`
 * with `func_num_args() === 3` inside `handle()`. Re-implementing `handle()` to
 * inject a store would have to reproduce that argument count, and getting it
 * wrong turns every named limiter into the numeric path — silently, and with
 * the wrong key. Wrapping the named path leaves the numeric one untouched.
 *
 * The swap is restored in `finally` so a limiter that throws (an exceeded
 * budget throws by design) cannot leave the request cycle counting the rest of
 * its limiters on the security store.
 */
final class UvhThrottleRequests extends ThrottleRequests
{
    /**
     * @param  Request  $request
     * @param  string  $limiterName
     * @return Response
     */
    protected function handleRequestUsingNamedLimiter($request, Closure $next, $limiterName, Closure $limiter)
    {
        $store = UvhLimiters::isSecurity((string) $limiterName) ? UvhLimiters::securityStore() : null;
        if ($store === null || ! $this->limiter instanceof UvhRateLimiter) {
            return parent::handleRequestUsingNamedLimiter($request, $next, $limiterName, $limiter);
        }

        $availability = $this->limiter;
        $this->limiter = $availability->withStore(Cache::store($store));

        try {
            return parent::handleRequestUsingNamedLimiter($request, $next, $limiterName, $limiter);
        } finally {
            $this->limiter = $availability;
        }
    }
}
