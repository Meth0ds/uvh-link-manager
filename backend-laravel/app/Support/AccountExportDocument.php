<?php

namespace App\Support;

use App\Models\LegalAcceptance;
use Illuminate\Support\Facades\DB;

/**
 * El documento de «Descarga de cuenta»: JSON construido por fragmentos, con la
 * memoria acotada sea cual sea el tamaño de la cuenta.
 *
 * El documento se arma en dos pasadas sobre spools en disco, nunca en memoria:
 *
 *  1. **Recogida** (`collecting`, y `analytics` para los rollups): cada sección
 *     se recorre con cursor dentro de UNA transacción `REPEATABLE READ READ
 *     ONLY` —todas las secciones comparten snapshot, como cuando el documento
 *     cabía entero en memoria— y cada fila se serializa a su propio fragmento
 *     NDJSON en el disco temporal del sistema.
 *  2. **Codificación** (`encoding`): los fragmentos se copian al documento
 *     final en el orden del formato, envueltos en su estructura. La analítica
 *     se recorre la última —es la cola larga— pero se emite donde el formato la
 *     pone, porque la emisión ordena y la recogida no.
 *
 * El techo `maxPlaintextBytes()` se cuenta sobre el texto plano ya codificado:
 * protege el volumen y el worker, no al usuario. Al superarlo se lanza
 * `ExportTooLarge` y la solicitud termina con `automated_size_limit`, que es la
 * señal para el camino gestionado de derechos.
 *
 * Formato del documento (`uvh-account-export-v1`): misma forma de siempre, con
 * cada fila de colección compacta en su propia línea dentro del array —más
 * legible para un humano que el pretty-print total, y el formato que la
 * codificación por fragmentos produce sin volver a serializar.
 */
final class AccountExportDocument
{
    public const FORMAT = 'uvh-account-export-v1';

    /** Secciones en el orden del documento; el nombre es la clave del JSON. */
    private const SECTIONS = [
        'memberships',
        'createdLinks',
        'redirectRules',
        'linkTags',
        'aggregateAnalytics',
        'apiTokenMetadata',
        'ownedWorkspaceDomains',
        'ownedWorkspaceWebhooks',
        'accountAuditTrail',
        'privacyRightsRequests',
        'privacyRightsMessages',
        'legalAcceptances',
    ];

    /**
     * Techo operativo del documento de texto plano (256 MiB). Sólo existe para
     * que una cuenta desmedida no llene el volumen privado ni agote el worker;
     * no se ofrece como límite del producto y no es configurable a la baja por
     * operador: `config/uvh.php` lo clampa.
     */
    public const MAX_PLAINTEXT_BYTES = 256 * 1024 * 1024;

    /**
     * Escribe el documento completo en `$out` y devuelve sus bytes de texto
     * plano. `$onPhase` recibe cada fase en orden: `collecting`, `analytics`,
     * `encoding` —el que llama la traduce a su propia superficie de progreso.
     *
     * @param  resource  $out
     * @param  null|callable(string): void  $onPhase
     */
    public static function render(int $userId, $out, ?callable $onPhase = null): int
    {
        $fragments = self::openFragments();
        try {
            if ($onPhase !== null) {
                $onPhase('collecting');
            }
            self::spoolRows($userId, $fragments, $onPhase);
            if ($onPhase !== null) {
                $onPhase('encoding');
            }

            return self::writeDocument($fragments, $out);
        } finally {
            self::closeFragments($fragments);
        }
    }

    /** El techo efectivo: configurado por despliegue, nunca por debajo de 1 KiB. */
    public static function maxPlaintextBytes(): int
    {
        return max(1024, (int) config('uvh.export_max_plaintext_bytes', self::MAX_PLAINTEXT_BYTES));
    }

