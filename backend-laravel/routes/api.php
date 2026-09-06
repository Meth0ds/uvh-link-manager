<?php

use App\Http\Controllers\AccountController;
use App\Http\Controllers\AdminController;
use App\Http\Controllers\AnalyticsController;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\DomainController;
use App\Http\Controllers\LinkController;
use App\Http\Controllers\LinkIntentController;
use App\Http\Controllers\PrivacyRightsController;
use App\Http\Controllers\PublicController;
use App\Http\Controllers\TokenController;
use App\Http\Controllers\WebhookController;
use App\Http\Controllers\WorkspaceActivityController;
use App\Http\Controllers\WorkspaceController;
use App\Http\Controllers\WorkspaceOnboardingController;
use App\Http\Controllers\WorkspaceUsageController;
use Illuminate\Support\Facades\Route;

// Bearer-token integration API. These routes intentionally sit outside the
// browser double-submit CSRF middleware: Authorization bearer credentials do
// not ride ambient cookies. Every route is still IP- and token-rate-limited.
Route::prefix('v1')->middleware('throttle:uvh-api')->group(function () {
    Route::get('analytics/public/overview', [AnalyticsController::class, 'publicOverview'])
        ->middleware(['uvh.apitoken:analytics:read', 'throttle:uvh-api-token']);

    Route::prefix('public/links')->group(function () {
        Route::get('/', [LinkController::class, 'index'])->middleware(['uvh.apitoken:links:read', 'throttle:uvh-api-token']);
        Route::get('{id}', [LinkController::class, 'show'])->middleware(['uvh.apitoken:links:read', 'throttle:uvh-api-token'])->where('id', '[0-9]+');
        Route::post('check-alias', [LinkController::class, 'checkAlias'])->middleware(['uvh.apitoken:links:read', 'throttle:uvh-api-token']);
        Route::post('/', [LinkController::class, 'store'])->middleware(['uvh.apitoken:links:write', 'throttle:uvh-api-token']);
        Route::patch('{id}', [LinkController::class, 'update'])->middleware(['uvh.apitoken:links:write', 'throttle:uvh-api-token'])->where('id', '[0-9]+');
        Route::post('{id}/state', [LinkController::class, 'state'])->middleware(['uvh.apitoken:links:write', 'throttle:uvh-api-token'])->where('id', '[0-9]+');
        Route::delete('{id}', [LinkController::class, 'destroy'])->middleware(['uvh.apitoken:links:write', 'throttle:uvh-api-token'])->where('id', '[0-9]+');
        Route::post('{id}/restore', [LinkController::class, 'restore'])->middleware(['uvh.apitoken:links:write', 'throttle:uvh-api-token'])->where('id', '[0-9]+');
    });

    Route::prefix('public/domains')->group(function () {
        Route::get('/', [DomainController::class, 'index'])->middleware(['uvh.apitoken:domains:read', 'throttle:uvh-api-token']);
        Route::post('/', [DomainController::class, 'store'])->middleware(['uvh.apitoken:domains:write', 'throttle:uvh-api-token']);
        Route::post('{id}/verify', [DomainController::class, 'verify'])->middleware(['uvh.apitoken:domains:write', 'throttle:uvh-api-token', 'throttle:uvh-domain-dns'])->where('id', '[0-9]+');
        Route::post('{id}/activate', [DomainController::class, 'activate'])->middleware(['uvh.apitoken:domains:write', 'throttle:uvh-api-token'])->where('id', '[0-9]+');
        Route::post('{id}/disable', [DomainController::class, 'disable'])->middleware(['uvh.apitoken:domains:write', 'throttle:uvh-api-token'])->where('id', '[0-9]+');
        Route::delete('{id}', [DomainController::class, 'destroy'])->middleware(['uvh.apitoken:domains:write', 'throttle:uvh-api-token'])->where('id', '[0-9]+');
        Route::post('{id}/revalidate', [DomainController::class, 'revalidate'])->middleware(['uvh.apitoken:domains:write', 'throttle:uvh-api-token', 'throttle:uvh-domain-dns'])->where('id', '[0-9]+');
    });
});

