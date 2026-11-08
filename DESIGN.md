---
name: Fantasy MotoGP — Independiente
description: "Fantasy de MotoGP propio y multi-liga, con una economía justa: base fija + carry limitado, sin ratchet."
colors:
  starting-light-red: "#e10600"
  starting-light-red-deep: "#b30500"
  starting-light-red-text: "#ff4438"
  pit-night-blue: "#0b0f14"
  telemetry-screen: "#10151c"
  track-line-gray: "#21262d"
  sign-white: "#e6edf3"
  timing-gray: "#8b949e"
  flag-green: "#3fb950"
  flag-red: "#f85149"
  warning-amber: "#d29922"
  info-blue: "#58a6ff"
  on-accent-white: "#ffffff"
typography:
  display:
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif'
    fontSize: "1.75rem"
    fontWeight: 700
    lineHeight: 1.5
  headline:
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif'
    fontSize: "1.1rem"
    fontWeight: 700
    lineHeight: 1.5
  title:
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif'
    fontSize: "1rem"
    fontWeight: 700
    lineHeight: 1.5
  subhead:
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif'
    fontSize: "0.9rem"
    fontWeight: 600
    lineHeight: 1.5
  body:
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif'
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif'
    fontSize: "0.9rem"
    fontWeight: 400
    lineHeight: 1.5
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "0.85rem"
    fontWeight: 400
    lineHeight: 1.4
rounded:
  sm: "5px"
  md: "6px"
  lg: "8px"
spacing:
  xs: "0.3rem"
  sm: "0.5rem"
  md: "0.9rem"
  lg: "1rem"
  xl: "1.25rem"
components:
  button-primary:
    backgroundColor: "{colors.starting-light-red}"
    textColor: "{colors.on-accent-white}"
    rounded: "{rounded.md}"
    padding: "0.65rem 1rem"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.starting-light-red-deep}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.sign-white}"
    rounded: "{rounded.md}"
    padding: "0.65rem 1rem"
    height: "44px"
  cta-link:
    backgroundColor: "{colors.starting-light-red}"
    textColor: "{colors.on-accent-white}"
    rounded: "{rounded.md}"
    padding: "0.6rem 1rem"
  card:
    backgroundColor: "{colors.telemetry-screen}"
    textColor: "{colors.sign-white}"
    rounded: "{rounded.lg}"
    padding: "0.9rem 1rem"
  input:
    backgroundColor: "{colors.telemetry-screen}"
    textColor: "{colors.sign-white}"
    rounded: "{rounded.md}"
    padding: "0.55rem 0.7rem"
    height: "44px"
  tab:
    backgroundColor: "{colors.telemetry-screen}"
    textColor: "{colors.sign-white}"
    rounded: "{rounded.md}"
    padding: "0.45rem 0.9rem"
    height: "44px"
  tab-active:
    backgroundColor: "{colors.starting-light-red}"
    textColor: "{colors.on-accent-white}"
    rounded: "{rounded.md}"
    padding: "0.45rem 0.9rem"
    height: "44px"
  alert-warning:
    backgroundColor: "rgba(210, 153, 34, 0.1)"
    textColor: "{colors.warning-amber}"
    rounded: "{rounded.md}"
    padding: "0.6rem 0.8rem"
  alert-info:
    backgroundColor: "rgba(88, 166, 255, 0.1)"
    textColor: "{colors.info-blue}"
    rounded: "{rounded.md}"
    padding: "0.6rem 0.8rem"
  alert-error:
    backgroundColor: "rgba(248, 81, 73, 0.1)"
    textColor: "{colors.flag-red}"
    rounded: "{rounded.md}"
    padding: "0.6rem 0.8rem"
  row-action:
    backgroundColor: "transparent"
    textColor: "{colors.starting-light-red}"
    rounded: "{rounded.sm}"
    padding: "0.15rem 0.5rem"
---

# Design System: Fantasy MotoGP — Independiente

## Overview

**Creative North Star: "El Muro de Boxes"**

