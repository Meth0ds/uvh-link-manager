<?php

namespace App\Support;

/**
 * El documento de una exportación automática supera su techo operativo.
 *
 * No es un límite de producto —las cuentas grandes dejan de estar vetadas del
 * camino automático— sino el suelo que protege el volumen privado y el worker
 * compartido de un documento desmedido. El camino gestionado de derechos
 * (expedientes RGPD) sigue existiendo para lo que de verdad no cabe.
 */
final class ExportTooLarge extends \RuntimeException {}
