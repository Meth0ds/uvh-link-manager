<?php

namespace App\Support\Auth;

use RuntimeException;

/** Roll back the step-up and retain the previous reservation on conflict. */
final class EmailChangeReservationConflict extends RuntimeException {}
