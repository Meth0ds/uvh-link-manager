# UVH — Plan global de optimización por fases

**Solicitud:** pasada global de optimización profesional, con plan previo y sin eliminar ninguna funcionalidad. Fecha: 9 octubre 2026.

**Ejecución:** secuencial en este chat, por lotes verificables. Preservar los cambios compartidos. El objetivo anterior de UX y documentación legal continúa con sus pendientes operativos; esta pasada añade optimización y no certifica su cierre. Mantener la matriz histórica S01–S13 como referencia, actualizándola donde exista evidencia nueva, sin repetir separaciones de auth ya completadas.

**Resultado buscado:** menos trabajo redundante, menor transferencia/memoria/latencia cuando se demuestre, código más fácil de modificar, contratos y funcionalidades conservados. Menos líneas, más abstracciones o una suite verde no demuestran por sí solos una optimización.

## Reglas de conservación y método

1. Cada cambio sigue: lectura completa de la unidad y consumidores → contrato/baseline → mejora pequeña → pruebas pertinentes → comparación antes/después → registro del resultado. Si no aporta una mejora demostrable de rendimiento o mantenibilidad, se descarta.
2. Conservar rutas/API/DTO, errores útiles, paginación y filtros, roles/scopes, sesiones/CSRF/MFA/CAPTCHA, límites/consumo único, estados de dominios, auditoría transaccional, correo/outbox, idempotencia, recuperación y versiones legales aceptadas. Las optimizaciones se prueban también con estados vacíos, fallos, concurrencia y contexto cambiado.
3. Las decisiones de identidad/permisos se revalidan en su frontera vigente. Las cachés se separan por actor/tenant/filtros/versiones y tienen política de caducidad/invalidez; una caché no sustituye esa revalidación. Las lecturas pueden abortarse; una mutación ya enviada no se repite a ciegas ni se presenta como deshecha por abortar la vista.
4. Datos pequeños/medianos/grandes, mismas condiciones y semillas para comparar; distinguir ejecución fría/caliente. Registrar mediana/p95/p99 cuando corresponda, dispersión, consultas/filas, trabajo CPU y memoria. No prometer un porcentaje global ni capacidad de producción a partir de fixtures locales.
5. No suprimir funciones, quitar comprobaciones, subir límites/timeouts, relajar tipos/budgets ni añadir ignores para aparentar una mejora. Una eliminación de código aparentemente muerto necesita comprobar consumidores dinámicos, rutas, jobs, configuración y compatibilidad histórica.
6. Entornos propios: API ficticia para navegador y bases cuyo nombre termine en `_test` para SQL/escrituras/pruebas. Outbound simulado, sin carga sobre cuentas, correo/webhooks/proveedores ni `uvh_local`. Revisar previamente cada launcher; conservar el control compartido y su paquete independiente. No ejecutar sus scripts ni editar producto mientras pruebas/build/fixtures propios estén activos.
7. Mantener diseño, accesibilidad, temas, teclado, móvil y microinteracciones. Animación ligada al estado real, un dueño por timer/RAF/observer, limpieza al destruir y alternativa de movimiento reducido.

## Diagnóstico de partida verificado

Inventario estático actual de `frontend/src/app` y `backend-laravel/app`, excluyendo specs TypeScript: **155 archivos TS / 23.413 líneas; 225 PHP / 37.634 líneas**. Son indicadores de alcance, no defectos ni complejidad medida. Hay **39 controladores, 69 migraciones y 67 componentes**: 37 declaran OnPush y 30 Eager; esto no justifica cambiar los 30 de golpe.

Build de producción actual: **860,63 kB iniciales / 192,35 kB de transferencia estimada por Angular**; CSS global 123,93 kB raw; chunk de Ajustes 203,86 kB raw. Esos tamaños no incluyen toda la navegación ni prueban LCP/INP. Baseline de calidad después del lote UX: 1.826 pruebas frontend, build/lint/tipos correctos y contrato legal puro 2 pruebas/97 aserciones. La suite backend integral y los benchmarks de SQL no se han reejecutado para esta nueva pasada.

