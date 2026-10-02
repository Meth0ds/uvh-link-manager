<?php

namespace App\Support;

/** Typed admission failure so the public recovery request stays non-enumerating. */
final class AccountRecoveryAdmissionException extends \RuntimeException {}
