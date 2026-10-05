# O39 — Gradual separation of account export transport

Después de verificar O38, extraer sólo transporte de los seis métodos Auth de exportación. Árbol compartido/secuencial, sin delegación/worktree/commit. Preservar los contratos reparados B165–B174 y no sumar un nuevo BugID a una extracción compatible.

1. Caracterizar fachada con HTTP/API/interceptor/decoders reales antes de extraer: status/history/request/download/ACK/cancel, method/path/body/credentials/account header sin tenant, options/abort,20s/45s/120s, JSON/Blob, errors sin replay, un retry CSRF y retiro de intención tras cambio durante bootstrap. Respuestas ya enviadas deben seguir vivas; respuesta vieja no entrega datos ni cambia la cuentaB observada legítimamente.
2. Guardar los seis cuerpos completos de Auth y sus expresiones API. El módulo AccountDataExportService devuelve envelopes/Blob/ACK validados, no owns user/generation/flags/navigation/workspace ni timers. API compartida conserva scope/CSRF/timeout. Auth mantiene signature/contextcaptured/assertCurrent/return, adaptando sólo llamada. Mover sólo imports decoder que queden sin otros callers; importPublicACK sigue en Auth mientras borrado de cuenta lo use.
3. Comparar literalmente los seis métodos después de adaptar sólo expressionAPI, repetir contratos ycallers. Bypass del facade por tests no prueba ownership; tests de transporte sólo complementan controles Auth/caller.
4. Gates dedicados/full frontend/lint/tipos/build e inventario/anchors/matriz/reportes. No DOM/DB/PHP nuevo; no repetir backend por esta extracción. Si aparece fallo material, reproducir antes de fix yreescribir alcance del plan según evidencia.
5. Objetivo/S01–S13 siguen abiertos. Después continuar outerdispatch y funciones/sistemas/roles/retención/operación restantes; no refactor grande ni ahorro de SQL/latencia atribuido.


Verificación O39: pasos1–4 ejecutados,68 caracterizaciones previas/269dedicado/1312full9,777sKarma9,187sexec/lint/tipos/build8,940s exit0.6facade+4sessions+3backendTX exactos salvo llamadas/context previamente adaptado.474hashes/131S02anchors conciliados; sin nuevoBugID. Paso5 mantiene el objetivo global abierto y continúa outerdispatch en plan propio.