| Evidencia actual | Oportunidad a investigar | Protección necesaria |
| --- | --- | --- |
| `settings/settings.component.ts`: 1.377 líneas; `loadAccountView()` inicia sesiones, exportación/historial, baja, privacidad y preferencias; secciones permanecen montadas. | Cargar lecturas por necesidad y extraer coordinadores/componentes gradualmente; diferir QR si aporta ahorro por ruta. | Preservar borradores, MFA en curso, navegación, refresco de propietario y limpieza de datos privados. |
| `analytics/charts.component.ts`: `breakdown()` calcula máximo y crea resultado; la plantilla lo consulta varias veces por dimensión. | Derivar los seis desgloses con computed por snapshot; medir trabajo repetido y conservar gráficos. | Ceros, series cortas, cambios de input, máximos, etiquetas y todos los desgloses. Primer lote candidato. |
| `app.config.ts` y `panel.routes.ts`: rutas ya diferidas; QR se importa en Ajustes; Material y CSS participan en chunks compartidos. | Medir waterfall/dependencias por ruta, estilos y fuentes; separar dependencias opcionales cuando se justifique. | Carga inicial y navegación secundaria, fallo de importación, compatibilidad y feedback de carga. |
| `AdminController.php` 1.736 líneas; WorkspaceController 1.121; AccountController 1.009; DomainController 961. | Delimitar consultas, decisiones y presentación en lotes; centralizar duplicación semánticamente idéntica. | Mismos métodos/rutas, errores y orden de autorización/locks/transacción/outbox. No volver a unir auth ni extraer todo a una clase gigante. |
| `LinkController` usa eager loading y páginas limitadas; `AnalyticsController` ya reutiliza overview y tiene caché por scope. | Revisar consumo real y SQL con planes de ejecución; no etiquetar cualquier `get()` como N+1. | Totales y orden estables, tenant, exportación, coherencia y frescura de métricas. |
| `RedirectService`: lock compartido en enlaces ilimitados, exclusivo para límites; revalida enlace/domain/password después del lookup. | Medir camino 302, dominio, reglas, UA y consultas; evitar trabajo duplicado con snapshots correctamente delimitados. | No quitar locks, checks de estado, alias/domain/password vigentes, single-use ni consumo de maxClicks. |
| `RecordClickAnalyticsJob`: analítica fuera del 302 e idempotencia por evento; rollups con contención documentada. | Medir drenaje/locks/hot alias separadamente de latencia de redirección. | No perder clics ni confundir seudónimos diarios con personas; evidencia local no es capacidad productiva. |
| `UvhHousekeeping` 1.060 líneas; scheduler evita solape; exports/artifacts y outbox ya tienen recuperación. | Batches/streaming, selección de trabajo, memoria, backoff y separación por responsabilidad. | Tareas no omitidas, plazo y purga correctos, idempotencia y recuperación de worker/cache caídos. |

Artefacto inicial: `.uvh-runtime/o83-global-optimization/inventory-summary.json`. Leer consumidores completos antes de convertir una oportunidad en cambio. Los números pueden variar con los cambios compartidos; cada lote congela su propia baseline.

## Fase 1 — Inventario, contratos y medición

**Estado:** en curso; inventario y tamaños iniciales recogidos, perfiles por flujo y SQL pendientes.

- [x] Inventariar fuentes productivas y tamaños de build, con fecha y alcance.
- [ ] Actualizar inventario por función/ruta/job y matriz de consumidores frente al árbol vigente; distinguir código generado, fixtures, archivo histórico y runtime.
- [ ] Capturar perfiles por landing, login/registro/MFA, dashboard/lista/detalle, Ajustes, dominios, equipo, analítica y admin: requests, bytes, waterfall, tasks/render, memoria y navegación repetida.
- [ ] Preparar datos de prueba aislados por volumen y pruebas de contratos antes de tocar rutas calientes. Recoger SQL/colas/302 en una pila propia, no inferirlos de QA simulada.
- [ ] Crear registro por oportunidad: evidencia, coste, impacto, riesgo, dependencia, criterio de éxito y motivo si se descarta.

**Salida:** baseline reproducible y backlog priorizado; ninguna mejora de rendimiento sin medir se presenta como conseguida. Se pueden ejecutar lotes independientes de bajo riesgo con su propia baseline antes de completar todos los perfiles.