    /**
     * Recogida por cursor de todas las secciones, cada fila a su fragmento.
     * El techo se cuenta aquí y también en la codificación: se corta en cuanto
     * se sabe, no al final del recorrido.
     *
     * @param  array<string, resource>  $fragments
     * @param  null|callable(string): void  $onPhase
     */
    private static function spoolRows(int $userId, array $fragments, ?callable $onPhase = null): void
    {
        $bytes = 0;
        $limit = self::maxPlaintextBytes();
        $write = static function (string $section, array|object $row) use ($fragments, &$bytes, $limit): void {
            $line = json_encode($row, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)."\n";
            $bytes += strlen($line);
            if ($bytes > $limit) {
                throw new ExportTooLarge('La exportación automática supera su techo operativo');
            }
            Streams::writeAll($fragments[$section], $line);
        };

        DB::transaction(function () use ($userId, $write, $onPhase): void {
            DB::statement('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');

            $account = DB::table('users')->where('id', $userId)->first([
                'id', 'email', 'name', 'email_verified_at', 'mfa_enabled', 'created_at', 'updated_at',
            ]);
            $write('account', $account ?? (object) []);

            foreach (self::rowSources($userId) as $section => $rows) {
                foreach ($rows() as $row) {
                    $write($section, $row);
                }
            }

            // La analítica se recorre la última: es la cola larga de cualquier
            // cuenta con historia, y así `analytics` es una fase propia y no un
            // intermedio dentro de `collecting`. La etapa se anuncia con la
            // sesión lateral del que llama: dentro del snapshot de sólo lectura
            // no cabe ninguna escritura.
            if ($onPhase !== null) {
                $onPhase('analytics');
            }
            foreach (self::analyticsRows($userId) as $row) {
                $write('aggregateAnalytics', $row);
            }
        });
    }

    /**
     * Secciones de filas por cursor, en el orden de recogida (sin analítica).
     * Cada entrada es un iterable perezoso: el cursor se abre al recorrerla,
     * no al montar la lista, para no sostener doce declaraciones abiertas a la
     * vez dentro del snapshot.
     *
     * @return array<string, callable(): iterable<int, object|array<string, mixed>>>
     */
    private static function rowSources(int $userId): array
    {
        return [
            'memberships' => static fn (): iterable => DB::table('memberships')
                ->join('workspaces', 'workspaces.id', '=', 'memberships.workspace_id')
                ->where('memberships.user_id', $userId)
                ->orderBy('memberships.id')
                ->select([
                    'memberships.workspace_id', 'workspaces.name as workspace_name', 'workspaces.slug as workspace_slug',
                    'memberships.role', 'memberships.created_at',
                ])->cursor(),
            'createdLinks' => static fn (): iterable => DB::table('links')->where('created_by', $userId)->orderBy('id')
                ->select([
                    'id', 'workspace_id', 'domain_id', 'alias', 'destination', 'fallback_destination', 'state',
                    'max_clicks', 'click_count', 'single_use', 'used_at', 'scheduled_at', 'expires_at', 'notes',
                    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'created_at', 'updated_at', 'deleted_at',
                ])->cursor(),
            'redirectRules' => static fn (): iterable => DB::table('redirect_rules')
                ->join('links', 'links.id', '=', 'redirect_rules.link_id')
                ->where('links.created_by', $userId)
                ->orderBy('redirect_rules.id')
                ->select([
                    'redirect_rules.id', 'redirect_rules.link_id', 'redirect_rules.priority', 'redirect_rules.country',
                    'redirect_rules.language', 'redirect_rules.device', 'redirect_rules.os', 'redirect_rules.time_from',
                    'redirect_rules.time_to', 'redirect_rules.referrer', 'redirect_rules.campaign',
                    'redirect_rules.destination', 'redirect_rules.created_at',
                ])->cursor(),
            'linkTags' => static fn (): iterable => DB::table('link_tags')
                ->join('links', 'links.id', '=', 'link_tags.link_id')
                ->join('tags', 'tags.id', '=', 'link_tags.tag_id')
                ->where('links.created_by', $userId)
                ->orderBy('link_tags.link_id')->orderBy('tags.id')
                ->select(['link_tags.link_id', 'tags.name'])->cursor(),
            'apiTokenMetadata' => static fn (): iterable => DB::table('api_tokens')->where('created_by', $userId)->orderBy('id')
                ->select([
                    'id', 'workspace_id', 'name', 'scopes', 'last_used_at', 'expires_at', 'revoked_at', 'created_at',
                ])->cursor(),
            'ownedWorkspaceDomains' => static fn (): iterable => DB::table('custom_domains')
                ->join('workspaces', 'workspaces.id', '=', 'custom_domains.workspace_id')
                ->where('workspaces.owner_user_id', $userId)
                ->orderBy('custom_domains.id')
                ->select([
                    'custom_domains.id', 'custom_domains.workspace_id', 'custom_domains.domain', 'custom_domains.state',
                    'custom_domains.verified_at', 'custom_domains.created_at', 'custom_domains.updated_at',
                ])->cursor(),
            'ownedWorkspaceWebhooks' => static fn (): iterable => self::webhookRows($userId),
            'accountAuditTrail' => static fn (): iterable => DB::table('audit_events')->where('user_id', $userId)->orderBy('id')
                ->select(['id', 'action', 'resource_type', 'resource_id', 'created_at'])->cursor(),
            'privacyRightsRequests' => static fn (): iterable => DB::table('privacy_rights_requests')->where('user_id', $userId)->orderBy('id')
                ->select([
                    'id', 'type', 'status', 'identity_verified_at', 'acknowledged_at', 'due_at',
                    'extended_until', 'extension_reason_code', 'completed_at', 'cancelled_at',
                    'created_at', 'updated_at',
                ])->cursor(),
            'privacyRightsMessages' => static fn (): iterable => self::privacyMessageRows($userId),
            'legalAcceptances' => static fn (): iterable => self::legalAcceptanceRows($userId),
        ];
    }

