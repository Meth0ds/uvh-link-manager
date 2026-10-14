<?php

namespace App\Support;

use App\Exceptions\LinkException;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

final class AnalyticsReports
{
    public const SECTIONS = ['visits', 'series', 'countries', 'devices'];

    public static function enabled(): void
    {
        if (! config('sharing.reports')) {
            throw new LinkException('Esta función todavía no está disponible.', 404);
        }
    }

    public static function text(mixed $value, int $max, bool $required = false): string
    {
        if (! is_string($value) || ! mb_check_encoding($value, 'UTF-8') || mb_strlen($value) > $max || preg_match('/[\p{Cc}\p{Cf}]/u', $value)) {
            throw new LinkException('El texto no es válido.', 422);
        }
        $value = trim($value);
        if ($required && $value === '') {
            throw new LinkException('Completa el título y las etiquetas públicas.', 422);
        }

        return $value;
    }

    /** @return array<string, mixed> */
    public static function validateSpec(mixed $spec): array
    {
        if (! is_array($spec) || ($spec['version'] ?? null) !== 1 || array_diff(array_keys($spec), ['version', 'title', 'description', 'period', 'from', 'to', 'sections'])) {
            throw new LinkException('Configuración del informe inválida.', 422);
        }
        $sections = $spec['sections'] ?? self::SECTIONS;
        if (! is_array($sections) || ! array_is_list($sections) || $sections === [] || count($sections) > 4 || array_filter($sections, fn ($s) => ! is_string($s) || ! in_array($s, self::SECTIONS, true)) || count(array_unique($sections)) !== count($sections)) {
            throw new LinkException('Elige las secciones que podrá consultar el cliente.', 422);
        }
        $period = $spec['period'] ?? '30d';
        if (! in_array($period, ['7d', '30d', '90d', 'custom'], true)) {
            throw new LinkException('Periodo inválido.', 422);
        }
        $from = $spec['from'] ?? null;
        $to = $spec['to'] ?? null;
        if ($period === 'custom') {
            if (! is_string($from) || ! is_string($to) || ! preg_match('/^\d{4}-\d{2}-\d{2}$/D', $from) || ! preg_match('/^\d{4}-\d{2}-\d{2}$/D', $to) || ! IsoDate::parse($from) || ! IsoDate::parse($to)) {
                throw new LinkException('Selecciona dos fechas válidas.', 422);
            }
            $a = CarbonImmutable::parse($from, 'UTC');
            $b = CarbonImmutable::parse($to, 'UTC')->endOfDay();
            if ($a->gt($b) || $b->gt($a->addDays(180))) {
                throw new LinkException('El periodo debe abarcar como máximo 180 días.', 422);
            }
        } elseif ($from !== null || $to !== null) {
            throw new LinkException('Las fechas solo se admiten en un periodo personalizado.', 422);
        }

        return ['version' => 1, 'title' => self::text($spec['title'] ?? '', 120, true), 'description' => self::text($spec['description'] ?? '', 500), 'period' => $period, 'from' => $from, 'to' => $to, 'sections' => $sections];
    }

    /** @return list<array{linkId: int, label: string}> */
    public static function validateLinks(mixed $items, int $workspace): array
    {
        if (! is_array($items) || ! array_is_list($items) || count($items) < 1 || count($items) > 100) {
            throw new LinkException('Selecciona entre 1 y 100 enlaces.', 422);
        }
        $result = [];
        foreach ($items as $item) {
            if (! is_array($item) || array_diff(array_keys($item), ['linkId', 'label']) || ! is_int($item['linkId'] ?? null) || $item['linkId'] < 1) {
                throw new LinkException('Selección de enlaces inválida.', 422);
            }
            $result[] = ['linkId' => $item['linkId'], 'label' => self::text($item['label'] ?? '', 120, true)];
        }
        $ids = array_column($result, 'linkId');
        if (count(array_unique($ids)) !== count($ids)) {
            throw new LinkException('Hay enlaces repetidos.', 422);
        }
        $count = DB::table('links')->where('workspace_id', $workspace)->whereIn('id', $ids)->whereNull('deleted_at')->whereNotIn('state', ['deleted', 'blocked'])->orderBy('id')->sharedLock()->get(['id']);
        if ($count->count() !== count($ids)) {
            throw new LinkException('Algún enlace no está disponible en este workspace.', 422);
        }

        return $result;
    }