## Fase 2 — Carga, red y bundle del frontend

**Prioridad:** alta; antes de refactors amplios del panel.

- [ ] Revisar imports estáticos/diferidos y dependencias por ruta; carga opcional de QR, diálogos y bloques pesados sin ocultar ni eliminar funciones.
- [x] O85: generador QR y marca UVH bajo demanda en ambos consumidores, con grafo/PNG/descarga/fallo/owner/destroy verificados.
- [ ] Revisar fuentes/iconos/estilos/activos, duplicación en chunks y CSS fuera de uso; conservar todos los estados, overlays, print y temas.
- [x] Ajustes: lecturas por sección con invalidación por actor, sin perder borradores/formularios en curso ni dejar estados sin refrescar. O84 conserva observación global de exportación; resultado registrado debajo.
- [ ] Peticiones de búsqueda/filtros/paginación: debounce pertinente, coalescing de lecturas idénticas y cancelación de lecturas obsoletas; preservar respuesta inmediata y errores/reintento.
- [ ] Medir navegación fría/caliente y fallo de chunks. Ajustar budgets a resultados razonables sin aumentarlos para tapar avisos.

**Salida:** comparación de bytes/peticiones por flujo y QA de rutas, fallos, borradores y cambio de contexto. No se promete reducir la suma de todos los chunks por simplemente diferirlos.

## Fase 3 — Render, estado y mantenimiento del frontend

- [x] Primer lote: desgloses de gráficos derivados del input con computed, contrato visual idéntico y medición del trabajo repetido.
- [ ] Revisar cálculos en plantilla, arrays/formatters recreados y getters costosos; derivaciones y keys de tracking estables.
- [ ] Revisar Eager/OnPush por componente según sus entradas, señales, formularios, librerías y callbacks. Migrar sólo con demostración de actualización correcta.
- [ ] Separar gradualmente Ajustes/Admin/AuthComponent/LinkDialog por responsabilidades reales; conservar estado compartido y API pública de cada extracción.
- [ ] Timers/polling/RAF/ResizeObserver/listeners: un dueño, pausa cuando corresponda, limpieza y ausencia de acumulación tras navegación repetida.
- [ ] Compartir feedback/contratos sólo donde existan consumidores reales; tipos estrictos sin `any`, sin sobreingeniería ni una abstracción distinta por pantalla.
- [ ] Microinteracciones sin layout thrashing: transform/opacity cuando corresponda, medidas agrupadas, sin trabajo de red por hover ni movimiento decorativo continuo.

**Salida:** trabajo por render y memoria comparados, casos de actualización/input/identidad tardía y QA visual/teclado/táctil/reduced-motion. El ahorro de CPU local no se traduce en un porcentaje de velocidad de toda la app.

## Fase 4 — Arquitectura y contratos de Laravel

- [ ] Mapear rutas reales y dependencias actuales; no volver a separar controladores de auth ya extraídos.
- [ ] Separar lectura/presentación/decisión de Admin, Workspace, Account, Domain y Link por lotes verticales. Mantener controllers delgados donde simplifique y servicios con responsabilidades delimitadas.
- [ ] Reducir duplicación verificada en validación normalizada, DTO, scope, paginación y errores; preservar matices públicos/privados y anti-oráculo.
- [ ] Reducir casts, serialización, parseos y llamadas repetidas dentro de un mismo snapshot; revalidar donde la concurrencia exige un snapshot nuevo.
- [ ] Resolver deuda de tipos/PHPStan con contratos reales y quitar sólo supresiones solucionadas; no añadir nuevas para silenciar el refactor.

**Salida:** contratos HTTP y transaccionales equivalentes, PHPUnit afectado, Pint/PHPStan y mapa de rutas; comparación de cuerpos/métodos cuando el cambio sea una extracción. Métrica de mantenibilidad explícita, no ganancia ficticia de latencia.

## Fase 5 — PostgreSQL, consultas y caché

