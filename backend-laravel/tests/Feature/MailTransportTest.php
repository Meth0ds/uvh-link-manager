<?php

namespace Tests\Feature;

use App\Support\UvhMail;
use Illuminate\Mail\Events\MessageSending;
use Illuminate\Mail\Mailer;
use Illuminate\Mail\Transport\ArrayTransport;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

final class MailTransportTest extends TestCase
{
    private ArrayTransport $transport;

    protected function setUp(): void
    {
        parent::setUp();
        config([
            'mail.driver' => null,
            'mail.default' => 'delivery-fixture',
            'mail.mailers.delivery-fixture' => ['transport' => 'smtp'],
        ]);

        // Exercise Laravel's actual rendering, events and SentMessage result,
        // replacing only its network transport. No provider receives mail.
        $this->transport = new ArrayTransport;
        $mailer = new Mailer('delivery-fixture', $this->app['view'], $this->transport, $this->app['events']);
        $mailer->alwaysFrom('sender@example.test');
        Mail::swap($mailer);
    }

    public function test_accepted_message_preserves_html_and_plain_text_parts(): void
    {
        $this->assertTrue(UvhMail::sendNow('recipient@example.test', 'Fixture', '<p>Hola</p>', 'Hola en texto'));
        $this->assertCount(1, $this->transport->messages());
        $message = $this->transport->messages()->first()->getOriginalMessage();
        $this->assertSame('<p>Hola</p>', $message->getHtmlBody());
        $this->assertSame('Hola en texto', $message->getTextBody());
    }

    public function test_cancelled_message_is_not_reported_as_accepted(): void
    {
        Event::listen(MessageSending::class, static fn () => false);

        $this->assertFalse(UvhMail::sendNow('recipient@example.test', 'Fixture', '<p>Hola</p>', 'Hola'));
        $this->assertCount(0, $this->transport->messages());
    }

    public function test_log_fallback_is_rejected_before_invoking_the_mailer(): void
    {
        config([
            'mail.default' => 'fallback-fixture',
            'mail.mailers.fallback-fixture' => ['transport' => 'failover', 'mailers' => ['delivery-fixture', 'log']],
            'mail.mailers.log' => ['transport' => 'log'],
        ]);

        $this->assertFalse(UvhMail::sendNow('recipient@example.test', 'Fixture', '<p>Hola</p>', 'Hola'));
        $this->assertCount(0, $this->transport->messages());
    }

    public function test_development_transport_does_not_acknowledge_mail_in_production(): void
    {
        config(['mail.default' => 'log', 'mail.mailers.log' => ['transport' => 'log']]);
        $this->assertTrue(UvhMail::sendNow('recipient@example.test', 'Fixture', '<p>Hola</p>', 'Hola'));
        $this->app->instance('env', 'production');

        $this->assertFalse(UvhMail::sendNow('recipient@example.test', 'Fixture', '<p>Hola</p>', 'Hola'));
        $this->assertCount(0, $this->transport->messages());
    }
}
