# O74 — Landing comprensible y profesional

El usuario pide una mejora considerable, especialmente frases del hero que expliquen UVH sin metáforas. Mantener alcance global abierto y priorizar esta petición.

## Dirección visual y copy

Paleta existente: papel #f5f2e9, superficie #fffcf5, tinta #262821, texto secundario #626357, acento #b53c20 y fondo auxiliar #e5e8dc. Tema oscuro ya compartido con el sitio. Manrope400–800 para títulos/texto; monospace sólo en URLs, sin cursivas editoriales ni etiquetas crípticas.

Hero: título «Acorta tus enlaces. Actualiza su destino.», explicación breve yformulario juntos a la izquierda; ejemplo interactivo de una dirección constante con dos destinos a la derecha. En móvil mismo orden deDOM, formulario antes de ejemplo. A continuación beneficios concretos, casos de uso, tres pasos para empezar, trabajo con equipo/integraciones, FAQ yCTA coherente.

```
marca / casos / cómo empezar / equipos / entrar
título + explicación       ejemplo interactivo
formulario URL             enlace → destino editable
beneficios concretos
casos de uso / cómo empezar / equipos / FAQ / preparar enlace
```

Revisión de la propuesta: la paleta permanece porque forma parte de la web existente, pero se eliminan tickets girados/barcode, tipografía diminuta, numeraciones decorativas ymetáforas. La pieza distintiva muestra la función real deUVH: cambiar destino conservando enlace. El formulario hace el primer paso concreto; no añade un dashboard ficticio, cifras comerciales, planes/precios ni testimonios.

1. Capturar referencia inicial de hero/flujo yconservar842hashes.
2. Reescribir contenido yjerarquía completa; conservar información de permisos, alias/dominio, límites,privacidad yprotocolo de intención.
3. Rehacer layout responsive yritmo; targets≥44px, input16px móvil, foco visible, contraste ymotion reducido. Una entrada dehero +movimiento ligado a ejemplo/tabs/menu; evitar reveals repetidos en cada sección.
4. Verificar suite actual de landing ycalidad/build; sólo añadir controles funcionales si un cambio de comportamiento lo requiere. No tests que reflejen frases/CSS.
5. QA build ficticio local: ancho1440/1024/768/390/320, ambos temas, demo/tab/FAQ/menu/teclado/formulario/error/reduced-motion. Revisar capturas yreparar antes de entregar.

Sin API/DB/cuentas/mail/proveedores reales, control compartido/panel ajeno/agentes, commit o despliegue. No completar sistema ni objetivo global por este rediseño.

El usuario añade un wordmark UVH gigante en el footer. Se incorpora debajo de recursos y legal, con Manrope800, punto de marca y escala responsive. Es decorativo (`aria-hidden`), la marca accesible y la navegación siguen arriba.

## Implementación y comprobación

Hero con mensaje directo, formulario junto a la explicación y ejemplo local que conserva la dirección al cambiar el destino. En móvil el formulario precede al ejemplo también en el DOM. Se sustituyen metáforas por títulos descriptivos, beneficios concretos y tres pasos para empezar. Se mantiene la información sobre cuenta y email, intención de 24 horas, alias/dominio, permisos, reglas, límites y privacidad en los casos y FAQ.

Se rehacen tipografía, espaciado, pestañas, diagrama, bloque de equipo, preguntas y cierre. El footer incorpora el wordmark gigante «UVH.» solicitado después, con escala responsive y `aria-hidden` para no duplicar la marca accesible. Se actualizan título de ruta, descripción y Open Graph para eliminar el copy anterior también al compartir la web.

Se retira `installRevealObserver` y su inyección de host: una entrada del hero y movimiento ligado a acciones reemplazan los reveals repetidos por sección. `afterNextRender` conserva la lectura de progreso; el umbral de cierre del menú pasa a 1000 px para coincidir con CSS. URL, single flight, intención opaca en fragmento, navegación y teclas de pestañas se conservan. No nueva librería ni assets.

Las 126 especificaciones existentes permanecen intactas. Suite final: 1737/1737, Chrome Headless154, 13,754 s, handle24325 exit0. Build final: 7,998 s, handle50981 exit0; lint y TypeScript sin errores, handle24325 exit0. Fuentes: 842 en baseline, cinco cambios de producto, 837 previas intactas. Inventario de lectura: 503 archivos, 2440 funciones nombradas, 1327 anónimas, tres firmas, cero archivos provisionales. Es un índice de funciones, no una certificación de todo el proyecto.

Primer fixture tenía backlog insuficiente: dos recursos no llegaron, Zone ausente y NG0908. Doctor pasó siete comprobaciones; servidor y navegador propios se cerraron antes de reparar el fixture. No se cambió el bootstrap del producto. Primer QA encontró «Entrar» con ancho42,05 px; se corrigieron mínimos de44 px también en enlaces del pie. Logs fallidos conservados; no se presentó esa ejecución como éxito. Se repitió build/calidad tras corregirlo y añadir el wordmark. Búsquedas en rutas/globs inexistentes y primera edición desde cwd equivocado fueron errores de herramientas, sin cambios de producto.

Evidencia: `.uvh-runtime/o74-landing-clarity/`. O73 y sus manifiestos quedan congelados. Sin DB, cuenta, correo, proveedores, API real, scripts de control compartido, panel independiente, agentes, commit ni despliegue. El objetivo global y S01/S13 siguen abiertos.


QA final: 67 estados sobre el build final en Chromium154, cinco anchos (1440/1024/768/390/320), ambos temas, hero/producto/guía/equipo/FAQ/footer, demo, pestañas y FAQ por teclado, validación local, error de transporte, menú/Escape/foco/resize/CTA y movimiento reducido. Capturas finales se toman al acabar el cierre del menú y con animaciones finitas completadas; movimiento reducido se verifica contra la preferencia real del navegador. Geometría sin desbordamientos y controles visibles de al menos44px. Capturas de hero390/320 y wordmark1440/320 inspeccionadas visualmente. El formulario sólo produjo un POST sintético que respondió503; no se publicó ningún enlace ni se tocó una cuenta.

Agent-browser verificó36 estados entre ejecuciones, pero perdió la página a about:blank en dos esperas de cambio de tema. Se cerró su sesión propia y se usó Playwright como alternativa: los diagnósticos de tema/Escape al inicio y al final de la página dieron0. Su primer harness tuvo esperas de foco/tema y un selector de texto exacto que incluía la ligadura MatIcon; se corrigió el harness, sin cambiar el servicio de tema. Otro wait omitía display:none en escritorio; corregido. La captura de un menú cerrándose se retoma tras completar la transición. Un control adicional detectó marca móvil42px; se corrige a44px. Logs previos fallidos conservados, ningún write real ni replay de comandos sintéticos. Ejecución final completa y única: handle89639 exit0, 67 estados y un comando sintético, sin pageerrors. Playwright se cierra en finally, servidor propio30386 detenido deliberadamente exit130; sesión agent-browser cerrada0. Todos los procesos propios son terminales.

Verificador reproducible: `python3 .uvh-runtime/o74-landing-clarity/verify.py`. Alcance: rediseño local de landing, no certificación de backend, producción, todos los navegadores o cierre global. Próximas mejoras propuestas al usuario: navegación con sección activa, footer por grupos, feedback del formulario y pulido de interacciones; no se presentan como implementadas.

El primer verifier final detectó el hash SCSS anterior en el índice de funciones. Se regeneró con `review-source-inventory.mjs` (sólo lectura de producto) y se repitió: exit0. El manifiesto de producto y el build de QA ya eran actuales; ninguna fuente de producto cambió al reparar el índice.