- [ ] Identificar consultas repetidas/N+1/selección excesiva y coste de counts, búsquedas ILIKE, deep pagination y ordenación por workspace.
- [ ] Capturar `EXPLAIN (ANALYZE, BUFFERS)` con datos propios, volúmenes representativos y parámetros equivalentes; verificar índices existentes y coste de escritura antes de añadir uno.
- [ ] Revisión de índices compuestos/parciales y unicidad de alias/domain/claims, sesiones, eventos, outbox, exportación, auditoría y privacidad.
- [ ] Revisar agregación/frescura/contención de analítica; separar coste de snapshot, cache hit/miss e ingestión.
- [ ] Caché: claves de tenant/actor/filtro, stampede, invalidación tras commit, caducidad, límites y fallo de Redis; no permitir revival de permisos o recursos revocados.
- [ ] Toda migración tiene compatibilidad, validación de datos y estrategia de reversión/límites de bloqueo. Ensayos sobre DB `_test` aislada, una ejecución DB propia a la vez.

**Salida:** planes antes/después, igualdad de resultados/totales, consultas/filas/locks medidos y prueba de concurrencia/invalidación. No migrar la base compartida para medir.

## Fase 6 — Colas, correo, webhooks, dominios y tareas

- [ ] Analítica, mail/outbox, reputación, DNS/TLS, exportaciones y purga: inventariar cada estado y camino de recuperación.
- [ ] Batches y memoria acotada en exports/housekeeping; evitar cargar colecciones completas si streaming conserva exactitud y cifrado.
- [ ] Revisar payload mínimo, idempotencia, admisión tras commit, backoff/timeout/retry y separación de queues. Evitar reintentos duplicados que cambien el significado o disparen efectos externos.
- [ ] Medir throughput/drenaje/edad de cola con alias caliente y disperso; integridad bajo entrega doble, pérdida de worker y cache/DB caídos.
- [ ] Revisar costes y aislamiento de scheduler/solapes/retención. Documentar qué cambios afectan capacidad y qué cambios sólo organizan código.

**Salida:** ningún job/evento/correo/medida se pierde ni duplica en los escenarios probados, memoria y tiempos acotados; fixtures de proveedor no acreditan entrega real o capacidad productiva.

## Fase 7 — Costes y coherencia transversales

- [ ] Reconciliar errores, decoders, límites y políticas duplicadas entre frontend/backend con fuentes claras; preservar legacy y seguridad de entrada.
- [ ] Revisar alcance/deduplicación del logging y telemetría: útil para diagnóstico, sin secretos ni payloads personales innecesarios.
- [ ] Dependencias y código generado: inventario de uso, seguridad y compatibilidad; actualización sólo con cambio justificado y documentación oficial vigente. No actualizar todo a ciegas por fecha.
- [ ] Optimizar suites y fixtures para independencia y feedback rápido sin rebajar cobertura. No ejecutar tests de rendimiento junto a otras cargas ni paralelizar las escrituras sobre la misma DB.
- [ ] Documentar ownership/contratos de módulos compartidos y revisar import cycles.

**Salida:** calidad estable, duplicación eliminada con equivalencia comprobada, pruebas más claras y rápidas cuando se mida; ninguna funcionalidad retirada por asumir que no se usa.

## Fase 8 — Build y configuración operativa

- [ ] Revisar Docker/PHP-FPM/OPcache/autoload, config/routes/view cache y lifecycle de workers frente a la configuración existente.
- [ ] Medir compresión, headers/caché estática, hashing, serving de SPA y recursos; datos autenticados/públicos sensibles conservan su política.
- [ ] Revisar límites de CPU/memoria/worker y pools Redis/Postgres según medición; no multiplicar workers sin estudiar contención ni adecuar a hardware no conocido.
- [ ] Verificar release gates, migración compatible, salud/ready checks y recuperación en topología propia. Preparar cambios reversibles antes de cualquier operación real.

**Salida:** build/release verificables y comparaciones locales documentadas. Configuración en código y ensayos no significan despliegue ni garantía de producción.

## Fase 9 — Regresión global y cierre de la pasada

