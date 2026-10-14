<?php

namespace App\Http\Controllers;

use App\Exceptions\LinkException;
use App\Support\AnalyticsOverview;
use App\Support\AnalyticsReports;
use App\Support\SignedToken;
use App\Support\WorkspaceLimits;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Symfony\Component\HttpFoundation\Cookie;

final class SharedReportController
{
    public function access(Request $request, string $publicId): JsonResponse
    {
        try {
            AnalyticsReports::enabled();
            $origin = $request->header('Origin');
            $expected = rtrim((string) (config('uvh.frontend_url') ?: config('app.url')), '/');
            if (($origin !== null && $origin !== $expected) || (app()->isProduction() && $origin === null)) {
                throw new LinkException('No se pudo validar el origen de la solicitud.', 403);
            }

            return DB::transaction(function () use ($request, $publicId): JsonResponse {
                $row = $this->row($publicId);
                $token = $request->input('token');
                if (! is_string($token) || ! preg_match('/^[A-Za-z0-9_-]{43}$/D', $token) || ! hash_equals($row->secret_digest, hash('sha256', $token))) {
                    throw new LinkException('Este informe no está disponible.', 404);
                }
                $password = $request->input('password');
                if ($row->password_hash !== null) {
                    if ($password === null || $password === '') {
                        return response()->json(['passwordRequired' => true]);
                    }
                    if (! is_string($password) || strlen($password) > 72 || ! Hash::check($password, $row->password_hash)) {
                        throw new LinkException('La contraseña no es correcta.', 422);
                    }
                }
                $seconds = $row->expires_at === null ? 1800 : max(1, min(1800, (int) now()->diffInSeconds(CarbonImmutable::parse($row->expires_at), false)));
                $signed = SignedToken::sign(json_encode(['kind' => 'shared-report', 'report' => $publicId, 'version' => (int) $row->access_version], JSON_THROW_ON_ERROR), $seconds * 1000);
                $cookie = new Cookie($this->cookieName($publicId), $signed, time() + $seconds, '/api/v1/shared-reports/'.$publicId, null, (bool) config('uvh.cookie_secure'), true, false, 'lax');

                return response()->json(['passwordRequired' => false])->withCookie($cookie);
            }, 3);
        } catch (LinkException $e) {
            return response()->json(['error' => $e->getMessage()], $e->status);
        }
    }

    public function overview(Request $request, string $publicId): JsonResponse
    {
        try {
            AnalyticsReports::enabled();

            return DB::transaction(function () use ($request, $publicId): JsonResponse {
                DB::statement('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
                $row = $this->row($publicId);
                $cookie = $request->cookies->get($this->cookieName($publicId));
                $access = is_string($cookie) ? SignedToken::verify($cookie, fn ($p) => json_decode($p, true)) : null;
                if (! is_array($access) || ($access['kind'] ?? null) !== 'shared-report' || ($access['report'] ?? null) !== $publicId || ($access['version'] ?? null) !== (int) $row->access_version) {
                    throw new LinkException('Abre la URL compartida para acceder al informe.', 401);
                }
                $spec = json_decode($row->spec, true, 32, JSON_THROW_ON_ERROR);
                $end = $spec['period'] === 'custom' ? CarbonImmutable::parse($spec['to'], 'UTC')->endOfDay() : CarbonImmutable::now('UTC');
                $start = $spec['period'] === 'custom' ? CarbonImmutable::parse($spec['from'], 'UTC')->startOfDay() : $end->subDays((int) substr($spec['period'], 0, -1));
                $cutoff = CarbonImmutable::now('UTC')->subDays(WorkspaceLimits::analyticsRetentionDays());
                $links = DB::table('analytics_report_links')->where('report_id', $row->id)->orderBy('link_id')->get(['link_id', 'public_label']);
                $a = app(AnalyticsOverview::class)->overview((int) $row->workspace_id, $links->pluck('link_id')->map(fn ($id) => (int) $id)->all(), $start->format('Y-m-d\TH:i:s.uP'), $end->format('Y-m-d\TH:i:s.uP'), true);
                $sections = $spec['sections'];
                /** @var Collection<int, array{day: string, clicks: int, visitors: int}> $rawSeries */
                $rawSeries = $a['series'];
                $series = in_array('series', $sections, true) ? $rawSeries->map(fn ($p) => ['day' => $p['day'], 'visits' => $p['clicks'], 'available' => CarbonImmutable::parse($p['day'], 'UTC')->endOfDay()->gte($cutoff) && CarbonImmutable::parse($p['day'], 'UTC')->lte(now()->utc())])->all() : [];

                return response()->json(['version' => 1, 'title' => $spec['title'], 'description' => $spec['description'], 'sections' => $sections,
                    'labels' => $links->pluck('public_label')->all(), 'from' => $start->toIso8601String(), 'to' => $end->toIso8601String(), 'updatedAt' => now()->toIso8601String(), 'retainedFrom' => $cutoff->toIso8601String(),
                    'visits' => in_array('visits', $sections, true) && $end->gte($cutoff) ? $a['totals']['clicks'] : null, 'series' => $series,
                    'countries' => in_array('countries', $sections, true) ? $a['countries'] : [], 'devices' => in_array('devices', $sections, true) ? $a['devices'] : []]);
            }, 3);
        } catch (LinkException $e) {
            return response()->json(['error' => $e->getMessage()], $e->status);
        }
    }

    private function row(string $id): object
    {
        $hint = DB::table('analytics_reports')->where('public_id', $id)->first(['workspace_id']);
        if (! $hint || ! DB::table('workspaces')->where('id', $hint->workspace_id)->sharedLock()->first(['id'])) {
            throw new LinkException('Este informe no está disponible.', 404);
        }
        // Same workspace -> report -> links order as mutations and workspace erasure.
        $row = DB::table('analytics_reports')->where('public_id', $id)->where('workspace_id', $hint->workspace_id)->sharedLock()->first();
        if (! $row || ! AnalyticsReports::available($row)) {
            throw new LinkException('Este informe no está disponible.', 404);
        }

        return $row;
    }

    private function cookieName(string $id): string
    {
        return 'uvh_report_'.str_replace('-', '', $id);
    }
}
