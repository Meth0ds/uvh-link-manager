# UVH · Especificación visual “Premium operativo”

## Principio rector

UVH convierte una intención en una acción terminada: pegar una URL, decidir su
recorrido y entender el resultado. La interfaz no debe simular actividad ni
prometer capacidades que el producto no presta.

## Fundamentos

- **Tono:** preciso, tranquilo y humano. Menos tarjetas decorativas; más
  jerarquía, espacio y estados útiles.
- **Color:** tinta como base, azul eléctrico para acciones y teal para estados
  positivos. El amarillo y rojo quedan reservados a estados operativos.
- **Tipografía:** Manrope para interfaz y cifras tabulares para métricas. La
  escala usa 12, 14, 16, 20, 28, 40 y 56 px; títulos compactos, textos con
  contraste suficiente y líneas de 1,45–1,65.
- **Espaciado:** retícula de 4 px, bloques de 16/24/32/48 px y radios de 12/20
  px. Las superficies se separan por borde y tono antes que por sombra.
- **Movimiento:** transiciones de 160–220 ms sólo para orientar cambios de
  estado. `prefers-reduced-motion` elimina animaciones no esenciales.

## Patrones compartidos

- **Consola de acción:** un campo dominante, feedback inmediato y una sola CTA
  principal. Landing y el diálogo de enlace usan el mismo orden mental.
- **Contexto persistente:** la intención de enlace, el workspace y el periodo
  activo se muestran cerca de la acción a la que afectan.
- **Datos honestos:** no se muestran porcentajes de cambio, objetivos o
  conversiones sin datos de API. Los vacíos explican el siguiente paso.
- **Estados operativos:** carga, vacío, error y éxito conservan la misma
  estructura en todos los módulos; los errores recuperables indican la acción
  concreta para continuar.
- **Accesibilidad:** foco visible, objetivos táctiles de 44 px, orden de
  teclado lógico, etiquetas explícitas y contraste WCAG AA en ambos temas.

## Pantallas

1. **Landing:** propuesta de valor, consola URL, flujo de continuidad,
   capacidades verificables, seguridad y CTA final. No incluye precios ni
   testimonios no atribuidos.
2. **Acceso:** una columna de confianza y un formulario de tarea. La tarjeta
   de URL pendiente se sitúa antes de cualquier decisión de acceso; login,
   registro, MFA, recuperación y verificación usan el mismo marco.
3. **Panel:** navegación de producto persistente, cabecera contextual y una
   superficie de trabajo amplia. El dashboard permite cambiar el periodo y
   prioriza clics, visitantes, serie, enlaces y procedencia.
4. **Módulos:** enlaces, analítica, dominios, integraciones, equipo, ajustes y
   administración comparten encabezado, barra de acciones, filas densas,
   chips de estado y formularios con divulgación progresiva.
