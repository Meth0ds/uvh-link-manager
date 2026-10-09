# O86 — Resolución QR para descarga y pantallas densas

Ampliación solicitada por el usuario durante la optimización global: QR con más resolución. No desplegar ni usar DB/cuentas/proveedores/launchers; trabajar inline y conservar marca/contraste/quietzone4/correcciónH. Producto no se edita mientras procesos propios estén activos.

Contrato: vista previa de enlaces480px, misma caja240CSS; PNG descargado2048px generado sólo por clic, sin conservar canvas/dataURL de alta resolución en la vista ni regenerar la vista previa. MFA480px dentro de su misma caja188CSS. La biblioteca sigue diferida y compartida. No añadir SVG ni dependencias al producto para este lote.

El botón de descarga muestra tamaño/calidad y estado ocupado real. Admite un render por acción pendiente; revalida destroy antes y después de CPU y evita anchor/download tardío. Error de render/descarga controlado conserva la vista previa y permite reintento explícito, sin automatismos. Alias/nombre seguro conservado. Preservar borrador/manual key/contexto de MFA.

- [x] Caracterizar descarga2048 y su frontera de cierre/reintento/doble acción pendiente con pruebas; red comprobado antes de implementación. Adaptar la prueba de nombre a await de descarga real.
- [x] Implementar PNG bajo demanda/busy/errores/guard y MFA480; no almacenar la imagen2048 como estado compartido.
- [x] Dirigidas, suite completa/build/lint/tipos/diff. PNG nativo2048, mismo texto/marca y preview conservada480.
- [x] QA build propio/API ficticia: dos temas/tres tamaños, export de lista/detalle, MFA480, nombre seguro, import compartido/espera/fallos/contexto preservados. Decoder independiente sobre native/reducciones/rotación/datos largos, sin promesa de todos los dispositivos físicos.
- [x] Capturas, cerrar procesos, hashes y resultados; objetivo global continúa pendiente.

Evidencia O86:65 dirigidas/1.860 totales,build/lint/tipos/diff0.37 casos/773 checks;14 PNG2048 reales leídos.389/138 hashes intactos y procesos propios cerrados.58 casos de contrato leídos; matriz exploratoria ampliada91/100,9 fallos de remuestreo188/240 conservados en runtime: no garantía de cualquier reducción/cámara/impresión. Nuevo steering: selector de tamaños en O87; fases globales siguen pendientes.
