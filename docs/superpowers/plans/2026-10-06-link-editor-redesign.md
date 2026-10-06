# Rediseño de creación y edición de enlaces

**Goal:** rediseñar desde cero ambos modales conforme a la petición del usuario, preservando autoridad, contratos y correcciones del editor.

**Architecture:** mismo LinkDialogComponent y servicio de apertura; presentación HTML/SCSS nueva, sin duplicar lógica. Angular Material mantiene accesibilidad de tabs, inputs, selects y diálogo. Vista previa de la URL y destino como representación, sin prometer un alias aleatorio aún no asignado.

**Tech Stack:** Angular/Material existentes, Manrope, tokens UVH; sin dependencias nuevas.

**Spec:** petición explícita de 06/10/2026 y auditoría S04. La prioridad cambia a rediseño antes del siguiente bloque auxiliar; el objetivo completo continúa activo.

## Dirección visual

Paleta del producto: papel #fffcf5, tinta oliva #262821, acento #b53c20, oscuro #2c3028, acento oscuro #f79573. Usar los tokens existentes, no congelar colores. Manrope para interfaz; monospace sólo para direcciones reales.

Encabezado con título directo y cierre. Área principal con navegación Destino/Acceso/Organización/Campaña/Reglas; lateral con recorrido URL corta→destino y condiciones elegidas. Footer fijo con acciones y estado. En móvil desaparece la columna lateral y la URL sigue visible en el encabezado.

La identidad se concentra en el recorrido del enlace; evitar números decorativos, tarjetas repetidas, mayúsculas o nuevos fondos ajenos a UVH. Jerarquía y aire en vez de más adornos. La revisión del diseño confirma que el patrón responde a gestionar enlaces y a la identidad actual.

## Pasos y evidencias

- [x] Leer componente/HTML/SCSS/servicio completos y contratos nativos existentes; snapshot de fuentes antes de cambios. Full anterior terminal1438,817hashes revalidados.
- [x] Rehacer presentación y tamaño de overlay, conservar cada control/validación, autoridad/versiones/reglas/plantillas/fechas PATCH y afterClosed.
- [x] Revisar creación/edición en desktop/móvil y claro/oscuro; teclado/foco/scroll, plantilla, validación y error. API ficticia8436, ninguna escritura real.
- [x] Regresión dirigida, tipos/lint/build y frontend completo; comparar fuentes/tests y documentar resultados reales.
- [x] Actualizar informe y planificación del rediseño. La revisión completa S01–S13, auxiliar/CSV y AuthService frontend continúa pendiente; AuthController HTTP separado.

No ejecutar control del usuario, servicios/productivos, uvh_local, mail/proveedores, commit/push/deploy ni nuevas dependencias. No cerrar objetivo por este rediseño. Los cambios concurrentes del usuario quedan intactos.


## O61 — rediseño del editor de enlaces y B204 (06/10)

Creación y edición rediseñadas conforme a la prioridad del usuario: cinco secciones, vista previa del recorrido, acciones visibles, altura estable, móvil y ambos temas. Cuatro archivos de producto; controles, contratos, reglas, plantillas y autoridad conservados. B204/P2 corregido: una ventana válida con microsegundos podía representarse con fechas iguales en el DTO y bloquear una edición ajena a las fechas. Sólo se conserva la igualdad de ambos originales intactos, que se omiten de PATCH; el backend mantiene su validación definitiva. Fechas nuevas/plantillas iguales o invertidas siguen rechazadas.

Rojo previo: 29 casos, 1 fallo y 28 controles, handle55918 exit1. Seis casos nuevos: 31 lifecycle, 44 dirigidos y 1438 frontend completo, handle50394 exit0 (10.534s / 9.838s de casos). Tipos66239, lint92456 y build12102 exit0. 817 hashes finales comprobados; 812 fuentes previas ajenas y 107 specs anteriores conservados. QA con Angular compilado real y API ficticia en memoria8436: creación/edición, desktop/móvil, claro/oscuro, tabs, foco/teclado, reglas/fechas/errores y conservación exacta de fechas de la fixture. Capturas y evidencia en `.uvh-runtime/s04-link-dialog-browser/report.md`; sin vídeo completo por ffmpeg no disponible.

Inventario estático499/2365named/1226anonymous/3firmas/0provisional, enumeración no equivalente a revisión. S04:71anclas/10archivos. Matriz185rutas conserva owners/status/contratos y amplía sólo tres celdas de evidencia. Prueba íntegra `.uvh-runtime/verify-link-editor-redesign.py` exit0. El comparador histórico O60 sigue rechazando el cambio concurrente del control del usuario; no se cambia ese digest ni se ejecuta el control. Backend2714/22466 sigue evidencia histórica O59, sin nueva suite SQL. Objetivo S01–S13 activo: siguiente despacho auxiliar bajo TX exterior/CSV; revisión de AuthService frontend, reglas horarias, S13, release/migraciones externas y demás sistemas pendientes. Ninguna escritura en DB/cuentas/correo/proveedores reales ni commit/push/deploy.
