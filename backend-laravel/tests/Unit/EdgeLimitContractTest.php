<?php

namespace Tests\Unit;

use PHPUnit\Framework\TestCase;
use Tests\Support\RepositoryRoot;

/**
 * Contract between the edge limiter and the two layers it sits between.
 *
 * The Nginx template is rendered by `envsubst`, which only replaces the variable
 * names it is told about (the `NGINX_ENVSUBST_FILTER` list). A `${NAME}` the
 * filter does not list survives into the configuration as a literal placeholder,
 * and the container then fails to start — or, worse for a limiter, starts with a
 * value nobody chose. Nothing was comparing the template with the two deployment
 * files, so this holds the three of them together.
 *
 * The second half is the property that makes the layer safe to enable at all:
 * it must never be the first to reject a client that Laravel would have
 * admitted. Its rates are therefore asserted against the Laravel limits covering
 * the same surface, instead of being trusted as "some large number".
 */
class EdgeLimitContractTest extends TestCase
{
    private const TEMPLATE = 'docker/nginx/uvh.conf.template';

    private const ENTRYPOINT = 'docker/nginx/production-entrypoint.sh';

    private const PRODUCTION_COMPOSE = 'docker-compose.production.yml';

    private const RELEASE_E2E_COMPOSE = 'docker-compose.release-e2e.yml';

    private const PRODUCTION_ENV = 'backend-laravel/.env.production.example';

    private const UVH_CONFIG = 'backend-laravel/config/uvh.php';

    /** Nginx substitutions the template asks for: `${NAME}` and `$NAME` forms. */
    private function templateVariables(): array
    {
        preg_match_all('/\$\{([A-Z0-9_]+)\}/', RepositoryRoot::read(self::TEMPLATE), $matches);

        return array_values(array_unique($matches[1]));
    }

    /**
     * The envsubst filter is an anchored alternation of variable names.
     *
     * @return list<string>
     */
    private function envsubstFilter(string $composeFile): array
    {
        preg_match('/NGINX_ENVSUBST_FILTER: "([^"]+)"/', RepositoryRoot::read($composeFile), $matches);
        $this->assertNotSame('', $matches[1] ?? '', "{$composeFile} does not declare NGINX_ENVSUBST_FILTER");

        $filter = trim($matches[1], '^$');
        $this->assertStringStartsWith('(', $filter, 'the filter must stay anchored to whole names');
        $this->assertStringEndsWith(')', $filter, 'the filter must stay anchored to whole names');

        return explode('|', trim($filter, '()'));
    }

    /**
     * A whole-file read, or a failure that names the missing file: a contract
     * test that silently checks an empty string is worse than no test.
     *
     * The edge limiter is configured outside this application (Nginx template,
     * compose files, the shipped deployment file), so the contract needs the
     * repository root. CI checks out the whole repository and runs the suite
     * from `backend-laravel/`, which is the layout this expects; running the
     * tests against a copy of `backend-laravel/` alone cannot check it, and is
     * reported as such instead of passing silently.
     */
    private function envTemplateValue(string $key): string
    {
        preg_match('/^'.preg_quote($key, '/').'=(.*)$/m', RepositoryRoot::read(self::PRODUCTION_ENV), $matches);

        return trim($matches[1] ?? '');
    }

    public function test_every_variable_the_template_uses_is_substituted_by_both_deployments(): void
    {
        $variables = $this->templateVariables();
        $this->assertNotSame([], $variables);

        foreach ([self::PRODUCTION_COMPOSE, self::RELEASE_E2E_COMPOSE] as $composeFile) {
            $filter = $this->envsubstFilter($composeFile);
            foreach ($variables as $variable) {
                $this->assertContains(
                    $variable,
                    $filter,
                    "{$composeFile} does not pass {$variable} to the template: the container would start with the literal placeholder",
                );
            }
        }
    }

