<?php

namespace Tests\Feature;

use Tests\TestCase;

class ExampleTest extends TestCase
{
    public function test_health_endpoint_responds(): void
    {
        $response = $this->get('/health');

        $response->assertStatus(200);
        $response->assertJson(['ok' => true, 'service' => 'uvh-api']);
    }

    public function test_health_on_the_public_host_answers_for_monitors(): void
    {
        $response = $this->get('http://uvh.es/health');

        $response->assertStatus(200);
        $response->assertJson(['ok' => true, 'service' => 'uvh-api']);
    }

    public function test_health_on_a_branded_host_carries_no_platform_branding(): void
    {
        // A customer's domain must not advertise the platform that serves it;
        // the TLS provisioner only needs the 2xx.
        $response = $this->get('http://shop.example.test/health');

        $response->assertStatus(204);
        $this->assertSame('', $response->getContent());
    }

    public function test_csrf_endpoint_issues_token(): void
    {
        $response = $this->get('/api/v1/csrf');

        $response->assertStatus(200);
        $response->assertJsonStructure(['csrfToken']);
    }
}