    /** @return iterable<int, object> */
    private static function analyticsRows(int $userId): iterable
    {
        return DB::table('metric_rollups')
            ->join('links', 'links.id', '=', 'metric_rollups.link_id')
            ->where('links.created_by', $userId)
            ->orderBy('metric_rollups.day')->orderBy('metric_rollups.link_id')
            ->select([
                'metric_rollups.link_id', 'metric_rollups.day', 'metric_rollups.clicks', 'metric_rollups.visitors',
                'metric_rollups.countries', 'metric_rollups.devices', 'metric_rollups.browsers',
                'metric_rollups.os', 'metric_rollups.referrers', 'metric_rollups.campaigns',
            ])->cursor();
    }

    /**
     * La URL de un webhook sale sin credenciales ni query, y lo que se retiró
     * queda dicho (`urlCredentialsOrQueryRedacted`) sin reproducirlo.
     *
     * @return iterable<int, object>
     */
    private static function webhookRows(int $userId): iterable
    {
        $rows = DB::table('webhooks')
            ->join('workspaces', 'workspaces.id', '=', 'webhooks.workspace_id')
            ->where('workspaces.owner_user_id', $userId)
            ->orderBy('webhooks.id')
            ->select([
                'webhooks.id', 'webhooks.workspace_id', 'webhooks.url', 'webhooks.events',
                'webhooks.active', 'webhooks.created_at', 'webhooks.updated_at',
            ])->cursor();

        foreach ($rows as $webhook) {
            $parts = parse_url((string) $webhook->url);
            $hadSensitiveUrlParts = is_array($parts) && (isset($parts['query']) || isset($parts['user']) || isset($parts['pass']));
            $host = is_array($parts) ? ($parts['host'] ?? null) : null;
            if (is_string($host) && filter_var($host, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6)) {
                $host = '['.$host.']';
            }
            $webhook->url = is_array($parts) && isset($parts['scheme'], $parts['host'])
                ? $parts['scheme'].'://'.$host.(isset($parts['port']) ? ':'.$parts['port'] : '').($parts['path'] ?? '/')
                : null;
            $webhook->urlCredentialsOrQueryRedacted = $hadSensitiveUrlParts;

            yield $webhook;
        }
    }

    /**
     * Los mensajes de expedientes salen descifrados, y un cuerpo irrecuperable
     * conserva su cronología con la marca explícita `bodyUnavailable` en vez de
     * filtrar ciphertext o tumbar el resto del documento.
     *
     * @return iterable<int, object>
     */
    private static function privacyMessageRows(int $userId): iterable
    {
        $rows = DB::table('privacy_rights_messages as m')
            ->join('privacy_rights_requests as r', 'r.id', '=', 'm.request_id')
            ->where('r.user_id', $userId)
            ->orderBy('m.request_id')->orderBy('m.created_at')->orderBy('m.id')
            ->select(['m.id', 'm.request_id', 'm.author_role', 'm.encrypted_body', 'm.created_at'])->cursor();

        foreach ($rows as $message) {
            try {
                $message->body = UvhCrypto::decryptAtRest((string) $message->encrypted_body);
                $message->bodyUnavailable = false;
            } catch (\Throwable) {
                $message->body = null;
                $message->bodyUnavailable = true;
                OperationalMetrics::increment('privacy.decrypt_failed');
            }
            unset($message->encrypted_body);

            yield $message;
        }
    }

    /**
     * El documento emite el timestamp almacenado tal cual: se exportan los
     * atributos crudos para que mover la consulta al modelo no cambie el
     * formato de `accepted_at` sin que nadie lo note.
     *
     * @return iterable<int, array<string, mixed>>
     */
    private static function legalAcceptanceRows(int $userId): iterable
    {
        foreach (LegalAcceptance::where('user_id', $userId)
            ->orderBy('accepted_at')->orderBy('id')
            ->cursor() as $row) {
            yield $row->getAttributes();
        }
    }

