# O72 — Confirmaciones y estado incierto de tokens

Alcance parcial S07/S13. Conservar O71, sus 35 casos y la separación gradual de auth; no cerrar sistema ni objetivo global por este lote.

1. Leer TokenController::destroy, transporte/decoder y consumidor; registrar contrato exacto `{ok:true}`.
2. Reproducir con HTTP real simulado la falsa confirmación con cuerpos malformados y decisiones sobre registro anterior tras una respuesta incierta.
3. Reutilizar el decoder existente; distinguir ACK válido de resultado desconocido, conservar secreto sin confirmación y bloquear decisiones hasta un GET posterior válido.
4. Verificar recuperación tras GET válido/fallido, contexto saliente y errores definitivos, sin repetir writes automáticamente.
5. Ejecutar suite dirigida, completa, build/lint/tipos; actualizar evidencia y siguientes funciones pendientes. Validar visualmente cualquier aviso modificado con build ficticio local si es necesario.

Sin cuentas, DB, mail, proveedores, migraciones, worker, control compartido, panel ajeno, agentes, commit o despliegue.

Pendiente separado: proyección de usuario/factor tras emisión incierta; no afirmación de bypass backend. Inspeccionar después sin ampliar flags por conjetura.

## Resultado verificado

B256/P2: cualquier HTTP200 se aceptaba como ACK; seis cuerpos malformados reproducen falsa revocación y un caso muestra retirada indebida del secreto. Se pasa el decoder estricto existente a DELETE; sólo `{ok:true}` autoriza el overlay, mensaje de éxito y retirada del secreto. No se crea un decoder paralelo ni se cambia backend.

B257/P2: un resultado incierto dejaba apto para decidir el registro anterior. Revocación0/502 y creación con DTO inválido invalidan sólo GET anteriores y requieren una lectura posterior válida. Un error en ese GET no libera la decisión; un GET válido determina activo/revocado sin repetir el write. El aviso persistente se aplica tanto a una emisión confirmada con lectura pendiente como a un resultado desconocido; no afirma creación tras DELETE.

14 casos adicionales, 12 rojos históricos y dos controles que ya pasaban; los35casos O71 se conservan literalmente antes del cierre del describe. Suite dirigida70/70, full1710/1710, build8,499s/lint/tipos0. El full incluye las comprobaciones finales DOM del aviso, botón Actualizar habilitado y Revocar bloqueado. Handle82722 red1,10855 dirigido0,44236 full0,84075 gates0. Primer intento84298 sólo ejecutó35casos previos tras un error de ruta al editar; no se cuenta como rojo.

QA del build en loopback8561/browser propio uvh-ux-o72: nueve estados,1440/390/320 y ambos temas para resultado incierto, GET fallido/recuperado y creación incierta. Sin overflow document/main; controles completamente visibles≥44px. Se confirma que ACK malformado no muestra éxito, el aviso permanece tras GET fallido y GET válido confirma revocado. Dos comandos ficticios (DELETE1, POST1); no API/DB/proveedor real. Primera navegación a/panel/tokens fue un error del harness corregido a/app/tokens según rutas, sin comandos. QA73471/exit0; browser cerrado0 y fixture95212 detenido voluntariamente130.

841fuentes de partida/actuales,838previas intactas. Únicamente TS/HTML Tokens y su spec extendido cambian;124specs previos ajenos intactos. PHP241hashes intactos; E2E no se modifica ni ejecuta. Inventario503/2439named/1326anonymous/3signatures/0owner provisional, enumeración distinta de revisión. Fuente/build/manifests: `.uvh-runtime/o72-token-ack/`; O71 permanece congelado.

Lectura por función: `create` reutiliza invalidación de registro para la incertidumbre; `requireRegistryRefresh` cancela sólo readers/retira loading y fija refresh pendiente; `revoke` decodifica ACK antes de efectos y conserva contexto/slot/snapshot ante fallo; `load` libera refresh sólo con DTO válido posterior propio. `ApiService.delete/mutate/request/decodeResponse` transporta decoder y traduce fallo de forma a502 sin cuerpo sensible. `decodePublicActionAcknowledgement` exige objeto y booleantrue, descarta keys ajenas. `TokenController.destroy` verifica actor/editor/workspace bajo TX y responde `{ok:true}` tras commit; `store` persiste recovery_codes al usar recovery en step-up. `MfaStepUp.verify` devuelve remaining sin persistirlo: lo hace el controlador. No ejecución de backend ni certificación completa de estas dependencias.

S07/S13/global continúan abiertos. Próximo: reproducir proyección de usuario/factor tras emisión incierta; inspeccionar también si la lectura que confirma revocación retira adecuadamente un secreto ya entregado. Son candidatos, sin nuevo BugID/reproducción aún. Seguir Auth/frontend público, estado público, TX exterior/CSV y CI/operación/release real. Esta QA no acredita Firefox, lector de pantalla ni producción.