Este sistema es lo que ve el muro de boxes a las once de la noche: pantallas de telemetría oscuras donde cada píxel se gana su sitio y un solo rojo que solo se enciende cuando algo va a pasar. Fantasy MotoGP — Independiente es una superficie de operación — leer el mercado, componer un lineup contra el reloj, auditar por qué una puntuación es la que es — y el mundo visual sigue esa lógica: oscuridad para reducir el ruido, rojo como señal, datos legibles bajo presión de tiempo. El carácter es **preciso y operativo**: nervio de competición contenido, cero espectáculo.

El sistema es **plano por convicción**: sin sombras, sin degradados, sin cristales esmerilados. La profundidad procede de una escalera de superficies (azul noche de boxes → pantalla de telemetría) separada por filetes de 1 px. La densidad es calmada: una sola columna de 56 rem, interlínea 1.5 y canales generosos; lo que no cabe en pantalla se desliza dentro de su contenedor, nunca ensancha la página. Todo se renderiza con la pila de fuentes del sistema: cero fuentes licenciadas, cero imágenes de marca (compromiso duradero del producto: identidad propia, sin MotoGP).

Anti-referencia confirmada: la estética de casino y apuestas con neones —el producto no tiene apuestas con dinero real— y el desorden gráfico de las retransmisiones deportivas. La única jugada expresiva es **la palabra roja**: cada título de página destaca exactamente una palabra en rojo de salida.

**Key Characteristics:**
- **Plano por convicción:** sin sombras ni degradados; la profundidad es escalón de superficie + filete de 1 px.
- **Rojo como señal, nunca como decoración:** acciones, enlaces, foco y una palabra del título; nada más.
- **Datos primero:** tablas y desgloses legibles; lo ancho se desliza dentro de su contenedor.
- **Mano sobre el móvil:** objetivos táctiles ≥ 44 px y ritmo vertical de 0.3/0.5/0.9/1/1.25 rem.
- **Semántica estricta:** verde de bandera = bien/sube; rojo de bandera = error/baja; gris de cronometraje = ausencia.

## Colors

Paleta de un solo acento: una voz roja de escasez deliberada sobre una familia de neutros fríos de noche de boxes, con cuatro colores semánticos reservados al estado.

