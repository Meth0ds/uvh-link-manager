<?php

use App\Http\Controllers\AppAssociationController;
use App\Http\Controllers\AppOpeningController;
use App\Http\Controllers\EdgeController;
use App\Http\Controllers\LanguageEntryController;
use App\Http\Controllers\OperationsController;
use App\Http\Controllers\PublicController;
use App\Http\Controllers\RedirectController;
use App\Http\Controllers\SocialCardController;
use App\Http\Controllers\VisitorAssetController;
use Illuminate\Support\Facades\Route;

Route::get('/health', [PublicController::class, 'health'])->middleware('throttle:uvh-health');
Route::get('/internal/caddy/ask', [EdgeController::class, 'caddyAsk']);
Route::get('/internal/metrics', [OperationsController::class, 'metrics']);
Route::get('/robots.txt', [PublicController::class, 'robots']);
Route::get('/sitemap.xml', [PublicController::class, 'sitemap']);

Route::get('/.well-known/uvh-social/{publication}/{assetId}.jpg', [SocialCardController::class, 'image'])->whereUuid('publication')->whereUuid('assetId')->middleware('throttle:uvh-resolve');

Route::get('/.well-known/{file}', [AppAssociationController::class, 'show'])->where('file', 'apple-app-site-association|assetlinks\.json')->middleware('throttle:uvh-resolve');
Route::get('/a/{alias}', [AppOpeningController::class, 'launch'])->middleware('throttle:uvh-resolve');
Route::get('/app-links/continue/{id}/{choice}', [AppOpeningController::class, 'prepared'])->whereUuid('id')->where('choice', 'app|web')->middleware('throttle:uvh-resolve');
Route::post('/app-links/continue', [AppOpeningController::class, 'continue'])->middleware(['uvh.csrf', 'throttle:uvh-resolve']);
Route::get('/visitor-assets/{file}', [VisitorAssetController::class, 'show'])->where('file', '[a-z0-9.-]+');
Route::get('/app-links/manrope-{weight}.woff2', [AppOpeningController::class, 'font'])->where('weight', '400|600');
Route::get('/app-links/bridge.js', [AppOpeningController::class, 'bridgeScript'])->middleware('throttle:uvh-resolve');

Route::get('/r/{alias}', [RedirectController::class, 'resolve'])->middleware('throttle:uvh-resolve');
// Unlocking a protected link has its own per-host/alias/IP budget. It must
// not compete with anonymous abuse reports or status checks from the same
// NAT, otherwise unrelated public traffic can deny a valid password attempt.
Route::post('/r/{alias}/unlock', [RedirectController::class, 'unlock'])->middleware('throttle:uvh-unlock');
// Un refresco de la pantalla de error —o el botón «atrás» después de un intento
// fallido— llega aquí como GET, que no tenía ruta: el visitante recibía una
// página 405 del framework en lugar de su formulario. Devuelve a la puerta.
Route::get('/r/{alias}/unlock', fn (string $alias) => redirect('/r/'.rawurlencode($alias), 302));

// The bare root of a hostname. First-party roots are served by the SPA before
// Laravel; a custom domain's root is its owner's choice (root redirect or its
// not-found mode) and lives here with the rest of the redirect surface.
Route::get('/', [LanguageEntryController::class, 'root'])->middleware('throttle:uvh-resolve');

// Canonical public surface: /{alias}.
Route::get('/{alias}', [RedirectController::class, 'resolve'])->middleware('throttle:uvh-resolve');
