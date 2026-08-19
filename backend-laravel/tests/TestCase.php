<?php

namespace Tests;

use Illuminate\Foundation\Testing\TestCase as BaseTestCase;

abstract class TestCase extends BaseTestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        // El `environment:` del Compose local pisa las variables del contenedor
        // ANTES de que PHPUnit pueda aplicarlas, y env() prioriza $_ENV (que
        // Dotenv puebla desde .env al arrancar el framework). Forzar el driver
        // síncrono en memoria hace que los jobs se ejecuten inline en tests.
        config(['queue.default' => 'sync']);
    }
}
