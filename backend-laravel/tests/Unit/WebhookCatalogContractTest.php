<?php

namespace Tests\Unit;

use App\Support\WebhookEvents;
use PHPUnit\Framework\Attributes\Test;
use Tests\Support\RepositoryRoot;
use Tests\TestCase;

/**
 * The webhook event catalog is one per side of the wire and this test pins the
 * copies together: the backend catalog is the source of truth, and the panel's
 * picker, the response decoder and the API documentation must all name exactly
 * the same events. Without this, an event could exist in the producer while
 * `POST /webhooks` rejects subscriptions to it — the gap the catalog was
 * created to close.
 */
final class WebhookCatalogContractTest extends TestCase
{
    private const FRONTEND_PICKER = 'frontend/src/app/panel/webhooks/webhooks.component.ts';

    private const FRONTEND_DECODER = 'frontend/src/app/core/services/credential-response-decoders.ts';

    private const API_DOC = 'docs/api.md';

    /** The frozen contract: order included. */
    private const EXPECTED = [
        'link.created',
        'link.updated',
        'link.deleted',
        'link.threshold_reached',
        'domain.claimed',
        'domain.claim_transferred',
        'domain.verified',
        'domain.degraded',
        'domain.offline',
        'domain.recovered',
        'domain.activated',
        'domain.disabled',
        'domain.tls_failed',
        'domain.tls_expiring',
        'domain.deleted',
    ];

    #[Test]
    public function the_backend_catalog_is_frozen(): void
    {
        $this->assertSame(self::EXPECTED, WebhookEvents::all());
    }

    #[Test]
    public function every_catalog_event_declares_a_projection(): void
    {
        foreach (WebhookEvents::all() as $event) {
            $this->assertNotSame([], WebhookEvents::projection($event), "El evento {$event} debe declarar su proyección pública");
        }
    }

    #[Test]
    public function the_panel_offers_exactly_the_catalog(): void
    {
        $this->assertSame(self::EXPECTED, $this->eventsListedIn(self::FRONTEND_PICKER, 'EVENTS'));
    }

    #[Test]
    public function the_decoder_accepts_exactly_the_catalog(): void
    {
        $this->assertSame(self::EXPECTED, $this->eventsListedIn(self::FRONTEND_DECODER, 'WEBHOOK_EVENTS'));
    }

    #[Test]
    public function the_api_documentation_names_every_event(): void
    {
        $docs = RepositoryRoot::read(self::API_DOC);
        foreach (self::EXPECTED as $event) {
            $this->assertStringContainsString(
                '`'.$event.'`',
                $docs,
                "docs/api.md debe documentar el evento {$event}",
            );
        }
    }

    /** @return list<string> */
    private function eventsListedIn(string $file, string $constant): array
    {
        $contents = RepositoryRoot::read($file);
        $pattern = '/const '.$constant.' = (?:new Set\()?(\[[^\]]*\])/s';
        $this->assertSame(
            1,
            preg_match($pattern, $contents, $matches),
            "{$file} debe declarar {$constant} como lista literal para que el contrato pueda leerla",
        );
        preg_match_all('/"([a-z_.]+)"/', $matches[1], $names);

        return $names[1];
    }
}