    public function test_the_template_defines_a_zone_for_each_public_surface(): void
    {
        $template = RepositoryRoot::read(self::TEMPLATE);

        foreach (['uvh_edge_public', 'uvh_edge_app', 'uvh_edge_conn'] as $zone) {
            $this->assertMatchesRegularExpression(
                '/^(limit_req_zone|limit_conn_zone) \$binary_remote_addr zone='.$zone.':/m',
                $template,
                "{$zone} is not keyed on the client address",
            );
        }

        $this->assertStringContainsString('limit_req_status 429;', $template);
        $this->assertStringContainsString('limit_conn_status 429;', $template);

        // The public host and the catch-all block serve the same anonymous
        // surface: the landing page, alias resolution and the customer domains
        // Caddy authorises. A zone covering only the named hosts would leave the
        // redirects that actually matter unprotected.
        $this->assertSame(
            2,
            substr_count($template, 'limit_req zone=uvh_edge_public'),
            'the public host and the custom-domain catch-all must both carry the public zone',
        );

        // Inside the panel only the API surfaces are capped: a page load fires
        // several calls, and the static shell is not the risk.
        $this->assertSame(2, substr_count($template, 'limit_req zone=uvh_edge_app'));
        $this->assertStringNotContainsString('limit_req zone=uvh_edge_app burst=${EDGE_BURST} nodelay;\n    }\n    location = /health', $template);
    }

    public function test_a_rejection_is_attributable_and_never_rewrites_laravels_own_answer(): void
    {
        $template = RepositoryRoot::read(self::TEMPLATE);

        // Retry-After only on this layer's rejections, and only there: the map
        // value is empty for every other outcome, so an admitted request and
        // Laravel's own 429 gain no header they never promised.
        $this->assertMatchesRegularExpression('/map \$limit_req_status \$uvh_edge_retry_after \{\s*REJECTED 60;\s*default\s+"";\s*\}/', $template);
        $this->assertSame(3, substr_count($template, 'add_header Retry-After $uvh_edge_retry_after always;'));

        // `$limit_req_status` in the access log is what attributes a 429 to this
        // layer instead of to Laravel, and `$limit_conn_status` which of the two
        // limiters answered.
        $this->assertMatchesRegularExpression('/log_format uvh_edge .*\$limit_req_status/m', $template);
        $this->assertMatchesRegularExpression('/log_format uvh_edge .*\$limit_conn_status/m', $template);
        $this->assertMatchesRegularExpression('/^\s*access_log \S+ uvh_edge;/m', $template);

        // Intercepting 429 with `error_page` would discard the JSON body of
        // Laravel's own throttled responses (uvh-resolve, uvh-report, ...) and
        // present them as edge volume. The two must stay distinguishable.
        $this->assertStringNotContainsString('error_page 429', $template);
    }

    /**
     * The Laravel limits that cover the same surfaces, per client and per minute.
     *
     * @return array<string, int>
     */
    private function laravelPerMinuteLimits(): array
    {
        $config = RepositoryRoot::read(self::UVH_CONFIG);
        $limits = [];
        foreach (['auth', 'register', 'link_create', 'resolve', 'api_token'] as $key) {
            preg_match("/'".preg_quote($key, '/')."' => \(int\) env\('[A-Z_]+', (\d+)\)/", $config, $matches);
            $this->assertNotSame('', $matches[1] ?? '', "config/uvh.php no longer declares rate_limits.{$key} with a default");
            $limits[$key] = (int) $matches[1];
        }

        // A deployment may raise its own limits; the edge has to stay above the
        // values that deployment actually uses, not only above the defaults.
        foreach (['AUTH_LIMIT', 'REGISTER_LIMIT', 'LINK_CREATE_LIMIT', 'RESOLVE_LIMIT', 'API_TOKEN_LIMIT'] as $key) {
            $value = $this->envTemplateValue($key);
            if ($value !== '' && ctype_digit($value)) {
                $limits[strtolower(str_replace('_LIMIT', '', $key))] = (int) $value;
            }
        }

        return $limits;
    }

