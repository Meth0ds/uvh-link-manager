<?php

use App\Http\Controllers\PublicController;
use App\Http\Controllers\RedirectController;
use Illuminate\Support\Facades\Route;

Route::get('/health', [PublicController::class, 'health']);
Route::get('/robots.txt', [PublicController::class, 'robots']);
Route::get('/sitemap.xml', [PublicController::class, 'sitemap']);

Route::get('/r/{alias}', [RedirectController::class, 'resolve'])->middleware('throttle:uvh-resolve');
Route::post('/r/{alias}/unlock', [RedirectController::class, 'unlock'])->middleware(['throttle:uvh-report', 'throttle:uvh-unlock']);

// Canonical public surface: /{alias}.
Route::get('/{alias}', [RedirectController::class, 'resolve'])->middleware('throttle:uvh-resolve');
