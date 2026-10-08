# O73 — Step-up de tokens y secreto revocado

Alcance parcial S01/S07/S13; mantener revisión global y pendientes de Auth/frontend público, estado público, TX exterior/CSV y CI/operación/release.

1. Seguir persistencia del factor en TokenController/MfaStepUp hasta las proyecciones de AuthService, su coordinador de snapshots y Centro de seguridad.
2. Reproducir incertidumbre/vista saliente y lectura de token revocado con servicios/transporte/plantillas reales simulados.
3. Centralizar la invalidación de la cuenta por step-up en la fachada auth, antes de depender del lifetime del componente; conservar fronteras de identidad/epoch y no repetir write. Reutilizar la coordinación de snapshots existente.
4. Compartir limpieza del secreto; retirarlo sólo con revocación explícita/confirmada, conservarlo ante error o ausencia del token en una ventana de100. Verificar copia tardía y foco sin robarlo.
5. Ejecutar pruebas dirigidas/completas, build/lint/tipos y QA ficticia local del flujo afectado; documentar hashes/funciones/límites y siguiente acción.

No DB, cuentas, proveedores, correo, migraciones, worker, control compartido/panel ajeno, agentes, commit o despliegue. Los dos puntos comienzan como candidatos sin BugID ni afirmación de bypass.


## O73 — Proyección de cuenta y secreto revocado (08/10)

B258/P2: step-up puede consumir recovery antes deACK, pero la proyección no se invalidaba ante respuesta incierta/vista saliente ni reautenticación sinUserDTO. Auth.accountStepUp reutiliza confirmedMfaMutation/markUserProjectionStale/AuthUserMutations; fences account/epoch también tras destrucción o cambio de workspace. No nuevo coordinador ni flag de entrega de códigos (consumo no es emisión). Perfil/GET anterior no validan un contador viejo; /me posterior resuelve sin repetir write. B259/P2: registro explícitamente revocado dejaba secreto/copia/foco; clearIssued compartido lo retira sólo con prueba de revocación, respeta foco ajeno y no asume estado por ausencia en ventana100. No cancela efecto físico de clipboard ya pedido.

27casos nuevos/19rojos históricos,166dirigidos,1737frontend,build7,795s/lint/tipos0.11estados de QA ficticia,3writes sintéticos; primer waitURL fallido se reanuda en la misma sesión sin replay.842fuentes actuales/839previas intactas/125specs previos intactos; PHP241yE2E intactos. Inventario503/2441named/1330anonymous/3signatures/0provisional. Plan, funciones ylímites: `docs/superpowers/plans/2026-10-08-stepup-account-projection.md`; evidencia `.uvh-runtime/o73-stepup-projection/verify.py`. O72 congelado; S01/S07/S13/global activos. Sin backend/DB/proveedores/control compartido/panel ajeno/agentes/commit/deploy.

Prioridad nueva del usuario: rehacer copy/jerarquía visual del landing para ser comprensible yprofesional, empezando por hero; continuar después Auth/frontend público, estado público, TX exterior/CSV y CI/operación/release.

Fuentes por función: AuthService::confirmedMfaMutation169 (variante step-up sólo invalida proyección siMFA activado; captura account/epoch), accountStepUp458 (reutiliza coordinador existente), reauthenticateMfa470 (fence antes de retirar aviso privilegiado); publishUser/readIdentity/markUserProjectionStale/AuthUserMutations.run e identityRead conciliados parcialmente. TSAuthSHA25692ad28a093fe3eab0854969c879e70bd2849baf3f9aa5ceb316d6a3309409dbc. Tokens::load171 (revocación explícita, no omisión), finishIssued221/clearIssued228 (cleanup compartido+ticket), create280 (step-up global antes de publicar vista), revoke343 (cleanup sóloACK válido), constructor (contexto/destrucción). TSTokensSHA2567fc5329f850fe06f8488a1d8883634a934a21ce57117a2d5b3c93527d0c243a9.

Backend sólo leído: TokenController::store/destroy, MfaStepUp::verify, ReauthenticationAdmission::admit y MfaSessionController::mfaReauthenticate persisten/retornan después deTX; no nuevo gate SQL. ReauthenticationAdmissionSHA256593642f14ec2f89cedac640bdaccc93942425ada0680a23b45da869df7e08168; MfaSessionControllerSHA256dd6e3fbde32c4a80f37b1146ed5d5e230c1ad27756282cfdf3e2324264fec4a4. Métodos/dependencias completos no quedan certificados por esta lectura parcial.

Terminales: red41796/1(19fallos/8correctos); primera23casos69294/1(16/7);green47272/0(166); full85036/0; gates63716/0; QA inicial37952/1(waitURL35s) yresume7009/0(11estados acumulados/3writes totales); browserclose0 yfixture81371 detenido130. Vista inicial+3capturas conservadas, no repetir comandos. QA1440/390/320 claro/oscuro, secreto entregado/revocación incierta/GETrevocado yCentro con cuenta pendiente/GETfallido/recovery decontador9→7. Nooverflow, controles visibles≥44px. El harness registra foco real tras GET; casos nativos controlan foco dentro de sección retirada y enActualizar. NoFirefox/lector de pantalla/producción acreditados. Errores de rutas yglobs en lecturas se corrigen con rg del árbol, separados de bugs producto.
