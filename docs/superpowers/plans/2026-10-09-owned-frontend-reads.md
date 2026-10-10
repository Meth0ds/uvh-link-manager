# O94 — Lecturas auxiliares y descargas cancelables

Siguiente lote de optimización, preparado tras lectura de fuentes y antes de cambiar producto. Ejecutar después de QA terminal y limpieza O93. Mantener todas las funcionalidades y diseño; no tocar control compartido, deploy ni servicios reales.

## Evidencia de código

- LinksComponent usa LatestRequest en reload/exportCsv, pero loadDomainOptions/loadCollections no tienen guard ni señal. Los resultados actualizan opciones tras una transición de workspace; collections tampoco se vacía en la transición actual.
- ApiService.getBlob/artifactRequest no acepta ApiReadOptions. Links y Analytics ya crean una señal para exportación, pero no pueden pasarla; descartar la respuesta no cancela su transporte.
- Los GET JSON principales ya admiten señal; conservar cancelOnAbort y los guardias de respuesta. POST de artefactos es una mutación y queda fuera de esta cancelación de lecturas.
- WorkspaceService.selectionGeneration es hoy un método sobre un contador plano; leerlo en un effect no crea dependencia reactiva. targetWorkspace sólo compara id. No reutilizar ese helper como si ya cubriera A→B→A: capturar generación explícitamente, comprobarla al publicar y estudiar la invalidación reactiva sin cambiar contratos de otros consumidores. Tests deben modelar la selección real, sin debilitar el guard por mocks incompletos.

## Contratos

Cada lectura tiene un dueño de vista, cuenta, sesión y selección de workspace. Un contexto antiguo no escribe opciones, error, loading ni dispara una descarga. Cambiar A→B→A no devuelve vigencia a una lectura de la primera selección A. Cancelar transporte no reemplaza la comprobación de contexto ni prueba cancelación de procesamiento en PHP.

## Pasos

- [x] Leer completos ApiService, LatestRequest, targetWorkspace/WorkspaceService, Links y Analytics; revisar consumidores y tests existentes. Fijar baseline de fuentes y comprobar ausencia de procesos QA/build propios antes de editar.
- [x] Casos de lecturas auxiliares: A→B/A→B→A, respuesta/error tardíos, destroy, cierre/reapertura mover, lectura válida y fallo actual. Aislamiento y limpieza sin consultas globales ni eliminación de opciones.
- [x] Dar guard y AbortSignal a opciones de dominio/colección; invalidarlas y vaciarlas al cambiar contexto. Evitar duplicación simultánea si el contrato de reapertura lo admite; no añadir cache con datos obsoletos de otro tenant.
- [x] Extender sólo GET Blob con opciones de lectura y cancelOnAbort. Links/Analytics pasan su signal. Conservar timeout de120s, traducción de error JSON dentro de Blob, Retry-After y descarte de respuestas tardías. POST Blob conserva autoridad/CSRF/idempotencia.
- [x] Verificar con HttpTestingController cancelación de suscripción/transporte (antes de empezar y durante GET), limpieza de listener y errores/timeout/lectura válida; consumidores no descargan ni muestran error antiguo. Medir peticiones canceladas sin inventar ahorro CPU de backend.
- [x] Ejecutar tipos, lint y pruebas frontend relevantes; build/regresión frontend adecuados. Congelar fuentes, comprobar resultados terminales, registrar evidencia y cerrar recursos propios. Actualizar inventario y plan global; modales/grafo/SQL/jobs siguen pendientes.

## Cierre verificado

O94 cerrado. `selectionGeneration()` conserva su interfaz y lee ahora una señal reactiva; detecta A→B→A incluso antes de que el efecto vea B. Contexto de Links/Analytics incluye sesión y selección. Opciones auxiliares guardadas y cancelables; sólo las lecturas de colección simultáneas se comparten, una apertura posterior vuelve a consultar. GET Blob acepta señal y conserva timeout120s, errores JSON y Retry-After; POST conserva su contrato.

21 casos nuevos,47 dirigidos y1.891 integrales pasan; tipos, lint y build de producción exit0. Se verifican cancelación HTTP real mediante HttpTestingController y descarte de éxito/error tardío de dos pantallas. 406 hashes de fuente y521 del inventario intactos. Procesos terminales, puerto9984 libre y ningún contenedor propio restante; no se creó DB. Evidencia en `.uvh-runtime/o94-owned-reads/verification-summary.json` y logs. No se atribuye ahorro CPU ni latencia de servidor a cancelar el cliente. Las fases globales restantes siguen activas.
