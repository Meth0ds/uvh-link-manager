# Matriz de contenidos — Descarga de cuenta

Matriz autoritativa de lo que el documento de exportación contiene y de lo que
deja fuera deliberadamente. El formato es `uvh-account-export-v1` y lo produce
`App\Support\AccountExportDocument`; cualquier cambio de contenido pasa por
esta matriz y por las pruebas de `DataExportSnapshotTest`.

## Naturaleza del documento

- **Qué es**: copia de acceso a la cuenta de autogestión (art. 15 RGPD). El
  propio documento lo declara en `rights.document: "account_access_copy"`.
- **Qué no es**: el ejercicio formal de los derechos de acceso y portabilidad
  (art. 15 y 20 RGPD), que se registran, verifican y responden por el flujo de
  expedientes de privacidad, con identidad proporcional y plazo legal. Cuando
  el proceso automático no puede generar el archivo (`automated_size_limit`),
  el camino es ese flujo, no soporte.
- **Consistencia**: todas las secciones se recogen dentro de una única
  transacción `REPEATABLE READ READ ONLY`, así que el documento describe un
  mismo instante.
- **Formato**: JSON con las filas compactas, una por línea. Las secciones se
  recorren por cursor y se codifican por fragmentos, con lo que la memoria del
  worker es constante sea cual sea el tamaño de la cuenta.

## Cabecera

| Clave | Contenido |
| --- | --- |
| `format` | `uvh-account-export-v1`. |
| `generatedAt` | Instante de generación (ISO 8601, UTC). |
| `scope` | Lista textual del alcance, en inglés, estable entre versiones. |
| `rights` | `{ document: "account_access_copy", note: … }`: separación contractual art. 15 vs art. 20. |
| `account` | Fila única: `id`, `email`, `name`, `email_verified_at`, `mfa_enabled`, `created_at`, `updated_at`. |

## Secciones (orden del documento)

| Clave | Origen | Contenido |
| --- | --- | --- |
| `memberships` | `memberships` ⋈ `workspaces` | Membresías de la cuenta: workspace (id, nombre, slug), rol y fecha de alta. |
| `createdLinks` | `links` (creados por la cuenta) | Enlaces completos: alias, destinos, estado, contadores, uso único, programación, caducidad, notas y UTM; incluye `deleted_at` si fueron borrados. |
| `redirectRules` | `redirect_rules` ⋈ `links` propios | Reglas de redirección por país, idioma, dispositivo, SO, horario, referrer y campaña. |
| `linkTags` | `link_tags` ⋈ `links` propios ⋈ `tags` | Etiquetas aplicadas a los enlaces propios (id de enlace + nombre de tag). |
| `aggregateAnalytics` | `metric_rollups` ⋈ `links` propios | Agregados diarios por enlace: `clicks`, `visitors`, `countries`, `devices`, `browsers`, `os`, `referrers`, `campaigns`. Sin eventos individuales. |
| `aggregateAnalyticsDefinition` | definición fija | `visitors: "distinct_daily_pseudonyms"`, `crossDayIdentity: false`: el «visitante» es un seudónimo diario rotado; la misma persona puede contar un día distinto y nunca se afirma como individuo único. |
| `apiTokenMetadata` | `api_tokens` (creados por la cuenta) | Nombre, scopes, workspace, último uso, caducidad y revocación. **Sin** hashes ni bearers. |
| `ownedWorkspaceDomains` | `custom_domains` ⋈ `workspaces` propios | Dominios de los workspaces que posee la cuenta: dominio, estado y verificación. |
| `ownedWorkspaceWebhooks` | `webhooks` ⋈ `workspaces` propios | URL del webhook **sin** credenciales ni query (se marca `urlCredentialsOrQueryRedacted: true` si hubo que retirarlas), eventos, activo y fechas. **Sin** secretos de firma. |
| `accountAuditTrail` | `audit_events` | Acciones sobre la cuenta: `id`, `action`, `resource_type`, `resource_id`, `created_at`. Sin identificadores derivados de IP. |
| `privacyRightsRequests` | `privacy_rights_requests` | Expedientes RGPD de la propia cuenta: tipo, estado, verificación de identidad, acuse, plazos, prórrogas y cierres. |
| `privacyRightsMessages` | `privacy_rights_messages` ⋈ expedientes propios | Mensajes de los expedientes descifrados. Un cuerpo irrecuperable conserva su cronología con `bodyUnavailable: true` en vez de filtrar ciphertext. Sin identificadores del personal. |
| `legalAcceptances` | `legal_acceptances` | Versiones de documentos legales aceptadas o acusadas por la cuenta, con el `accepted_at` almacenado tal cual. |

## Fuera del documento (por diseño)

- Contraseñas, secretos MFA, códigos de recuperación y cualquier derivado.
- Tokens de API: hashes y bearers (sólo metadatos).
- Secretos de webhook (firmas), de verificación de dominios y de correo.
- Identificadores del personal interno y datos derivados de IP.
- Eventos de visitante individuales: la analítica sale sólo como agregado
  diario con la definición de `visitors` publicada junto a ella.
- Datos de otras cuentas, otros workspaces o de la plataforma.

## Techo operativo

El documento de texto plano tiene un techo operativo de 256 MiB
(`AccountExportDocument::MAX_PLAINTEXT_BYTES`). No es un límite del producto:
protege el volumen privado y el worker. Al superarlo la solicitud termina con
`failureReason: "automated_size_limit"` y el usuario es dirigido al flujo de
derechos de privacidad. La variable `EXPORT_MAX_PLAINTEXT_BYTES` existe para
despliegues excepcionales, pero se excluye a propósito de la plantilla de
entorno —subirla sin medir antes el volumen privado sería el fallo— y el código
la acota entre 1 KiB y 256 MiB.

## Artefacto de entrega

El documento no se guarda en claro: `PrivateArtifact` lo envuelve en un
contenedor cifrado por bloques (`uvh-private-artifact-v2`, una línea `enc:v1:…`
por bloque de 4 MiB) y la descarga lo descifra por streaming con `no-store`
tras un step-up de contraseña y segundo factor. El acuse de recepción es lo
único que consume la exportación y purga el artefacto; la ventana de descarga
es de dos días.
