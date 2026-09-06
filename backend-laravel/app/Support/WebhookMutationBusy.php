<?php

namespace App\Support;

/** Internal control-flow signal used to roll back a multi-webhook mutation. */
class WebhookMutationBusy extends \RuntimeException {}
