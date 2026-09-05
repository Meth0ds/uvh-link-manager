<?php

namespace App\Support;

final class InvitationBudgetExceeded extends \RuntimeException
{
    public function __construct(public readonly int $retryAfter)
    {
        parent::__construct('Invitation mail admission budget exceeded');
    }
}
