# UVH · Landing de producto 2026

## Objetivo

La landing debe explicar que UVH no es sólo un acortador: es una superficie
operativa para crear, dirigir, proteger y medir enlaces. La conversión sigue
siendo una única tarea —pegar una URL— y el acceso nunca rompe esa intención.

## Arquitectura narrativa

1. **Cabecera compacta:** producto, control, operación y seguridad; una acción
   primaria y un menú móvil desplegable, no un panel lateral.
2. **Hero de tarea:** propuesta de valor, consola de URL y vista previa del
   borrador. El mensaje de persistencia durante 24 horas aparece junto al campo.
3. **Mapa de producto:** cuatro responsabilidades verificables: crear, dirigir,
   proteger y medir.
4. **Cockpit interactivo:** tres vistas —publicación, reglas y analítica— que
   enseñan contratos reales del producto sin métricas inventadas.
5. **Control de recorrido:** reglas por país, idioma, dispositivo, sistema,
   horario, referente y campaña, con destino alternativo y prioridad.
6. **Operación:** dominios, roles, API tokens, webhooks, estados y actividad.
7. **Continuidad y seguridad:** intención opaca, sesiones HttpOnly, CSRF,
   verificación de email, hCaptcha oficial y MFA.
8. **FAQ y cierre:** respuestas concretas y vuelta directa a la consola.

No se muestran precios, testimonios, logos de clientes, porcentajes de mejora
ni volúmenes que no procedan de una API real.

## Sistema visual

- **Dirección:** software operativo premium; superficies amplias, densidad
  controlada y detalles de producto reconocibles. La decoración nunca compite
  con la tarea.
- **Claro:** lienzo `#f4f7fb`, superficies blancas, tinta `#07111f`, azul
  eléctrico y teal. Las secciones oscuras se reservan al hero y a seguridad.
- **Oscuro:** lienzo `#07101d`, superficies `#0d1828` y `#111f33`, bordes azul
  gris y texto frío. Cada sección tiene una variante explícita; no se invierten
  colores mediante filtros.
- **Tipografía:** Manrope local, títulos con tracking negativo y cuerpo entre
  15 y 18 px. La longitud de línea se mantiene entre 55 y 75 caracteres.
- **Retícula:** ancho máximo de 1240 px; espaciado vertical de 88–136 px en
  escritorio y 64–88 px en móvil; radios de 14, 20 y 28 px.

## Cabecera, tema y menú móvil

- La cabecera usa tokens propios para ambos temas y permanece legible sobre
  cualquier sección. Al hacer scroll reduce su altura y aumenta la opacidad.
- El selector de tema es una acción circular en escritorio y muestra etiqueta
  en el menú. Sol y luna se cruzan con rotación y escala; el estado se expone
  con `role="switch"` y `aria-checked`.
- El menú móvil cae bajo la cabecera como una hoja de navegación a ancho útil.
  El mismo botón hamburguesa abre y cierra; no existe un segundo cierre
  redundante. Fondo, foco, Escape, scroll y estado `inert` se gestionan de forma
  explícita.

## Movimiento y accesibilidad

- Duraciones de 160–360 ms con curvas de desaceleración; sólo se animan
  `opacity`, `transform`, color y sombra.
- Hover eleva como máximo 2–4 px. Los paneles interactivos conservan geometría
  para evitar saltos de layout.
- `prefers-reduced-motion: reduce` elimina entradas, pulsos y transformaciones.
- Objetivos táctiles de al menos 44 px, foco de alto contraste, landmarks,
  títulos jerárquicos, estados anunciados y navegación completa por teclado.

## Criterios de aceptación

- El destino nunca aparece en la URL de autenticación; sólo viaja el token
  opaco y se recupera después del acceso.
- Landing y menú funcionan a 360, 768, 1024, 1280 y 1440 px sin overflow.
- Todas las superficies mantienen contraste y coherencia en claro y oscuro.
- La vista interactiva puede operarse con ratón y teclado y comunica su estado
  mediante `aria-selected`.
- TypeScript estricto, build y pruebas Angular terminan sin errores.