### Primary
- **Rojo de salida** (#e10600): el color de acción del producto. Enciende botones primarios, CTAs de tarjeta, enlaces, la pestaña activa, el contorno de foco (2 px), los checkboxes y la palabra marcada de cada título. Su escasez es el punto: si una pantalla se ve roja, algo va mal.
- **Rojo de salida profundo** (#b30500): solo el estado hover del relleno primario. Nunca en reposo.
- **Rojo de salida en texto** (#ff4438): la variante aclarada del acento para texto pequeño (enlaces, acciones fantasma de fila). El rojo sólido no alcanza 4.5:1 sobre el lienzo nocturno; esta variante sí (AA). Los rellenos, los bordes de foco y la palabra roja de los títulos (texto grande) siguen en rojo de salida.

### Secondary
- **Verde de bandera** (#3fb950): confirmaciones de éxito y deltas positivos (tendencia «Sube», ▲). Nunca decorativo.
- **Rojo de bandera** (#f85149): errores, deltas negativos (▼) y estados cerrados (lockout). Más claro y menos saturado que el rojo de salida para que «estado» nunca se confunda con «acción».
- **Ámbar de aviso** (#d29922): alertas de advertencia (lockout próximo, condiciones que exigen atención).
- **Azul informativo** (#58a6ff): alertas informativas (puntuación provisional, resultados actualizados).

### Neutral
- **Azul noche de boxes** (#0b0f14): lienzo de la aplicación; el fondo de todas las páginas.
- **Pantalla de telemetría** (#10151c): superficie elevada — tarjetas, inputs, pestañas, chips de navegación. Un solo escalón sobre el lienzo.
- **Gris de pista** (#21262d): filetes de 1 px — bordes, celdas de tabla, divisores. Nunca como texto.
- **Blanco de letrero** (#e6edf3): texto principal.
- **Gris de cronometraje** (#8b949e): texto secundario, etiquetas de formulario, cabeceras de tabla, estados vacíos.
- **Blanco puro** (#ffffff): solo texto sobre rellenos rojos.

### Named Rules
**La Regla de la Señal.** El rojo de salida significa acción o marca, nunca decoración: como máximo un relleno rojo protagonista por región de pantalla y una palabra roja por título. Su rareza es el mensaje.
**La Regla del Tinte 10/40.** Los fondos de alerta son el color de estado al 10% de opacidad con borde del mismo color al 40% (rgba(…, 0.1) / rgba(…, 0.4)); el color sólido del estado aparece solo como texto.
**La Regla de la Pareja Semántica.** Verde y rojo solo cargan significado (bien/error, sube/baja); el gris de cronometraje marca la ausencia («Consultando…», «—», «sin posición»). Ninguno de los tres decora.

## Tokens (F2)

Cada color de la paleta vive **una sola vez** — en el bloque `:root` de `app/globals.css` — y el resto del CSS solo referencia el token (cero hex fuera de ese bloque; verificado por grep). Renombrar la paleta o el rojo de marca es cambiar ese bloque, no buscar hex por el archivo:

| Token | Paleta | Uso |
|---|---|---|
| `--bg` | azul noche de boxes | lienzo; scrim del diálogo de confirmación (70%) |
| `--surface` | pantalla de telemetría | tarjetas, inputs, pestañas, chips, diálogo |
| `--border` | gris de pista | filetes de 1 px y bordes de tabla |
| `--fg` | blanco de letrero | texto principal |
| `--muted` | gris de cronometraje | texto secundario, etiquetas, cabeceras |
| `--accent` | rojo de salida | rellenos primarios, foco, pestaña activa, checkboxes |
| `--accent-text` | rojo de salida en texto | texto rojo pequeño (AA) |
| `--accent-deep` | rojo de salida profundo | solo hover del relleno primario |
| `--on-accent` | blanco puro | texto sobre rellenos rojos |
| `--ok` / `--bad` / `--warning` / `--info` | verde / rojo de bandera, ámbar, azul | estados, deltas, alertas |

La Regla del Tinte 10/40 se **deriva** por `color-mix(in srgb, var(--estado) 10% o 40%, transparent)`: una sola fuente de color; cambiar el token cambia el tinte con él. La escala tipográfica (1.75 / 1.1 / 1 / 0.9 rem, más 0.85 mono y 0.8 de cabecera) está cerrada: ni CTA (0.9 rem) ni pestaña (0.9 rem) introducen un nivel propio.

## Typography

**Display Font:** pila del sistema (system-ui, -apple-system, "Segoe UI", sans-serif)
**Body Font:** la misma
**Label/Mono Font:** ui-monospace, SFMono-Regular, Menlo, Consolas, monospace (solo editores JSON y payloads crudos)

**Character:** una sola familia sin licencias; la personalidad «deportiva, moderna, profesional» (compromiso confirmado) se construye con peso, contraste y la palabra roja — no con tipografías exóticas. La mono aparece únicamente donde hay que leer datos crudos.

### Hierarchy
- **Display** (700, 1.75 rem, interlínea 1.5): títulos de página (h1) y nada más; cada título marca exactamente una palabra en rojo de salida.
- **Headline** (700, 1.1 rem): encabezados de sección (h2).
- **Title** (700, 1 rem): títulos de tarjeta (h3) y pasos del ritual.
- **Subhead** (600, 0.9 rem): encabezados de bloque dentro de una sección (h4).
- **Body** (400, 1 rem, interlínea 1.5): todo el texto de lectura; la medida ya la controla la columna de 56 rem.
- **Label** (400, 0.9 rem, gris de cronometraje): etiquetas de campo, anotaciones secundarias y el nivel h5 (que nunca cae por debajo del texto de lectura).
- **Table header** (600, 0.8 rem, gris de cronometraje, sin salto de línea): cabeceras de columna.
- **Mono** (400, 0.85 rem, interlínea 1.4): editores de reglas JSON y payloads.

### Named Rules
**La Regla de la Palabra Roja.** Todo h1 destaca exactamente una palabra con el acento («Fantasy MotoGP *Independiente*», «Inicia *sesión*»). Una palabra: nunca dos, nunca el título entero.
**La Regla del Peso Cerrado.** Solo existen tres pesos: 400 (lectura y etiquetas), 600 (acciones y cabeceras de tabla) y 700 (títulos). No se introduce ningún otro.

## Layout

Una sola columna centrada (`main`, 56 rem / 896 px de ancho máximo) con canales de 1.25 rem a los lados y 2.5/4 rem de respiro vertical. Mobile-first: el uso dominante es móvil y el diseño no tiene ni una media query — la fluidez procede de `auto-fit`, `minmax(16 rem, 1 fr)` y `flex-wrap`. El dashboard se abre en rejilla de tarjetas (1 columna en un teléfono de 375 px, 3–4 en escritorio); formularios y filtros son columnas flexibles con gaps de 0.9 rem; pestañas y navegación ancla envuelven en lugar de desbordar.

El ritmo de espaciado es cerrado: 0.3 rem dentro de un campo (etiqueta → input), 0.5 rem entre alertas o pestañas, 0.9 rem entre campos, 1 rem de gap de rejilla y de padding de tarjeta, 1.25 rem de canal de página. Las tablas anchas (8 columnas) se deslizan horizontalmente dentro de su contenedor; el documento nunca supera el ancho del viewport. En el panel admin, la navegación ancla es fija arriba (top 0, z-index 10).

### Named Rules
**La Regla de los 44.** Todo control interactivo mide ≥ 44 px de alto (botones, pestañas, inputs, selects): el flujo central debe poder operarse con una mano en un iPhone SE de 375 px.
**La Regla del Scroll Contenido.** Una tabla que no cabe se desliza dentro de su propia caja (overflow-x: auto); nunca ensancha la página — un desborde horizontal en móvil desplaza los puntos de clic fuera de sus controles.
**La Regla de la Columna Única.** Una columna centrada de 56 rem: las secciones se apilan en vertical y solo la rejilla del dashboard se abre en varias columnas.

## Elevation & Depth

Cero sombras en todo el sistema. La profundidad se cuenta en escalones de superficie (azul noche de boxes → pantalla de telemetría) y filetes de 1 px de gris de pista; los fondos tintados al 10% señalan estado, no altura. El único momento «elevado» es el foco: contorno de 2 px en rojo de salida con 1 px de separación — visible y sin distorsionar el layout.

### Named Rules
**La Regla Plana.** Ningún box-shadow, ningún degradado, ningún glow. Si algo debe destacar, cambia de escalón de superficie o de color de borde; nunca de altura.

## Shapes

Lenguaje de formas de panel de instrumentos: rectángulos redondeados contenidos; nada de píldoras, círculos ni esquinas vivas. Tres radios y solo tres: 5 px para las acciones fantasma de fila, 6 px para todos los controles (botones, inputs, pestañas, chips, alertas) y 8 px para los contenedores (tarjetas, listas de estado, navegación ancla). Los bordes son filetes de 1 px de gris de pista que dibujan cada superficie sin pesadez.

### Named Rules
**La Regla de los Tres Radios.** 5/6/8 px y nada más: ni 0 px ni píldora. La forma se reconoce antes que el color.

## Components

### Buttons
- **Shape:** redondeado suave (6 px), alto mínimo 44 px.
- **Primary:** relleno rojo de salida, texto blanco puro (1 rem / 600), padding 0.65 rem 1 rem.
- **Hover / Focus:** el hover profundiza a rojo de salida profundo (#b30500); el foco es contorno de 2 px del acento con 1 px de separación. Deshabilitado = opacidad 0.6 + cursor no permitido, y **siempre** acompañado del motivo escrito (compromiso de marca: nunca un control bloqueado sin explicación). Con motivo escrito el bloqueo usa `aria-disabled` —el botón sigue en el orden de foco para que el motivo se anuncie—; en estados transitorios sin motivo, `disabled` nativo.
- **CTA de tarjeta:** el mismo relleno como enlace en bloque (0.9 rem / 600 — Subhead, la escala está cerrada y el CTA no introduce un nivel propio — padding 0.6 rem 1 rem): la acción principal de cada tarjeta del dashboard.
- **Row action (fantasma):** sin relleno, texto y borde de 1 px en rojo de salida (5 px de radio); el hover aplica un tinte del acento al 12%.
- **Secondary (neutra):** sin relleno, filete de 1 px de gris de pista, texto blanco de letrero (6 px de radio, alto mínimo 44 px). Es la opción segura de los diálogos de confirmación («No, volver») — nunca lleva el acento.

### Tabs
Chips redondeados (6 px) en fila flexible. Inactivo: pantalla de telemetría + filete de gris de pista. Activo (`aria-pressed="true"`): relleno rojo de salida con texto blanco. Alto mínimo 44 px; la fila envuelve sin desbordar.

### Cards / Containers
- **Corner Style:** 8 px.
- **Background:** pantalla de telemetría.
- **Border:** filete de 1 px de gris de pista.
- **Shadow Strategy:** ninguna (ver Elevation & Depth).
- **Internal Padding:** 0.9 rem 1 rem.
- **Título (h3) — Title (P2-1, global F3):** regla GLOBAL de `h3` (1 rem/700, margen 1.25 rem arriba / 0.5 rem abajo), igual en los títulos de tarjeta, los pasos de ritual y los h3 sueltos de las páginas sin tarjetas (Resultados, Lineups, Ligas, Mercado): un nivel, un tamaño, un ritmo con más aire arriba que abajo. Los pasos de ritual mantienen su override propio (`.ritual-step > summary > h3`, mayor especificidad). El detalle va en h4 (Subhead).

### Inputs / Fields
- **Style:** etiqueta (0.9 rem, gris de cronometraje) → input (relleno pantalla de telemetría, filete gris de pista, 6 px, padding 0.55 rem 0.7 rem, alto mínimo 44 px) → error (0.85 rem, rojo de bandera).
- **Focus:** contorno de 2 px en rojo de salida con 1 px de separación. Los checkboxes se tiñen con el acento (`accent-color`).
- **Error / Disabled:** el error es por campo y en línea; el error global va en caja tintada 10/40 (ver Colors).

### Alerts
Cuatro variantes con la misma anatomía (padding 0.6 rem 0.8 rem, radio 6 px, texto 0.9 rem): error (caja tintada de rojo de bandera), advertencia (ámbar de aviso), información (azul informativo) y éxito (caja tintada de verde de bandera). Las cajas siguen la Regla del Tinte 10/40.

### Confirmación con impacto
Para acciones irreversibles o que reescriben datos: un diálogo plano (superficie de pantalla de telemetría, filete de 1 px, radio 8 px, máx. 26 rem) sobre el lienzo atenuado. El título nombra la acción; el impacto escrito va como texto (o en aviso tintado 10/40 si es irreversible); dos controles y solo dos: «Sí, …» (relleno rojo de salida — la acción se nombra en el botón, nunca «Aceptar») y «No, volver» (secondary). El foco abre en la opción segura; Esc y el clic fuera descartan. Sustituye a cualquier diálogo nativo.

### Lists & Tables
- **Status list:** sin caja interior (P3-2) — el contenedor (card, diálogo) ya pone el fondo y el borde; la lista solo separa filas con filetes de 1 px (padding 0.6 rem, `li:last-child` sin filete). Es el patrón de datos de todo el producto (versiones de reglas, historial de precios, estado de servicios, estados de evento).
- **Tables:** cuerpo 0.9 rem, celdas con filete, cabeceras 0.8 rem/600 en gris de cronometraje; la tabla se desliza dentro de un wrapper `.table-scroll` (overflow-x) que preserva la semántica de `<table>`. Área de toque de los checkboxes por el label envolvente (≥ 44 px, Regla de los 44).
- **Anchor nav (admin):** barra fija de chips de superficie (6 px) cuyo borde se enciende en rojo al pasar el cursor, agrupada por fases de trabajo (Carrera → Mercado → Temporada → Sistema) con etiquetas de fase en gris de cronometraje (no son enlaces). El chip de la sección en vista lleva `aria-current="location"` y se señala con el acento (texto + borde en rojo de salida, peso 600): un scroll-spy por `IntersectionObserver` (holgura de 80 px, igual que el `scroll-margin-top` de los destinos) responde a «¿dónde estoy?» en una página de ~10.600 px; sin `IntersectionObserver` la nav sigue funcionando por anclas, sin acento activo.
- **Altas colapsadas (admin):** los formularios de creación viven en un `details` («Altas y configuración») con el mismo control de 44 px que los pasos del ritual: el panel prioriza la lectura sobre el CRUD.
- **Estados de evento (admin):** una fila por evento en `ul.status` (nombre del evento + acciones de esa fila dentro del `li`); la distinción cancelado/neutralizado se explica en una línea de ayuda **antes** de la acción, no solo dentro del diálogo.
- **Utilidades de composición (P3-1):** `.inline`, `.stack` (grid, gap 1 rem), `.spaced` (margen superior 0.5 rem) y `.action-row` (fila de acciones, gap 0.75 rem). El valor vive en `globals.css`, no en estilos inline del JSX.

### Signature: la palabra roja y las flechas de estado
El título de cada página marca una palabra en rojo de salida, y el estado se narra en línea con la pareja semántica: «Sube/Baja/Estable» en verde/gris/rojo y los deltas de posición con ▲/▼. Es la voz del muro de boxes: señal escasa, dato legible.

## Estado

**F1 cerrada (2026-11-06):** panel `/admin` — el lenguaje de esta página ya es el del sistema completo; la ola de cierre añadió la confirmación con impacto, la consola del fin de semana, la línea de ayuda de cancelar/neutralizar, los estados de evento por fila, la jerarquía h3 del preview de mercado, el scroll-spy robusto (`useScrollSpy` con `enabled`, late-mount) y la capa de ayuda de vocabulario (P0, lockout, carry, Pmax, rv-N en su primera aparición). Re-evaluación dual-agent: 31/40 → 36/40 (0 anti-patterns). Historial de snapshots en `.impeccable/critique/`.

**F2 cerrada (2026-11-06):** el sistema vive ahora en tokens — `:root` de `globals.css` es la única fuente de verdad de la paleta (13 tokens, cero hex fuera del bloque) y los tintes 10/40 se derivan por `color-mix` del token de estado; escala tipográfica cerrada a 1.75/1.1/1/0.9 rem (CTA y pestaña a Subhead, 0.9 rem). Ver sección «Tokens».

**Siguiente:** F3 (llevarlo a las páginas restantes: `/mercado` → `/lineups` → `/resultados` → `/puntuacion` → `/ligas` → `/` + `/perfil` → auth), mismas puertas de calidad y sin romper las reglas de esta página.

## Do's and Don'ts

### Do:
- **Do** mantener el rojo escaso: una acción primaria por región de pantalla y una palabra roja por título.
- **Do** explicar por escrito todo control bloqueado o deshabilitado (motivo de bloqueo explícito y accionable).
- **Do** construir la profundidad con la escalera de superficies (lienzo → pantalla de telemetría) y filetes de 1 px antes que con cualquier otro recurso.
- **Do** respetar los ≥ 44 px de alto en controles y el ritmo de 0.3/0.5/0.9/1/1.25 rem.
- **Do** dejar que los datos anchos se deslicen dentro de su contenedor.
- **Do** usar los colores semánticos solo para su semántica (pareja verde/rojo/gris de ausencia).
- **Do** redactar la UI, los errores y los motivos de rechazo en español (compromiso del producto).

### Don't:
- **Don't** añadir sombras, degradados, glassmorphism ni glow: el sistema es plano por convicción.
- **Don't** usar la estética de casino/apuestas con neones (anti-referencia confirmada) ni lenguaje visual de juego con dinero real.
- **Don't** rellenar grandes áreas con el rojo de acento ni usar verde/rojo decorativamente.
- **Don't** introducir radios de píldora, círculos ni esquinas de 0 px: la escala es 5/6/8 px.
- **Don't** renderizar tablas más anchas que el viewport ni ensanchar el documento en móvil.
- **Don't** usar branding, logos ni datos licenciados de MotoGP (compromiso duradero: identidad propia).
- **Don't** introducir tipografías de pago o licenciadas: la pila del sistema es deliberada.
