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

    public function test_csrf_endpoint_issues_token(): void
    {
        $response = $this->get('/api/v1/csrf');

        $response->assertStatus(200);
        $response->assertJsonStructure(['csrfToken']);
    }
}
