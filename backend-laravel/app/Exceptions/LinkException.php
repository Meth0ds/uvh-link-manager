<?php

namespace App\Exceptions;

class LinkException extends \RuntimeException
{
    public function __construct(
        string $message,
        public int $status = 400,
    ) {
        parent::__construct($message);
    }
}