    /**
     * Copia los fragmentos al documento final en el orden del formato. Las
     * filas van compactas, una por línea —se copian sin re-serializar—; la
     * estructura, con sangría.
     *
     * @param  array<string, resource>  $fragments
     * @param  resource  $out
     */
    private static function writeDocument(array $fragments, $out): int
    {
        $limit = self::maxPlaintextBytes();
        $bytes = 0;
        $put = static function (string $text) use ($out, &$bytes, $limit): void {
            $bytes += strlen($text);
            if ($bytes > $limit) {
                throw new ExportTooLarge('La exportación automática supera su techo operativo');
            }
            Streams::writeAll($out, $text);
        };

        $put("{\n");
        $put('    "format": '.json_encode(self::FORMAT, JSON_UNESCAPED_SLASHES).",\n");
        $put('    "generatedAt": '.json_encode(now()->toIso8601String(), JSON_UNESCAPED_SLASHES).",\n");
        $put('    "scope": '.self::encode(self::scope()).",\n");
        $put('    "rights": '.self::encode(self::rights()).",\n");
        $put('    "account": '.self::firstLine($fragments['account']).",\n");

        foreach (self::SECTIONS as $section) {
            $put('    '.json_encode($section, JSON_UNESCAPED_SLASHES).": [\n");
            self::copyRows($fragments[$section], $put);
            $put('    ]'.($section === 'legalAcceptances' ? '' : ',')."\n");

            if ($section === 'aggregateAnalytics') {
                $put('    "aggregateAnalyticsDefinition": '.self::encode(self::analyticsDefinition()).",\n");
            }
        }

        $put("}\n");

        return $bytes;
    }

    /**
     * Copia las filas de un fragmento con su coma final, una por línea, con una
     * sola línea viva en memoria: la que se está escribiendo.
     *
     * @param  resource  $fragment
     * @param  callable(string): void  $put
     */
    private static function copyRows($fragment, callable $put): void
    {
        rewind($fragment);
        $pending = null;
        while (($line = fgets($fragment)) !== false) {
            $line = rtrim($line, "\n");
            if (trim($line) === '') {
                continue;
            }
            if ($pending !== null) {
                $put('        '.$pending.",\n");
            }
            $pending = $line;
        }
        if ($pending !== null) {
            $put('        '.$pending."\n");
        }
    }

    /** @return list<string> */
    private static function scope(): array
    {
        return [
            'account data and memberships',
            'links created by the account, including rules, tags and aggregate analytics',
            'API token metadata without token hashes or bearer secrets',
            'domain and webhook configuration for owned workspaces without verification/signing secrets',
            'account audit action metadata without IP-derived identifiers',
            'privacy-rights cases and messages addressed to this account without staff identifiers',
            'legal document versions accepted or acknowledged by this account',
        ];
    }

    /**
     * La separación contractual que el documento declara sobre sí mismo: esto
     * es la copia de acceso de la cuenta; los derechos formales de los
     * artículos 15 y 20 RGPD se ejercen por el flujo de expedientes, con
     * identidad proporcional y plazo legal.
     *
     * @return array<string, string>
     */
    private static function rights(): array
    {
        return [
            'document' => 'account_access_copy',
            'note' => 'Self-service account access copy (art. 15 GDPR). Formal access and portability rights (art. 15 and 20 GDPR) are filed, tracked and answered through the privacy-rights workflow, with identity checks and legal deadlines.',
        ];
    }

    /** @return array<string, mixed> */
    private static function analyticsDefinition(): array
    {
        return [
            // A rollup visitor is a daily rotating pseudonym. The same
            // browser may appear once on each day and is never claimed as
            // a unique person across the exported period.
            'visitors' => 'distinct_daily_pseudonyms',
            'crossDayIdentity' => false,
        ];
    }

    private static function encode(mixed $value): string
    {
        return json_encode($value, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    }

    /** @param resource $fragment */
    private static function firstLine($fragment): string
    {
        rewind($fragment);
        while (($line = fgets($fragment)) !== false) {
            $line = rtrim($line, "\n");
            if (trim($line) !== '') {
                return $line;
            }
        }

        return 'null';
    }

    /** @return array<string, resource> */
    private static function openFragments(): array
    {
        $fragments = ['account' => fopen('php://temp/maxmemory:2097152', 'r+b')];
        foreach (self::SECTIONS as $section) {
            $fragments[$section] = fopen('php://temp/maxmemory:2097152', 'r+b');
        }

        return $fragments;
    }

    /** @param array<string, resource> $fragments */
    private static function closeFragments(array $fragments): void
    {
        foreach ($fragments as $fragment) {
            if (is_resource($fragment)) {
                fclose($fragment);
            }
        }
    }
}