- [ ] Matriz de funcionalidades antes/después: identidad/MFA/recuperación, workspace/roles/equipo, enlaces/reglas/QR/trash/302, dominios, tokens/API, webhooks, analítica/export, actividad/notificaciones, admin/moderación, privacidad/baja, páginas públicas/correos/archivos legales.
- [ ] Frontend completo, backend completo en DB test propia, E2E funcional, concurrencia/fallos/async/backup-release apropiados al cambio y revisión de código restante. Cada puerta registra fecha, fuente y límites.
- [ ] Comparar métricas con baseline, revisar regresiones y descartar optimizaciones que empeoren un flujo importante sin beneficio compensatorio justificado.
- [ ] Cada oportunidad termina como implementada/verificada, descartada con evidencia o pendiente explícita. Completar funciones revisadas y unidades de código; los tests no sustituyen lectura.
- [ ] Informe final por fase: qué cambió, qué funcionalidad se preservó, qué se midió, resultado y riesgos. Separar terminado en código de validación productiva/legal que requiere hechos externos.

**Criterio de cierre:** toda la cobertura acordada tiene una decisión y evidencia; sin nuevas regresiones conocidas relevantes, contratos conservados y mejoras concretas demostradas. «Todo lo posible» se traduce en una revisión exhaustiva con decisiones justificadas, no en reescribir todo ni prometer que no pueden existir más optimizaciones.

## Orden inmediato

1. Cerrar y registrar la QA del lote de microinteracciones O82.
2. Consolidar baseline y lectura de gráficos/consumidores. Primer cambio pequeño: cachear derivaciones de breakdown por snapshot si la comparación confirma el ahorro y no cambia el resultado.
3. Después, waterfall de Ajustes y dependencia QR. Diseñar carga selectiva conservando formularios y ownership antes de extraer componentes.
4. Continuar lotes del resto de fases con prioridades medibles y gates pertinentes; no mezclar migraciones, grandes extracciones y rediseños en una sola revisión.

## Primer lote ejecutado y verificado — 9 octubre 2026

O82 cerrado antes de editar la optimización. Se leyó `ChartsComponent`, su plantilla y los consumidores Dashboard/Analítica: publican snapshots nuevos mediante señales. Un `computed` privado deriva los seis máximos por input y `@let` reutiliza cada resultado en la plantilla. Se conserva el mínimo1 para ceros/vacíos, las referencias de filas y la actualización cuando cambia el input; no se cambia la estrategia de detección ni las API.

Comparación reproducible extraída de fuentes: seis dimensiones × ocho filas × veinte renders sin cambiar datos, **9.600 → 48 lecturas de valores para calcular máximos**, mismo checksum. El harness simula la política de memoización; dos pruebas de componente verifican la invalidación real de Angular. Esta medida describe ese trabajo redundante y no una ganancia global de velocidad.

Verificación final: **1.828/1.828 tests frontend**, build/lint/tipos/diff check exit0; **6 casos de navegador/112 comprobaciones**, cambio de periodo, ceros/vacíos, teclado, ambos temas y 1440/390/320px, con auditorías axe seleccionadas sin graves/críticos. Captura nativa de barras inspeccionada con API HTTP ficticia propia. Los 383 hashes del frontend congelado no cambiaron durante QA; procesos propios cerrados. Evidencia: `.uvh-runtime/o83-global-optimization/verification-summary.json`.

**Estado global: en curso.** SQL/colas/302/backend integral y las demás unidades aún necesitan sus baselines y lotes. El siguiente candidato es la carga de Ajustes: seis lecturas de datos iniciadas desde `loadAccountView`, separadas por sección visible sin desmontar formularios; comprobar la política de observación de exportaciones antes de diferir esa lectura.

## Backlog de ejecución inmediato

| Lote | Alcance y orden | Evidencia de salida | Estado |
| --- | --- | --- | --- |
| O83.1 | Derivaciones de ChartsComponent | Input actualizado y ceros/vacíos; recuento de trabajo y QA visual | Implementado/verificado |
| O84: Ajustes | Separar activación de lecturas según Perfil/Seguridad/Avisos/Privacidad/Cierre; mantener las cinco secciones montadas | Perfil6→1 GET de Ajustes; observación global de exportación conservada; rutas, retorno, retry, actor y escritura tardía | Implementado/verificado O84 |
| O85: Dependencia QR | Medir grafo de Settings y QrDialog de lista/detalle; diferir el generador opcional si reduce bytes por flujo | Grafo/requests en frío, QR MFA/enlace/descarga, fallo de import/clave manual, owner/destroy; logo añadido por petición del usuario | Implementado/verificado O85 |
| Render restante | Derivaciones/recreación/OnPush por componente, empezando por las tareas con coste observado | Perfiles equivalentes y actualización de señales/formularios/callbacks, sin acumulación al navegar | Pendiente |
| Laravel | Elegir una responsabilidad concreta de Admin/Workspace/Account/Domain; extracción separada del trabajo SQL | Contrato exacto, ruta/autorización/locks/transacción/outbox, PHPUnit/Pint/PHPStan | Pendiente |
| Consultas y jobs | Pila propia, datasets por volumen; medir primero listados/overview/302/export/housekeeping | Plan SQL/filas/locks/memoria/colas antes y después, idempotencia y recuperación | Pendiente |