    public static function available(object $row): bool
    {
        if ($row->revoked_at !== null || ($row->expires_at !== null && CarbonImmutable::parse($row->expires_at)->lte(now()))) {
            return false;
        }
        $selected = DB::table('analytics_report_links')->where('report_id', $row->id)->get(['link_id']);
        $ids = $selected->pluck('link_id')->all();
        $valid = DB::table('links')->where('workspace_id', $row->workspace_id)->whereIn('id', $ids)->whereNull('deleted_at')->whereNotIn('state', ['deleted', 'blocked'])->orderBy('id')->sharedLock()->get(['id']);

        return count($ids) > 0 && count($ids) === $valid->count();
    }

    /** @param list<array{linkId:int, label:string}>|null $items
     * @return array<string, mixed>
     */
    public static function present(object $row, ?array $items = null, ?bool $available = null): array
    {
        $links = $items ?? DB::table('analytics_report_links')->where('report_id', $row->id)->orderBy('link_id')->get()->map(fn ($l) => ['linkId' => (int) $l->link_id, 'label' => $l->public_label])->all();
        $state = $row->revoked_at !== null ? 'revoked' : ($row->expires_at !== null && CarbonImmutable::parse($row->expires_at)->lte(now()) ? 'expired' : (($available ?? self::available($row)) ? 'active' : 'needs_review'));
        $base = rtrim((string) (config('uvh.frontend_url') ?: config('app.url')), '/');

        return ['id' => (int) $row->id, 'publicId' => $row->public_id, 'version' => (int) $row->version, 'spec' => json_decode($row->spec, true, 32, JSON_THROW_ON_ERROR), 'links' => $links, 'passwordProtected' => $row->password_hash !== null, 'expiresAt' => $row->expires_at === null ? null : CarbonImmutable::parse($row->expires_at)->format('Y-m-d\TH:i:s.uP'), 'state' => $state, 'shareUrl' => $base.'/reports/'.$row->public_id.'#token='.UvhCrypto::decryptAtRest($row->secret_encrypted)];
    }

    /** @param Collection<int, object> $rows
     * @return list<array<string, mixed>>
     */
    public static function presentMany(Collection $rows, int $workspace): array
    {
        $references = DB::table('analytics_report_links')->whereIn('report_id', $rows->pluck('id'))->orderBy('link_id')->get();
        $valid = DB::table('links')->where('workspace_id', $workspace)->whereIn('id', $references->pluck('link_id')->unique())->whereNull('deleted_at')->whereNotIn('state', ['deleted', 'blocked'])->pluck('id')->mapWithKeys(fn ($id) => [(int) $id => true])->all();
        $grouped = $references->groupBy('report_id');

        return $rows->map(function ($row) use ($grouped, $valid): array {
            $items = ($grouped->get($row->id) ?? collect())->map(fn ($l) => ['linkId' => (int) $l->link_id, 'label' => $l->public_label])->all();
            $available = count($items) > 0;
            foreach ($items as $item) {
                if (! isset($valid[$item['linkId']])) {
                    $available = false;
                }
            }

            return self::present($row, $items, $available);
        })->values()->all();
    }

