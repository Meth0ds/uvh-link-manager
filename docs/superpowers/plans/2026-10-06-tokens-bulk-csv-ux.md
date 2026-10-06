# O63 — tokens, acciones masivas y CSV

Continuación autorizada del informe UX de 33 puntos. Alcance local: presentación de caducidad de tokens, jerarquía de acciones masivas y recorrido de CSV. S01–S13 sigue activo; no cerrar el proyecto por este lote. Sin agentes, ejecución de control compartido, DB/correo/proveedores reales, migraciones ni publicación.

Dirección visual: conservar Manrope, papel #fffcf5, tinta #262821, acento #b53c20, oscuro #2c3028 y acento oscuro #f79573. Token: registro reconocible, fechas con hora/zona y estado activo/caducado/revocado/desconocido. Masivas: selección y tres herramientas principales, resto en menú; formulario contextual sin alterar handlers ni idempotencia. CSV: elegir/pegar → comprobar → confirmar importación, ayuda avanzada expandible y un ejemplo completo tags_json. Alineación izquierda, cuerpo 13–14 px y código sólo en muestras/alcances.

Crítica del planteamiento: sin nuevas tarjetas decorativas ni cambio de marca. La secuencia CSV es real y merece pasos; las otras superficies no necesitan numeración. Mantener intacto el secreto de un solo uso; no desmontar el formulario al terminar una creación. No sustituir la autorización del backend por colores/disabled.

- [x] Leer fuentes afectadas completas, conservar originales y comprobar 819 hashes O62.
- [x] Reproducción nativa de tokens caducados/límite/cambio con pantalla abierta y controles.
- [x] Corregir representación temporal; un temporizador al próximo vencimiento, cleanup y vuelta a pestaña.
- [x] Rediseñar masivas y CSV; conservar confirmaciones y reintentos; controles significativos.
- [x] Build real, QA fixture aislada con móvil/temas/teclado/errores.
- [x] Regresión completa, tipos/lint/build, fuentes previas/specs intactos, inventario y documentación.

Los tests antiguos no se debilitan. Nuevos bugs reciben ID tras rojo válido. El ejemplo CSV nuevo debe contener una sola cabecera y conservar soporte tags_json/nombres con punto y coma. Las propuestas de Ajustes, dominios/webhooks y administración quedan para lotes posteriores.


## O63 — tokens, acciones masivas y CSV (06/10)

B209/P2: tokens caducados parecían activos, también en el instante límite y con la vista abierta; tres rojos nativos,13 controles finales. Temporizador único al próximo vencimiento, cleanup y visibilidad; fechas localizadas con segundos/zona y estados desconocidos conservadores. B210/P2: decoder rechazaba el éxito set-domain del bulk; un rojo/dos controles, sólo se agrega el literal documentado.

Barra masiva con Etiquetar/Mover/Más acciones y confirmaciones/handlers originales. CSV elegir/pegar→comprobar→confirmar, ayuda expandible y un ejemplo tags_json; cuatro controles UI nuevos conservan body/key al reintentar409. Diálogo acotado en móvil320×568. Total20 casos nuevos,1473/1473frontend; tipos/lint/build de entrega salida0. Nueve archivos producto,822 hashes finales,810 fuentes previas ajenas y110 specs anteriores intactos; clase CSV íntegra conservada. Inventario499/2369named/1233anonymous/3firmas/0provisional; S04ledger97/14 yS07ledger30/5. Comparador/terminales/QA en `.uvh-runtime/o63-frontend-actions/`.

Informe33 puntos actualizado:5/19/20/26 resueltos,27 parcial (parser real/descarga pendientes). Próximo visual: Ajustes/sesiones ydominios/webhooks; también pendientes despacho auxiliar bajoTX exterior/CSV, AuthService/frontendauth, S13 estático yrelease/migraciones/gates externos. Este lote no cambia backend/DB/correo/proveedores reales ni acredita perfección/cierre S01–S13.
