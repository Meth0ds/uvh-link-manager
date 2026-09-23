<?php

use App\Http\Controllers\EdgeController;
use App\Http\Controllers\OperationsController;
use App\Http\Controllers\PublicController;
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
// Un refresco de la pantalla de error —o el botón «atrás» después de un intento
// fallido— llega aquí como GET, que no tenía ruta: el visitante recibía una
// página 405 del framework en lugar de su formulario. Devuelve a la puerta.
Route::get('/r/{alias}/unlock', fn (string $alias) => redirect('/r/'.rawurlencode($alias), 302));

// Canonical public surface: /{alias}.
Route::get('/{alias}', [RedirectController::class, 'resolve'])->middleware('throttle:uvh-resolve');
