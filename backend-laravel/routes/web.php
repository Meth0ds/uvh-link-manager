<?php

use App\Http\Controllers\EdgeController;
use App\Http\Controllers\PublicController;
use App\Http\Controllers\OperationsController;
use App\Http\Controllers\RedirectController;
use Illuminate\Support\Facades\Route;

Route::get('/health', [PublicController::class, 'health'])->middleware('throttle:uvh-health');
Route::get('/internal/caddy/ask', [EdgeController::class, 'caddyAsk']);
Route::get('/internal/metrics', [OperationsController::class, 'metrics']);
Route::get('/robots.txt', [PublicController::class, 'robots']);
Route::get('/sitemap.xml', [PublicController::class, 'sitemap']);

Route::get('/r/{alias}', [RedirectController::class, 'resolve'])->middleware('throttle:uvh-resolve');
// Unlocking a protected link has its own per-host/alias/IP budget. It must
// not compete with anonymous abuse reports or status checks from the same
// NAT, otherwise unrelated public traffic can deny a valid password attempt.
Route::post('/r/{alias}/unlock', [RedirectController::class, 'unlock'])->middleware('throttle:uvh-unlock');

// Canonical public surface: /{alias}.
Route::get('/{alias}', [RedirectController::class, 'resolve'])->middleware('throttle:uvh-resolve');
