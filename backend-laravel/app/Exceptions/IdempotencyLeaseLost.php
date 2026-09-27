<?php

namespace App\Exceptions;

final class IdempotencyLeaseLost extends LinkException
{
    public function __construct()
    {
        parent::__construct('La operación ha sido retomada por otro intento. Reintenta con la misma clave.', 409);
    }
}