Route::prefix('v1')->middleware('uvh.csrf')->group(function () {
    // Public (host-agnostic) endpoints.
    Route::get('csrf', [PublicController::class, 'csrf']);
    Route::get('config', [PublicController::class, 'config']);
    Route::get('status', [PublicController::class, 'status'])->middleware('throttle:uvh-status');
    Route::get('public-status', [PublicController::class, 'publicStatus'])->middleware('throttle:uvh-status');
    Route::post('report', [PublicController::class, 'report'])->middleware('throttle:uvh-report');
    Route::post('create', [PublicController::class, 'create'])->middleware('throttle:uvh-link-create');
    Route::post('link-intents', [LinkIntentController::class, 'issue'])->middleware('throttle:uvh-link-create');

    // Auth.
    Route::post('auth/register', [AuthController::class, 'register'])->middleware('throttle:uvh-register');
    Route::post('auth/change-registration-email', [AuthController::class, 'changeRegistrationEmail'])->middleware('throttle:uvh-register');
    Route::post('auth/login', [AuthController::class, 'login'])->middleware('throttle:uvh-login');
    Route::post('auth/mfa/verify', [AuthController::class, 'mfaVerify'])->middleware('throttle:uvh-mfa');
    Route::post('auth/mfa/recovery', [AuthController::class, 'mfaRecovery'])->middleware('throttle:uvh-mfa');
    Route::post('auth/logout', [AuthController::class, 'logout']);
    Route::post('auth/verify-email', [AuthController::class, 'verifyEmail'])->middleware('throttle:uvh-email-verify');
    Route::post('auth/confirm-email-change', [AuthController::class, 'confirmEmailChange'])->middleware('throttle:uvh-email-verify');
    Route::post('auth/data-export/confirm', [AccountController::class, 'confirmExport'])->middleware('throttle:uvh-email-verify');
    Route::post('auth/data-export/download', [AccountController::class, 'downloadExport'])->middleware('throttle:uvh-email-verify');
    Route::post('auth/account-deletion/confirm', [AccountController::class, 'confirmDeletion'])->middleware('throttle:uvh-email-verify');
    Route::post('auth/account-deletion/cancel', [AccountController::class, 'cancelDeletion'])->middleware('throttle:uvh-email-verify');
    // Public: an unverified user has no session after registration/login, so
    // the resend path must remain reachable without authentication. The
    // controller keeps the response generic to avoid email enumeration.
    Route::post('auth/resend-verification', [AuthController::class, 'resendVerification'])->middleware('throttle:uvh-email-verify');
    Route::post('auth/forgot-password', [AuthController::class, 'forgotPassword'])->middleware('throttle:uvh-password-reset');
    Route::post('auth/reset-password', [AuthController::class, 'resetPassword'])->middleware('throttle:uvh-password-reset');
    Route::post('auth/security-incident/revoke', [AuthController::class, 'revokeCompromisedAccess'])->middleware('throttle:uvh-security-incident');
    Route::post('auth/account-recovery/request', [AuthController::class, 'requestAccountRecovery'])->middleware('throttle:uvh-account-recovery');
    Route::post('auth/account-recovery/confirm', [AuthController::class, 'confirmAccountRecovery'])->middleware('throttle:uvh-account-recovery');
    Route::post('auth/account-recovery/complete', [AuthController::class, 'completeAccountRecovery'])->middleware('throttle:uvh-account-recovery');
    Route::get('auth/me', [AuthController::class, 'me'])->middleware('uvh.auth');
    Route::get('auth/mfa/session', [AuthController::class, 'mfaSessionStatus'])->middleware('uvh.auth');
    Route::post('auth/mfa/reauthenticate', [AuthController::class, 'mfaReauthenticate'])
        ->middleware(['uvh.auth:verified', 'throttle:uvh-credential']);
    Route::patch('auth/profile', [AuthController::class, 'profile'])->middleware('uvh.auth');
    Route::post('auth/change-email', [AuthController::class, 'requestEmailChange'])->middleware(['uvh.auth:verified', 'throttle:uvh-credential']);
    Route::post('auth/change-email/cancel', [AuthController::class, 'cancelEmailChange'])->middleware(['uvh.auth:verified', 'throttle:uvh-credential']);
    Route::get('auth/data-export', [AccountController::class, 'exportStatus'])->middleware('uvh.auth:verified');
    Route::post('auth/data-export', [AccountController::class, 'requestExport'])->middleware(['uvh.auth:verified', 'throttle:uvh-credential']);
    Route::post('auth/data-export/cancel', [AccountController::class, 'cancelExport'])->middleware(['uvh.auth:verified', 'throttle:uvh-credential']);
    Route::get('auth/account-deletion', [AccountController::class, 'deletionImpact'])->middleware('uvh.auth:verified');
    Route::post('auth/account-deletion', [AccountController::class, 'requestDeletion'])->middleware(['uvh.auth:verified', 'throttle:uvh-credential']);
    Route::get('auth/privacy-requests', [PrivacyRightsController::class, 'index'])->middleware('uvh.auth:verified');
    Route::post('auth/privacy-requests', [PrivacyRightsController::class, 'store'])->middleware(['uvh.auth:verified', 'throttle:uvh-privacy']);
    Route::post('auth/privacy-requests/{id}/respond', [PrivacyRightsController::class, 'respond'])->middleware(['uvh.auth:verified', 'throttle:uvh-privacy'])->where('id', '[0-9]+');
    Route::post('auth/privacy-requests/{id}/cancel', [PrivacyRightsController::class, 'cancel'])->middleware(['uvh.auth:verified', 'throttle:uvh-privacy'])->where('id', '[0-9]+');
    Route::post('link-intents/claim', [LinkIntentController::class, 'claim'])->middleware('uvh.auth:verified');
    Route::post('link-intents/complete', [LinkIntentController::class, 'complete'])->middleware('uvh.auth:verified');
    Route::post('auth/change-password', [AuthController::class, 'changePassword'])->middleware(['uvh.auth', 'throttle:uvh-credential']);
    Route::get('auth/sessions', [AuthController::class, 'sessions'])->middleware('uvh.auth');
    Route::get('auth/security-center', [AuthController::class, 'securityCenter'])->middleware('uvh.auth');
    Route::post('auth/sessions/{id}/revoke', [AuthController::class, 'revokeSession'])->middleware('uvh.auth');
    Route::post('auth/mfa/setup', [AuthController::class, 'mfaSetup'])->middleware(['uvh.auth', 'throttle:uvh-credential']);
    Route::post('auth/mfa/enable', [AuthController::class, 'mfaEnable'])->middleware(['uvh.auth', 'throttle:uvh-credential']);
    Route::post('auth/mfa/cancel-setup', [AuthController::class, 'mfaCancelSetup'])->middleware(['uvh.auth', 'throttle:uvh-credential']);
    Route::post('auth/mfa/recovery-codes/regenerate', [AuthController::class, 'mfaRegenerateRecoveryCodes'])
        ->middleware(['uvh.auth', 'uvh.mfa', 'throttle:uvh-credential']);
    Route::post('auth/mfa/disable', [AuthController::class, 'mfaDisable'])->middleware(['uvh.auth', 'throttle:uvh-credential']);

    // Links.
    Route::prefix('links')->middleware(['uvh.auth', 'uvh.auth:verified'])->group(function () {
        Route::get('meta/role', [LinkController::class, 'role'])->middleware('uvh.workspace:viewer');
        Route::get('trash', [LinkController::class, 'trash'])->middleware('uvh.workspace:viewer');
        Route::get('/', [LinkController::class, 'index'])->middleware('uvh.workspace:viewer');
        Route::post('check-alias', [LinkController::class, 'checkAlias'])->middleware(['uvh.workspace:viewer', 'throttle:uvh-link-create']);
        Route::post('/', [LinkController::class, 'store'])->middleware(['uvh.workspace:editor', 'throttle:uvh-link-create']);
        Route::get('{id}/activity', [LinkController::class, 'activity'])->middleware('uvh.workspace:viewer')->where('id', '[0-9]+');
        Route::get('{id}', [LinkController::class, 'show'])->middleware('uvh.workspace:viewer')->where('id', '[0-9]+');
        Route::patch('{id}', [LinkController::class, 'update'])->middleware('uvh.workspace:editor')->where('id', '[0-9]+');
        Route::post('{id}/state', [LinkController::class, 'state'])->middleware('uvh.workspace:editor')->where('id', '[0-9]+');
        Route::delete('{id}', [LinkController::class, 'destroy'])->middleware('uvh.workspace:editor')->where('id', '[0-9]+');
        Route::post('{id}/restore', [LinkController::class, 'restore'])->middleware('uvh.workspace:editor')->where('id', '[0-9]+');
        Route::post('{id}/purge', [LinkController::class, 'purge'])->middleware(['uvh.workspace:admin', 'throttle:uvh-credential'])->where('id', '[0-9]+');
    });

    // Analytics.
    Route::prefix('analytics')->group(function () {
        Route::get('overview', [AnalyticsController::class, 'overview'])->middleware(['uvh.auth:verified', 'uvh.workspace:viewer', 'throttle:uvh-analytics']);
    });

    // Workspaces.
    Route::prefix('workspaces')->middleware('uvh.auth')->group(function () {
        Route::post('invitations/accept', [WorkspaceController::class, 'acceptInvitation']);
        Route::post('invitations/reject', [WorkspaceController::class, 'rejectInvitation']);
        Route::get('/', [WorkspaceController::class, 'index']);
        Route::post('/', [WorkspaceController::class, 'store'])->middleware('uvh.auth:verified');
        Route::get('{id}', [WorkspaceController::class, 'show'])->where('id', '[0-9]+');
        Route::get('{id}/getting-started', [WorkspaceOnboardingController::class, 'show'])
            ->middleware(['uvh.auth:verified', 'throttle:uvh-api'])->where('id', '[0-9]+');
        Route::get('{id}/activity', [WorkspaceActivityController::class, 'index'])
            ->middleware(['uvh.auth:verified', 'throttle:uvh-api', 'throttle:uvh-activity'])->where('id', '[0-9]+');
        Route::get('{id}/usage', [WorkspaceUsageController::class, 'show'])
            ->middleware(['uvh.auth:verified', 'throttle:uvh-api', 'throttle:uvh-usage'])->where('id', '[0-9]+');
        Route::patch('{id}', [WorkspaceController::class, 'rename'])->where('id', '[0-9]+');
        Route::patch('{id}/members/{userId}', [WorkspaceController::class, 'changeRole'])->where('id', '[0-9]+')->where('userId', '[0-9]+');
        Route::post('{id}/transfer-ownership', [WorkspaceController::class, 'transferOwnership'])->middleware(['uvh.auth:verified', 'throttle:uvh-credential'])->where('id', '[0-9]+');
        Route::delete('{id}/members/{userId}', [WorkspaceController::class, 'removeMember'])->where('id', '[0-9]+')->where('userId', '[0-9]+');
        Route::post('{id}/leave', [WorkspaceController::class, 'leave'])->where('id', '[0-9]+');
        Route::delete('{id}', [WorkspaceController::class, 'destroy'])->middleware(['uvh.auth:verified', 'throttle:uvh-credential'])->where('id', '[0-9]+');
        Route::post('{id}/invitations', [WorkspaceController::class, 'invite'])->middleware(['uvh.auth:verified', 'throttle:uvh-invitation'])->where('id', '[0-9]+');
        Route::delete('{id}/invitations/{invitationId}', [WorkspaceController::class, 'cancelInvitation'])->where('id', '[0-9]+')->where('invitationId', '[0-9]+');
        Route::post('{id}/invitations/{invitationId}/resend', [WorkspaceController::class, 'resendInvitation'])->middleware(['uvh.auth:verified', 'throttle:uvh-invitation'])->where('id', '[0-9]+')->where('invitationId', '[0-9]+');
    });

    // Domains.
    Route::prefix('domains')->middleware('uvh.auth')->group(function () {
        Route::get('/', [DomainController::class, 'index'])->middleware(['uvh.auth:verified', 'uvh.workspace:viewer']);
        Route::get('{id}', [DomainController::class, 'show'])->middleware(['uvh.auth:verified', 'uvh.workspace:viewer'])->where('id', '[0-9]+');
        Route::post('/', [DomainController::class, 'store'])->middleware(['uvh.auth:verified', 'uvh.workspace:editor']);
        Route::post('{id}/verify', [DomainController::class, 'verify'])->middleware(['uvh.auth:verified', 'uvh.workspace:editor', 'throttle:uvh-domain-dns'])->where('id', '[0-9]+');
        Route::post('{id}/activate', [DomainController::class, 'activate'])->middleware(['uvh.auth:verified', 'uvh.workspace:editor'])->where('id', '[0-9]+');
        Route::post('{id}/disable', [DomainController::class, 'disable'])->middleware(['uvh.auth:verified', 'uvh.workspace:editor'])->where('id', '[0-9]+');
        Route::delete('{id}', [DomainController::class, 'destroy'])->middleware(['uvh.auth:verified', 'uvh.workspace:editor'])->where('id', '[0-9]+');
        Route::post('{id}/revalidate', [DomainController::class, 'revalidate'])->middleware(['uvh.auth:verified', 'uvh.workspace:editor', 'throttle:uvh-domain-dns'])->where('id', '[0-9]+');
    });

    // API tokens.
    Route::prefix('tokens')->middleware('uvh.auth')->group(function () {
        Route::get('/', [TokenController::class, 'index'])->middleware(['uvh.auth:verified', 'uvh.workspace:editor']);
        Route::post('/', [TokenController::class, 'store'])->middleware(['uvh.auth:verified', 'uvh.workspace:editor', 'throttle:uvh-credential']);
        Route::delete('{id}', [TokenController::class, 'destroy'])->middleware(['uvh.auth:verified', 'uvh.workspace:editor'])->where('id', '[0-9]+');
    });

    // Webhooks.
    Route::prefix('webhooks')->middleware('uvh.auth')->group(function () {
        Route::get('/', [WebhookController::class, 'index'])->middleware(['uvh.auth:verified', 'uvh.workspace:viewer']);
        Route::post('/', [WebhookController::class, 'store'])->middleware(['uvh.auth:verified', 'uvh.workspace:editor', 'throttle:uvh-webhook-action']);
        Route::patch('{id}', [WebhookController::class, 'update'])->middleware(['uvh.auth:verified', 'uvh.workspace:editor'])->where('id', '[0-9]+');
        Route::delete('{id}', [WebhookController::class, 'destroy'])->middleware(['uvh.auth:verified', 'uvh.workspace:editor'])->where('id', '[0-9]+');
        Route::get('{id}/deliveries', [WebhookController::class, 'deliveries'])->middleware(['uvh.auth:verified', 'uvh.workspace:viewer'])->where('id', '[0-9]+');
        Route::post('{id}/deliveries/{deliveryId}/resend', [WebhookController::class, 'resend'])->middleware(['uvh.auth:verified', 'uvh.workspace:editor', 'throttle:uvh-webhook-action'])->where('id', '[0-9]+')->where('deliveryId', '[0-9]+');
        Route::post('{id}/test', [WebhookController::class, 'test'])->middleware(['uvh.auth:verified', 'uvh.workspace:editor', 'throttle:uvh-webhook-action'])->where('id', '[0-9]+');
    });

    // Admin (MFA-gated).
    Route::prefix('admin')->middleware(['uvh.auth:admin', 'uvh.mfa:fresh', 'throttle:uvh-admin'])->group(function () {
        Route::get('overview', [AdminController::class, 'overview']);
        Route::get('users', [AdminController::class, 'users']);
        Route::patch('users/{id}', [AdminController::class, 'updateUser'])->where('id', '[0-9]+');
        Route::get('reports', [AdminController::class, 'reports']);
        Route::get('account-recoveries', [AdminController::class, 'accountRecoveries']);
        Route::post('account-recoveries/{id}/decision', [AdminController::class, 'decideAccountRecovery'])->where('id', '[0-9]+');
        Route::patch('reports/{id}', [AdminController::class, 'updateReport'])->where('id', '[0-9]+');
        Route::post('reports/{id}/moderate', [AdminController::class, 'moderateReport'])->where('id', '[0-9]+');
        Route::post('links/{id}/block', [AdminController::class, 'blockLink'])->where('id', '[0-9]+');
        Route::post('links/{id}/unblock', [AdminController::class, 'unblockLink'])->where('id', '[0-9]+');
        Route::get('domains', [AdminController::class, 'domains']);
        Route::get('audit', [AdminController::class, 'audit']);
        Route::get('operations', [AdminController::class, 'operations']);
        Route::get('mail-outbox', [AdminController::class, 'mailOutbox']);
        Route::post('mail-outbox/{id}/retry', [AdminController::class, 'retryMailOutbox'])
            ->middleware('throttle:uvh-mail-retry')->where('id', '[0-9]+');
        Route::get('privacy-requests', [PrivacyRightsController::class, 'adminIndex']);
        Route::post('privacy-requests/{id}/action', [PrivacyRightsController::class, 'adminAction'])
            ->middleware('throttle:uvh-privacy-admin')->where('id', '[0-9]+');
    });

    // API 404 within /api/v1: CSRF must still be issued here (the CSRF guard
    // covers the whole /api/v1 surface, including unknown paths).
    Route::any('{any}', fn () => response()->json(['error' => 'Ruta no encontrada'], 404))->where('any', '.*');
});

// API 404 for non-v1 paths.
Route::any('/{any}', fn () => response()->json(['error' => 'Ruta no encontrada'], 404))->where('any', '.*');
