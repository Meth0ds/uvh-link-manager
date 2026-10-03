<?php

namespace App\Support;

/** Authentication admitted by middleware no longer authorizes this mutation. */
final class StaleSecurityContext extends \RuntimeException {}