    /** @return array<string, mixed> */
    public static function mutate(Request $request, ?int $id, string $operation): array
    {
        self::enabled();
        $key = $request->header('Idempotency-Key');
        if (! Idempotency::validateKey($key)['ok']) {
            throw new LinkException('Falta una clave de idempotencia válida.', 422);
        }
        $allowed = $operation === 'save' ? ['spec', 'links', 'expiresAt', 'password', ...($id === null ? [] : ['version'])] : ['version'];
        if (array_diff(array_keys($request->all()), $allowed)) {
            throw new LinkException('La petición contiene campos no admitidos.', 422);
        }

        return DB::transaction(function () use ($request, $id, $operation, $key): array {
            $user = UvhRequest::user($request);
            $workspace = UvhRequest::workspaceId($request);
            $context = SecurityContext::lock($user, UvhRequest::sessionId($request), requireVerifiedEmail: true);
            if (! $context || ! WorkspaceAccess::getMembershipForContext($context, $workspace, 'admin')) {
                throw new LinkException('Solo los propietarios y administradores pueden publicar informes.', 403);
            }
            $scope = "analytics-reports:$workspace:$operation:".($id ?? 'new');
            $hashes = array_map(fn ($secret) => hash_hmac('sha256', $request->getContent(), hash_hmac('sha256', 'report-intent', $secret, true)), UvhCrypto::secrets());
            $oldHash = DB::table('idempotency_keys')->where('user_id', $user->id)->where('scope', $scope)->where('key', $key)->value('request_hash');
            $hash = is_string($oldHash) && in_array($oldHash, $hashes, true) ? $oldHash : $hashes[0];
            $begin = Idempotency::begin((int) $user->id, $scope, $key, $hash);
            if ($begin['state'] === 'replay') {
                return json_decode(UvhCrypto::decryptAtRest($begin['body']['encrypted']), true, 64, JSON_THROW_ON_ERROR);
            }
            if ($begin['state'] !== 'fresh') {
                throw new LinkException('Esta operación está en curso o la clave corresponde a otra petición.', 409);
            }
            $row = $id === null ? null : DB::table('analytics_reports')->where('workspace_id', $workspace)->where('id', $id)->lockForUpdate()->first();
            if ($id !== null && ! $row) {
                throw new LinkException('Informe no encontrado.', 404);
            }
            if ($row && $request->input('version') !== (int) $row->version) {
                throw new LinkException('El informe cambió. Recarga antes de continuar.', 409);
            }
            $values = ['updated_at' => now()];
            if ($row) {
                $values['version'] = (int) $row->version + 1;
                $values['access_version'] = (int) $row->access_version + 1;
            }
            if ($operation === 'save') {
                if ($row && $row->revoked_at !== null) {
                    throw new LinkException('Crea otro informe para sustituir uno revocado.', 409);
                }
                $spec = self::validateSpec($request->input('spec'));
                $links = self::validateLinks($request->input('links'), $workspace);
                $expires = $request->input('expiresAt', $row ? ($row->expires_at === null ? null : CarbonImmutable::parse($row->expires_at)->format('Y-m-d\TH:i:s.uP')) : now()->addDays(30)->toIso8601String());
                if ($expires !== null && (! is_string($expires) || ! IsoDate::parse($expires) || IsoDate::parse($expires)->lte(now()))) {
                    throw new LinkException('La caducidad debe ser una fecha futura o estar desactivada.', 422);
                }
                $values['expires_at'] = $expires;
                $values['spec'] = json_encode($spec, JSON_THROW_ON_ERROR);
                if ($request->exists('password')) {
                    $password = $request->input('password');
                    if ($password !== null && (! is_string($password) || ! PasswordStrength::isAcceptable($password))) {
                        throw new LinkException('Usa una contraseña segura de al menos 10 caracteres y hasta 72 bytes.', 422);
                    }
                    $values['password_hash'] = $password === null ? null : Hash::make($password);
                }
                if (! $row) {
                    if (DB::table('analytics_reports')->where('workspace_id', $workspace)->whereNull('revoked_at')->count() >= (int) config('sharing.max_reports', 50)) {
                        throw new LinkException('Has alcanzado el límite de informes. Revoca uno antes de crear otro.', 409);
                    }
                    $secret = Ids::base64urlEncode(random_bytes(32));
                    $values += ['workspace_id' => $workspace, 'created_by' => $user->id, 'public_id' => Str::uuid()->toString(), 'secret_digest' => hash('sha256', $secret), 'secret_encrypted' => UvhCrypto::encryptAtRest($secret), 'created_at' => now()];
                    $id = DB::table('analytics_reports')->insertGetId($values);
                } else {
                    DB::table('analytics_reports')->where('id', $id)->update($values);
                }
                DB::table('analytics_report_links')->where('report_id', $id)->delete();
                DB::table('analytics_report_links')->insert(array_map(fn ($l) => ['report_id' => $id, 'link_id' => $l['linkId'], 'public_label' => $l['label']], $links));
            } else {
                if ($operation === 'revoke') {
                    $values['revoked_at'] = now();
                } elseif ($operation === 'rotate') {
                    if ($row->revoked_at !== null) {
                        throw new LinkException('El informe está revocado.', 409);
                    }
                    $secret = Ids::base64urlEncode(random_bytes(32));
                    $values['secret_digest'] = hash('sha256', $secret);
                    $values['secret_encrypted'] = UvhCrypto::encryptAtRest($secret);
                }
                DB::table('analytics_reports')->where('id', $id)->update($values);
            }
            $body = ['report' => self::present(DB::table('analytics_reports')->where('id', $id)->first())];
            // Replay contains a recoverable sharing capability: encrypt the whole receipt.
            Idempotency::commit((int) $user->id, $scope, $key, $hash, 200, ['encrypted' => UvhCrypto::encryptAtRest(json_encode($body, JSON_THROW_ON_ERROR))], $begin['lease']);
            Audit::write((int) $user->id, 'analytics_report.'.$operation, 'analytics_report', $id, workspaceId: $workspace);

            return $body;
        });
    }
}
