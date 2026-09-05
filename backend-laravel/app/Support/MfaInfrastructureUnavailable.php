<?php

namespace App\Support;

/** Fail closed without presenting a cache outage as an invalid user factor. */
final class MfaInfrastructureUnavailable extends \RuntimeException
{
}
