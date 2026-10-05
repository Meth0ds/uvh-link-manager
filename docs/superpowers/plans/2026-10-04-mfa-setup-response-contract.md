# MFA setup response contract implementation plan — O34

> **For agentic workers:** ejecutar secuencialmente con executing-plans. No delegación, worktree, commit ni confirmación adicional; preservar autorización y árbol compartidos.

**Goal:** impedir que el frontend muestre instrucciones manuales y un QR de MFA incoherentes o incompletos; comprobar el contrato real del emisor antes de endurecer el decoder.

**Architecture:** validar el par en decodeMfaSetup, antes de que AccountMfaService/Auth/Settings lo reciban. Conservar el URI original validado, no reconstruir un QR distinto ni cambiar generación/policy. Un error de contrato llega como ApiRequestError502 y sigue la reconciliación ya existente; no afirmar rollback ni repetir un write.

**Tech Stack:** Angular/TypeScript, PHPUnit/Docker sólo si hay cambios PHP justificados, pruebas HTTP reales simuladas y TestBed/QR del frontend.

**Spec:** plan maestro S01 y candidato leído en O32/O33: Totp.generateSecret crea20bytes→32Base32, provisioningUri usa label codificada UVH:account ysecret/issuerUVH/algorithmSHA1/digits6/period30; Settings usa secret para manual yuri para QR. Este scope verifica el contrato de UVH, sin atribuir bypass de autenticación a un DTO de error ni declarar seguridad de todo MFA.

## Global constraints
- Ninguna cuenta/DBlocal, email/proveedor, worker/scheduler productivo, migración, commit/push/deploy.
- No alterar valores TOTP, activefactor/recovery consumidos, policy de MFA freshness/retries ni devolver material secreto por /me.
- Lecturas y pruebas antes de producto. No ajustes de PHP/tests durante suites DB; si PHP no cambia no repetir backend full por modificar TS.
- Error de decoder genérico, sin incluir secreto/URI/cuerpo no confiable en mensajes o logs.
- DOM/CSS existentes conservados salvo un defecto visual reproducido; malformed setup nunca debe mostrarse como preparado.

### Task 1: caracterizar y reproducir
**Files:** crear `frontend/src/app/core/services/mfa-setup-contract.spec.ts`; leer decoder/helpers, AccountMfaService, Auth.confirmedMfaMutation, Settings.stageMfaSetup completo, Totp.generateSecret/provisioningUri y MfaConfigurationAdmission.setup.
**Interfaces:** decodeMfaSetup(unknown):{secret:string,uri:string}; Auth.mfaSetup(password,code?) mismo retorno. Contract error desde API=502.
- [x] Verificar emisor actual sin DB: llamar directamente a Totp.provisioningUri con fixture pública en Docker/php sin Laravel bootstrap y comparar payload con parser/positivos; no imprimir secretos de cuentas reales.
- [x] Escribir rojo de par incoherente, secreto inválido, falta/duplicación de parámetros, tiposalgoritmo/digits/period distintos del backend, URI fragment/control/path/issuer engañoso. Positivos del emisor, reordenación de query y label email codificada (plus/slash/hash/UTF8 cuando el emisor lo admite).
```ts
const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const other = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const uri = `otpauth://totp/UVH%3Atest%40example.test?secret=${other}&issuer=UVH&algorithm=SHA1&digits=6&period=30`;
expect(() => decodeMfaSetup({ secret, uri })).toThrow();
```
- [x] Reproducir por ApiService/decoder/Auth reales: payload inválido no confirma setup, no automaticretry, error502genérico sin secreto. En Settings no publica secret/uri/QR ni mueve step2; replacement setup conserva unknown/reconciliation existente y no afirma que recoverycode no se consumió.
- [x] Ejecutar rojo con ChromeHeadless y guardar fallos/controles. Leer todas las fixtures afectadas antes de actualizarlas: positivamente deben usar payloads que produzca el emisor real; no borrar negativas para hacer pasar suites.

### Task 2: validación mínima del contrato real
**Files:** `frontend/src/app/core/services/auth-response-decoders.ts` y positivos afectados en tests.
**Interfaces:** retorno público idéntico; validación sólo de las instrucciones de alta nuevas, no de los secretos heredados almacenados que Totp.isUsableSecret acepta.
- [x] Tras confirmar el contrato del emisor, validar exactamente una vez cada parámetro de sus cinco campos; secret Base32/longitud del generador ycoherencia con secret query. Evitar que URL normalization convierta control/fragment/path malformado en una instrucción válida. Label del emisor con cuenta no vacía, sin confundir slash codificada con otro pathsegment.
```ts
const source = record(value, "MFA setup");
const secret = text(source["secret"], "MFA setup");
const uri = text(source["uri"], "MFA setup");
if (!/^[A-Z2-7]{32}$/.test(secret) || /[\u0000-\u0020\u007f]/.test(uri)) invalid("MFA setup");
let parsed: URL;
try { parsed = new URL(uri); } catch { invalid("MFA setup"); }
const expected: Record<string, string> = { secret, issuer: "UVH", algorithm: "SHA1", digits: "6", period: "30" };
const keys: string[] = [];
parsed.searchParams.forEach((_value, key) => keys.push(key));
if (keys.length !== 5 || keys.some((key) => !Object.hasOwn(expected, key))) invalid("MFA setup");
for (const key of Object.keys(expected)) {
  if (parsed.searchParams.getAll(key).length !== 1 || parsed.searchParams.get(key) !== expected[key]) invalid("MFA setup");
}
if (!uri.startsWith("otpauth://totp/") || parsed.protocol !== "otpauth:" || parsed.hostname !== "totp"
  || parsed.port !== "" || parsed.username !== "" || parsed.password !== "" || uri.includes("#")
  || parsed.pathname === "/" || parsed.pathname.slice(1).includes("/")) invalid("MFA setup");