La optimización de red de Ajustes distingue sus **seis GET** del tráfico de arranque del shell/identidad. La política actual de exportaciones ya observadas debe continuar tras un salto de sección; la primera observación diferida necesita una decisión explícita en el contrato. `AuthService` y los controladores de auth ya separados siguen como fronteras; no volver a mezclar sus responsabilidades.

## O84 — Carga de Ajustes ejecutada

Decisión de conservación: una consulta global del estado de exportación mantiene la detección/seguimiento de trabajos pendientes. Las otras cinco lecturas se admiten al visitar la sección por primera vez; el guard se borra al cambiar actor/generación. No se desmontan formularios ni se cambian los guards, endpoints, polling, historial por cambio de estado, deadlines o refrescos tras mutaciones.

**Medición de navegador: Perfil6→1 consultas propias de Ajustes**; los demás tráficos del shell/identidad se excluyen de esta cifra. Al visitar todas las secciones se conservan sus seis proyecciones.1.840/1.840 pruebas frontend,build/lint/tipos/diff0;90 casos/862 checks de navegador incluyendo regresión de privacidad. Todos los procesos propios cerrados y hashes congelados intactos. Plan/evidencia `2026-10-09-settings-selective-loading.md` y `.uvh-runtime/o84-settings-loading/verification-summary.json`.

Siguiente evidencia concreta: stats del build identifica un chunk de generador QR de24.573 bytes raw importado estáticamente por Ajustes, lista y detalle, aunque no se utilice QR. Investigar import diferido en ambos consumidores (Settings y QrDialog), preservando setup MFA admitido/clave manual, errores de chunk, owners y descarga. Su eliminación del arranque de esas rutas no reduciría necesariamente el bundle inicial de landing ni la suma total de chunks. Medir el mismo grafo y navegación antes/después.

## O85 — QR diferido y marca solicitada por el usuario

El servicio comparte sólo código, sin URLs ni secretos. Settings y QrDialog revalidan contexto antes y después del render. La importación falla de forma controlada; MFA conserva clave manual y no repite setup. Se limpia un QR anterior al admitir nueva clave y se reinicia el código OTP antes de mostrarla, preservando lo escrito durante la carga.

Por petición expresa se integra el wordmark UVH en el PNG, con revisión tras rechazo de la primera composición: marca en blanco sobre insignia oscura y halo blanco, corrección H y4 módulos de margen. El PNG final cambia de forma intencionada; lectura exacta con decoder independiente y hash idéntico entre vista/descarga sustituyen la igualdad de bytes con el PNG sin marca. Dimensiones240/480 conservadas.

Ahorro raw de JS estático por ruta22.800/23.648/23.682 bytes (Ajustes/lista/detalle).1.856 pruebas frontend,build/lint/tipos/diff0;35 casos de navegador/655 checks;72 decodificaciones exactas.389 fuentes/138 build congelados intactos, procesos propios terminales. Plan `2026-10-09-lazy-qr.md`; evidencia `.uvh-runtime/o85-lazy-qr/verification-summary.json`. Optimización global sigue en curso: backend/SQL/jobs y demás fases pendientes.

Próximo candidato leído: la normalización estricta de positivos en paginación Admin/Workspace es semánticamente equivalente, con defaults y límites específicos de cada superficie. Evaluar extracción pequeña compartida con pruebas de entradas inválidas/overflow y contratos HTTP en DB test propia, sin tocar autorización/locks/outbox; no equivale a separar por completo esos controladores ni demuestra ahorro SQL.
