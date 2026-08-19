<?php

use App\Http\Controllers\AdminController;
use App\Http\Controllers\AnalyticsController;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\DomainController;
use App\Http\Controllers\LinkController;
use App\Http\Controllers\PublicController;
use App\Http\Controllers\TokenController;
use App\Http\Controllers\WebhookController;
use App\Http\Controllers\WorkspaceController;
use Illuminate\Support\Facades\Route;

Route::prefix('v1')->middleware('uvh.csrf')->group(function () {
    // Public (host-agnostic) endpoints.
    Route::get('csrf', [PublicController::class, 'csrf']);
    Route::get('config', [PublicController::class, 'config']);
    Route::get('status', [PublicController::class, 'status'])->middleware('throttle:uvh-report');
    Route::post('report', [PublicController::class, 'report'])->middleware('throttle:uvh-report');
    Route::post('create', [PublicController::class, 'create'])->middleware('throttle:uvh-link-create');

    // Auth.
    Route::get('auth/captcha', [AuthController::class, 'captcha'])->middleware('throttle:uvh-register');
    Route::post('auth/register', [AuthController::class, 'register'])->middleware('throttle:uvh-register');
    Route::post('auth/change-registration-email', [AuthController::class, 'changeRegistrationEmail'])->middleware('throttle:uvh-register');
    Route::post('auth/login', [AuthController::class, 'login'])->middleware('throttle:uvh-auth');
    Route::post('auth/mfa/verify', [AuthController::class, 'mfaVerify'])->middleware('throttle:uvh-auth');
    Route::post('auth/mfa/recovery', [AuthController::class, 'mfaRecovery'])->middleware('throttle:uvh-auth');
    Route::post('auth/logout', [AuthController::class, 'logout']);
    Route::post('auth/verify-email', [AuthController::class, 'verifyEmail'])->middleware('throttle:uvh-auth');
    // Public: an unverified user has no session after registration/login, so
    // the resend path must remain reachable without authentication. The
    // controller keeps the response generic to avoid email enumeration.
    Route::post('auth/resend-verification', [AuthController::class, 'resendVerification'])->middleware('throttle:uvh-auth');
    Route::post('auth/forgot-password', [AuthController::class, 'forgotPassword'])->middleware('throttle:uvh-auth');
    Route::post('auth/reset-password', [AuthController::class, 'resetPassword'])->middleware('throttle:uvh-auth');
    Route::get('auth/me', [AuthController::class, 'me'])->middleware('uvh.auth');
    Route::patch('auth/profile', [AuthController::class, 'profile'])->middleware('uvh.auth');
    Route::post('auth/change-password', [AuthController::class, 'changePassword'])->middleware('uvh.auth');
    Route::get('auth/sessions', [AuthController::class, 'sessions'])->middleware('uvh.auth');
    Route::post('auth/sessions/{id}/revoke', [AuthController::class, 'revokeSession'])->middleware('uvh.auth');
    Route::post('auth/mfa/setup', [AuthController::class, 'mfaSetup'])->middleware('uvh.auth');
    Route::post('auth/mfa/enable', [AuthController::class, 'mfaEnable'])->middleware('uvh.auth');
    Route::post('auth/mfa/disable', [AuthController::class, 'mfaDisable'])->middleware('uvh.auth');

    // Links.
    Route::prefix('links')->middleware(['uvh.auth', 'uvh.auth:verified'])->group(function () {
        Route::get('meta/role', [LinkController::class, 'role'])->middleware('uvh.workspace:viewer');
        Route::get('/', [LinkController::class, 'index'])->middleware('uvh.workspace:viewer');
        Route::post('check-alias', [LinkController::class, 'checkAlias'])->middleware(['uvh.workspace:viewer', 'throttle:uvh-link-create']);
        Route::post('/', [LinkController::class, 'store'])->middleware(['uvh.workspace:editor', 'throttle:uvh-link-create']);
        Route::get('{id}/activity', [LinkController::class, 'activity'])->middleware('uvh.workspace:viewer')->where('id', '[0-9]+');
        Route::get('{id}', [LinkController::class, 'show'])->middleware('uvh.workspace:viewer')->where('id', '[0-9]+');
        Route::patch('{id}', [LinkController::class, 'update'])->middleware('uvh.workspace:editor')->where('id', '[0-9]+');
        Route::post('{id}/state', [LinkController::class, 'state'])->middleware('uvh.workspace:editor')->where('id', '[0-9]+');
        Route::delete('{id}', [LinkController::class, 'destroy'])->middleware('uvh.workspace:editor')->where('id', '[0-9]+');
        Route::post('{id}/restore', [LinkController::class, 'restore'])->middleware('uvh.workspace:editor')->where('id', '[0-9]+');
    });

    // Analytics.
    Route::prefix('analytics')->group(function () {
        Route::get('overview', [AnalyticsController::class, 'overview'])->middleware(['uvh.auth:verified', 'uvh.workspace:viewer']);
        Route::get('public/overview', [AnalyticsController::class, 'publicOverview'])->middleware(['throttle:uvh-api', 'uvh.apitoken:analytics:read', 'throttle:uvh-api-token']);
    });

    // Workspaces.
    Route::prefix('workspaces')->middleware('uvh.auth')->group(function () {
        Route::post('invitations/accept', [WorkspaceController::class, 'acceptInvitation']);
        Route::post('invitations/reject', [WorkspaceController::class, 'rejectInvitation']);
        Route::get('/', [WorkspaceController::class, 'index']);
        Route::post('/', [WorkspaceController::class, 'store'])->middleware('uvh.auth:verified');
        Route::get('{id}', [WorkspaceController::class, 'show'])->where('id', '[0-9]+');
        Route::patch('{id}', [WorkspaceController::class, 'rename'])->where('id', '[0-9]+');
        Route::patch('{id}/members/{userId}', [WorkspaceController::class, 'changeRole'])->where('id', '[0-9]+')->where('userId', '[0-9]+');
        Route::delete('{id}/members/{userId}', [WorkspaceController::class, 'removeMember'])->where('id', '[0-9]+')->where('userId', '[0-9]+');
        Route::post('{id}/leave', [WorkspaceController::class, 'leave'])->where('id', '[0-9]+');
        Route::delete('{id}', [WorkspaceController::class, 'destroy'])->where('id', '[0-9]+');
        Route::post('{id}/invitations', [WorkspaceController::class, 'invite'])->middleware('uvh.auth:verified')->where('id', '[0-9]+');
        Route::delete('{id}/invitations/{invitationId}', [WorkspaceController::class, 'cancelInvitation'])->where('id', '[0-9]+')->where('invitationId', '[0-9]+');
        Route::post('{id}/invitations/{invitationId}/resend', [WorkspaceController::class, 'resendInvitation'])->middleware('uvh.auth:verified')->where('id', '[0-9]+')->where('invitationId', '[0-9]+');
    });

    // Domains.
    Route::prefix('domains')->middleware('uvh.auth')->group(function () {
        Route::get('/', [DomainController::class, 'index'])->middleware(['uvh.auth:verified', 'uvh.workspace:viewer']);
        Route::post('/', [DomainController::class, 'store'])->middleware(['uvh.auth:verified', 'uvh.workspace:editor']);
        Route::post('{id}/verify', [DomainController::class, 'verify'])->middleware(['uvh.auth:verified', 'uvh.workspace:editor'])->where('id', '[0-9]+');
        Route::post('{id}/activate', [DomainController::class, 'activate'])->middleware(['uvh.auth:verified', 'uvh.workspace:editor'])->where('id', '[0-9]+');
        Route::post('{id}/disable', [DomainController::class, 'disable'])->middleware(['uvh.auth:verified', 'uvh.workspace:editor'])->where('id', '[0-9]+');
        Route::delete('{id}', [DomainController::class, 'destroy'])->middleware(['uvh.auth:verified', 'uvh.workspace:editor'])->where('id', '[0-9]+');
        Route::post('{id}/revalidate', [DomainController::class, 'revalidate'])->middleware(['uvh.auth:verified', 'uvh.workspace:editor'])->where('id', '[0-9]+');
    });

    // API tokens.
    Route::prefix('tokens')->middleware('uvh.auth')->group(function () {
        Route::get('/', [TokenController::class, 'index'])->middleware(['uvh.auth:verified', 'uvh.workspace:editor']);
        Route::post('/', [TokenController::class, 'store'])->middleware(['uvh.auth:verified', 'uvh.workspace:editor']);
        Route::delete('{id}', [TokenController::class, 'destroy'])->middleware(['uvh.auth:verified', 'uvh.workspace:editor'])->where('id', '[0-9]+');
    });

    // Webhooks.
    Route::prefix('webhooks')->middleware('uvh.auth')->group(function () {
        Route::get('/', [WebhookController::class, 'index'])->middleware(['uvh.auth:verified', 'uvh.workspace:viewer']);
        Route::post('/', [WebhookController::class, 'store'])->middleware(['uvh.auth:verified', 'uvh.workspace:editor']);
        Route::patch('{id}', [WebhookController::class, 'update'])->middleware(['uvh.auth:verified', 'uvh.workspace:editor'])->where('id', '[0-9]+');
        Route::delete('{id}', [WebhookController::class, 'destroy'])->middleware(['uvh.auth:verified', 'uvh.workspace:editor'])->where('id', '[0-9]+');
        Route::get('{id}/deliveries', [WebhookController::class, 'deliveries'])->middleware(['uvh.auth:verified', 'uvh.workspace:viewer'])->where('id', '[0-9]+');
        Route::post('{id}/deliveries/{deliveryId}/resend', [WebhookController::class, 'resend'])->middleware(['uvh.auth:verified', 'uvh.workspace:editor'])->where('id', '[0-9]+')->where('deliveryId', '[0-9]+');
        Route::post('{id}/test', [WebhookController::class, 'test'])->middleware(['uvh.auth:verified', 'uvh.workspace:editor'])->where('id', '[0-9]+');
    });

    // Admin (MFA-gated).
    Route::prefix('admin')->middleware(['uvh.auth:admin', 'uvh.mfa', 'throttle:uvh-admin'])->group(function () {
        Route::get('overview', [AdminController::class, 'overview']);
        Route::get('users', [AdminController::class, 'users']);
        Route::patch('users/{id}', [AdminController::class, 'updateUser'])->where('id', '[0-9]+');
        Route::get('reports', [AdminController::class, 'reports']);
        Route::patch('reports/{id}', [AdminController::class, 'updateReport'])->where('id', '[0-9]+');
        Route::post('links/{id}/block', [AdminController::class, 'blockLink'])->where('id', '[0-9]+');
        Route::post('links/{id}/unblock', [AdminController::class, 'unblockLink'])->where('id', '[0-9]+');
        Route::get('domains', [AdminController::class, 'domains']);
        Route::get('audit', [AdminController::class, 'audit']);
    });

    // API 404 within /api/v1: CSRF must still be issued here (the CSRF guard
    // covers the whole /api/v1 surface, including unknown paths).
    Route::any('{any}', fn () => response()->json(['error' => 'Ruta no encontrada'], 404))->where('any', '.*');
});

// API 404 for non-v1 paths.
Route::any('/{any}', fn () => response()->json(['error' => 'Ruta no encontrada'], 404))->where('any', '.*');