let label: string;
try { label = decodeURIComponent(parsed.pathname.slice(1)); } catch { invalid("MFA setup"); }
if (!label.startsWith("UVH:") || label.slice(4).trim() === "" || /[\u0000-\u001f\u007f]/.test(label)) invalid("MFA setup");
return { secret, uri };
```
- [x] Mantener prefixotpauth://totp exacto del contrato existente, authority sin port/userinfo, sin fragment yun solo pathsegment (percentencoded caracteres de email permitidos). DecodeURIComponent fallido rechaza; labelUVH:cuenta no vacía. Decidir bound sólo con evidencia del emisor/costo QR, no introducir límite arbitrario sin caso.
- [x] No modificar AccountMfa transport/Authreconciliation/Settingspolicy si la frontera del decoder resuelve el defecto reproducido. Comprobar controls de success/QRfallback y teardown/replacement.

### Task 3: verificación y evidencia
**Files:** inventario/ledgers/matriz/reportes/planning persistentes.
- [x] Nuevas regresiones y suites Auth/Settings/MFA; fullfrontend/lint/types/build. Si hay DOM nuevo, skill agent-browser/QA con fixture propia y tecladomóvil; si no hay DOM, contrato de estado/render en TestBed con límites explícitos.
- [x] Actualizar inventario/rebasar anchors yverificar hashes; conservar PHPsnapshot sólo si PHP sin cambios. No declarar nuevo backend/providergate desde frontend.
- [x] BugID sólo tras rojo material; distinguir disponibilidad/consistencia UI de authorizationbypass. Registrar escenarios/results/gates ylímites; objetivo/S01–S13 activo, error exportstatus yresto de auditoría aún abiertos.

## Resultado local verificado
B163/P2 corregido sin cambios de transporte/política/DOM/PHP. Rojo35/83 fallos;54 controles nuevos,242 dedicadas/1179 full frontend; lint/tipos/build8,049s exit0. Emisor real3 payloads exactos/100 formatos, hashes473/anchors353S01+16S03+63S10+61S02 y comparación4 facade preservados. Evidencia y límites completos en reporte O34. Proyecto/S01–S13 permanecen abiertos.

## Next Step
Caracterizar el error de consulta de exportaciones en Settings: todavía candidato sin ID. Plan siguiente2026-10-04-settings-export-observation.md; resto de auditoría, CI/operación/proveedores permanece activo.