    public function test_the_edge_stays_looser_than_the_laravel_limit_it_shadows(): void
    {
        $limits = $this->laravelPerMinuteLimits();
        $strictest = max($limits);
        $this->assertGreaterThan(0, $strictest);

        foreach (['EDGE_PUBLIC_RATE', 'EDGE_APP_RATE'] as $key) {
            $value = $this->envTemplateValue($key);
            $this->assertMatchesRegularExpression('/^\d+r\/s$/', $value, "{$key} must be a literal rate such as 20r/s, got '{$value}'");

            $perMinute = (int) rtrim($value, 'r/s') * 60;
            $this->assertGreaterThanOrEqual(
                2 * $strictest,
                $perMinute,
                sprintf(
                    '%s allows %d requests per minute per client, below twice Laravel\'s strictest per-client allowance (%d). '
                    .'This layer must never be the first to reject a client Laravel would have admitted.',
                    $key,
                    $perMinute,
                    $strictest,
                ),
            );
        }

        $this->assertMatchesRegularExpression('/^\d+$/', $this->envTemplateValue('EDGE_BURST'));
        $this->assertMatchesRegularExpression('/^\d+$/', $this->envTemplateValue('EDGE_CONN'));
        $this->assertContains($this->envTemplateValue('EDGE_DRY_RUN'), ['on', 'off']);
    }

    public function test_the_client_address_is_restored_from_the_same_list_laravel_trusts(): void
    {
        $entrypoint = RepositoryRoot::read(self::ENTRYPOINT);

        // Keying the zones on the peer address would put the proxy container's
        // address in every bucket, which is a limiter that limits nothing.
        $this->assertStringContainsString('set_real_ip_from', $entrypoint);
        $this->assertStringContainsString('TRUSTED_PROXIES', $entrypoint);
        $this->assertStringContainsString('real_ip_recursive on;', $entrypoint);
        $this->assertStringContainsString('real_ip_header X-Forwarded-For;', $entrypoint);

        // The value is refuse-on-doubt: a wildcard or a hostname here would
        // silently widen who is allowed to set the client address.
        $this->assertStringContainsString('*/0|0.0.0.0/0|::/0', $entrypoint);
        $this->assertStringContainsString('is not a concrete address or CIDR', $entrypoint);

        // And the list has to exist in the shipped deployment file, or Nginx
        // starts with every client sharing one bucket.
        $proxies = $this->envTemplateValue('TRUSTED_PROXIES');
        $this->assertNotSame('', $proxies);
        foreach (explode(',', $proxies) as $proxy) {
            $this->assertMatchesRegularExpression('#^[0-9a-fA-F:.]+(/\d{1,3})?$#', $proxy);
            $this->assertStringNotContainsString('/0', $proxy);
        }
    }

    public function test_the_edge_runs_on_the_production_image_with_its_own_deployment_file(): void
    {
        $compose = RepositoryRoot::read(self::PRODUCTION_COMPOSE);

        // The production Nginx reads its tuning from the deployment file, so a
        // value set there has to win over the entrypoint defaults rather than be
        // overwritten by a compose-level default.
        $this->assertMatchesRegularExpression(
            '/nginx:.*env_file:\s*\n\s*- \$\{UVH_ENV_FILE:-\.\/backend-laravel\/\.env\.production\}/s',
            $compose,
        );
        $this->assertStringNotContainsString('EDGE_PUBLIC_RATE:', $compose);
        $this->assertStringContainsString('EDGE_DRY_RUN', $compose);

        // The switch exists so a first deployment can be observed with the
        // rejection disabled, and it has to reach both limiters: measured on the
        // production image, `limit_req_dry_run` alone turned the request limiter
        // off while the connection cap kept answering 429 — a deployment that
        // believed it had disabled rejection and had not.
        $template = RepositoryRoot::read(self::TEMPLATE);
        $this->assertSame(
            substr_count($template, 'limit_conn uvh_edge_conn'),
            substr_count($template, 'limit_conn_dry_run ${EDGE_DRY_RUN};'),
            'every limit_conn needs its own dry run, or EDGE_DRY_RUN is not a kill switch',
        );
        $this->assertSame(
            substr_count($template, 'limit_req zone='),
            substr_count($template, 'limit_req_dry_run ${EDGE_DRY_RUN};'),
            'every limit_req needs its own dry run',
        );
        $this->assertStringContainsString('complete kill switch, and it is also a measurement', $template);
        // The claim that a dry run cannot be measured was wrong on the pinned
        // image, and a deployment plan built on it would have skipped the run
        // that sizes the limit. The template must not carry it again.
        $this->assertStringNotContainsString('kill switch, not a measurement', $template);
        $this->assertStringContainsString('REJECTED_DRY_RUN', $template);
    }
}
