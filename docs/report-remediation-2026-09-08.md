# Cierre del informe de revisión ZIP — 8 de septiembre de 2026

Este registro relaciona F01–F26 con cambios comprobables del repositorio. No es
una aprobación de producción: por petición del propietario, las suites y los
ensayos se ejecutan juntos al final del lote. Hasta entonces, «preparado» sólo
significa implementado y revisado estáticamente, no validado.

## Matriz de correcciones

| ID | Estado antes de la validación final | Corrección o gate incorporado |
| --- | --- | --- |
| F01 | Preparado | `phpunit.xml` ya no impone credenciales locales. CI es la única fuente de conexión a `uvh_test`, prepara el esquema completo y conserva el guard `_test`. |
| F02 | Preparado | El preflight E2E instala `composer.lock` dentro de la imagen PHP antes de arrancar Laravel; un checkout sin `vendor` deja de depender del estado previo del host. |
| F03 | Preparado | El destino efectivo —principal, regla o fallback— recibe UTM tras su selección. Se conservan query y fragmento, gana el valor configurado y la URL final se revalida antes de consumir el enlace. |
| F04 | Preparado | El workspace inicial se trunca a 80 puntos de código y el decoder tolera nombres históricos de hasta 255 sólo en lectura. Las escrituras siguen limitadas a 80. |
| F05 | Preparado | `/help` y `/status`, incluidas sus variantes con barra final, se sirven como rutas SPA públicas y sus alias quedan reservados. |
| F06 | Preparado | El gráfico usa coordenadas numéricas, genera un `path` de área SVG válido y centra el caso de un único punto. |
| F07 | Preparado | El máximo de rango usa segundos positivos entre timestamps después de validar el orden. |
| F08 | Preparado | La API declara `visitorMetric=daily_pseudonyms` y la interfaz deja de presentarlo como personas únicas del periodo. |
| F09 | Preparado | Cada dimensión devuelve top ocho y `dimensionTotals` con el número real de categorías antes del límite. |
| F10 | Preparado | Analytics y Dashboard invalidan y ocultan datos anteriores antes de solicitar un periodo nuevo. |
| F11 | Preparado | La API materializa el calendario UTC acotado e incluye días a cero; el gráfico contempla series vacías y de un punto. |
| F12 | Preparado | Cambiar de workspace reinicia sincrónicamente la página de enlaces y cancela/descarta la lectura anterior. |
| F13 | Preparado | `Accept-Language` se analiza con longitud, entradas y pesos acotados; una regla primaria acepta variantes y una regional exige coincidencia exacta. `q=0` e inválidos no coinciden. |
| F14 | Preparado | `PUBLIC_ORIGIN` modela esquema, host y puerto del origen por defecto; producción exige HTTPS exacto. Los alias se codifican al formar la URL. |
| F15 | Preparado con alcance explícito | Los IDN se normalizan mediante UTS 46/Punycode. API y panel prometen únicamente un hostname con CNAME directo; apex, flattening, proxies y wildcards quedan fuera del contrato. |
| F16 | Preparado | `externalAnalysis` separa configuración, habilitación y operación; permanece `not_implemented` hasta que exista un adaptador real. |
| F17 | Implementación y política preparadas; medición pendiente | El dominio usa bloqueo compartido, no exclusivo. La analítica reducida se envía a una cola idempotente independiente; límites de clic/uso único siguen atómicos. Se añadió un benchmark acotado y una política de pérdida explícita. |
| F18 | Decisión preparada; saturación pendiente | Eventos webhook suscritos siguen siendo fail-closed y durables en la transacción; no se oculta pérdida. La política diferencia webhooks contractuales, analítica auxiliar y ping manual. |
| F19 | Preparado; interferencia real pendiente | Mail, webhooks, DNS/TLS, exports y analítica tienen colas, workers, timeouts y heartbeats separados; `default` queda sólo para drenaje de despliegues anteriores. Métricas exponen profundidad y edad por pool. |
| F20 | Preparado | Lecturas: 20 s por defecto, cancelables por `AbortSignal`. Mutaciones: 45 s, sin reintento ciego y con resultado ambiguo explícito. Artefactos: 120 s. Las vistas conservan además barreras de revisión/contexto. |
| F21 | Reducción preparada; recuento final pendiente | Se tiparon relaciones Eloquent de los modelos. El baseline no se regenerará para ocultar errores: Larastan eliminará al final sólo entradas demostradas como obsoletas y publicará el recuento por categoría. |
| F22 | Harness preparado; proveedores reales pendientes | Un segundo Playwright construye las imágenes de producción y recorre Caddy → Nginx → PHP-FPM sobre PostgreSQL `_test`. ACME público, correo, hCaptcha, DNS/TLS y monitor externo siguen siendo gates de staging. |
| F23 | Preparado | El único serializador común clona el `DateTimeInterface`, lo normaliza a UTC y sólo entonces emite `Z`. |
| F24 | Preparado; fault injection pendiente | Export acotado a 10 000 filas/12 MiB y margen de memoria. I/O y descifrado quedan fuera de locks largos. `download_served_at` y un acuse posterior separan respuesta preparada de recepción; sólo el acuse consume y limpia. |
| F25 | Gate implementado; datos y evidencia externa pendientes | Producción no arranca sin identidad legal completa y no-placeholder. Términos/privacidad cargan esa identidad como unidad. Existe una plantilla para digests, backup/restore, alertas, rotación, rollback y responsables, pero esos hechos no se inventan. |
| F26 | Clasificado, sin feature nueva | Las ampliaciones continúan separadas en «Roadmap opcional» de `todos.md`; no se cuentan como defectos ni como requisito del cierre mínimo. |

## Decisiones de seguridad que no se han debilitado

- La base de pruebas debe terminar en `_test`; ningún comando de este lote debe
  migrar o truncar `uvh_local`.
- Uso único y máximo de clics permanecen dentro de la transacción de resolución.
- La admisión webhook contractual sigue siendo durable y fail-closed.
- Ningún secreto de hCaptcha, bearer de exportación, IP o user-agent crudo entra
  en configuración pública, métricas o payloads de analítica en cola.
- Las operaciones mutantes no se reintentan automáticamente después de timeout.

## Validación final pendiente

La revisión cruzada de F19 también actualiza el worker local para consumir todas
las colas y el overlay de rotación para montar la clave anterior en los seis
pools de producción. F24 libera las representaciones de la exportación en cuanto
dejan de necesitarse para reducir el pico de memoria. Estos ajustes todavía no
se han ejecutado ni validado con pruebas.

Cuando termine la implementación se ejecutarán, en este orden y únicamente
contra bases efímeras `_test`: comprobación de diff, sintaxis/configuración,
Pint, Larastan y reducción del baseline, suites backend/frontend, builds, E2E
funcional y smoke de imágenes de producción. Las pruebas de proveedor, DNS/TLS,
backup/restore, alertas, carga, accesibilidad asistida y revisión legal deben
adjuntar evidencia real usando `release-evidence-template.md`.
