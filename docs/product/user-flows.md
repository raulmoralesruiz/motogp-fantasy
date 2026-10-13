# Flujos de Usuario y Pantallas

> Estado: BORRADOR v1 (fase 3). Se definen **flujos antes que componentes**. Identidad visual propia (deportiva, moderna, profesional), sin marcas licenciadas.

## 1. Flujos principales

### 1.1 Registro e inicio de sesión
1. El usuario se registra con email + contraseña (o OAuth si se habilita).
2. Elige un **nombre de usuario** (seudónimo público, único).
3. Acepta términos y política de privacidad.
4. Se crea su perfil y se le coloca en una **liga de bienvenida** (pública) para que no empiece solo.
5. **Onboarding:** tutorial de 3 pasos (cómo es un lineup, cómo funciona el presupuesto, cómo colocar el primer lineup).
- **Meta:** <2 min hasta el primer lineup.

### 1.2 Construir un lineup (flujo central)
1. El usuario entra al **constructor de lineup** para el próximo GP.
2. Ve su **presupuesto disponible** (base + carry) y el **coste actual** del lineup en tiempo real.
3. Elige 4 pilotos (designa 2 oro / 2 plata), 1 constructor, 1 equipo.
4. El constructor de lineup muestra **siempre**:
   - **Presupuesto restante** (y en rojo si se excede).
   - **Precio actual** de cada activo + **tendencia** (sube/baja/estable) y **mini-histórico**.
   - **Cambios restantes** para este GP.
   - **Motivo de bloqueo** si no puede guardar (p. ej. "excede presupuesto", "lockout activo", "límite de cambios agotado", "2 pilotos del mismo constructor").
5. Al guardar, el **servidor** revalida todo (composición, coste, lockout, límites) y confirma o rechaza con motivo.
6. Confirmación: "Lineup guardado para GP X. Cambios restantes: N."

### 1.3 Ver el mercado
1. El usuario abre el **mercado**: lista de pilotos/constructores/equipos con precio, tendencia, histórico, estadísticas.
2. Puede filtrar por constructor/equipo/rango de precio.
3. Ve el **histórico de precios** de cada activo (gráfico).
4. Ve quiénes lo tienen (opcional, según privacidad) y la **concentración** (popularidad).

### 1.4 Unirse a una liga
1. El usuario tiene un **código de liga** (o encuentra una pública en el directorio).
2. Introduce el código / pulsa "unirse".
3. El servidor valida: código válido, hay plaza, la liga acepta entradas, no está ya dentro.
4. Confirmación: "Te has unido a [liga]. Eres el nº N."
5. Si falla: motivo explícito ("código inválido", "liga llena", "ya eres miembro").

### 1.5 Ver resultados y ranking
1. Tras cada GP, el usuario ve su **desglose de puntos** (por piloto, constructor, equipo, bonos, penalizaciones).
2. Ve el **ranking por GP** y el **ranking general** de cada liga.
3. Ve su posición y el delta respecto al GP anterior.
4. Si hubo **recálculo**, ve un aviso "Resultados actualizados" con el histórico (anterior → nuevo).

### 1.6 Cambiar lineup (transfers)
1. El usuario modifica su lineup antes del lockout.
2. Ve los **cambios restantes** y cómo cada cambio afecta al coste.
3. El servidor valida y descuenta el cambio.
4. Historial de cambios visible (auditable por el usuario).

### 1.7 Admin (gestión)
- **Temporadas/GPs:** crear temporada, añadir GPs, circuitos, eventos.
- **Precios:** fijar P0, revisar/ajustar precios (manual, auditado), ver fórmula.
- **Reglas:** versionar reglas de puntuación y economía por temporada.
- **Participantes:** gestionar usuarios, sanciones, eliminaciones.
- **Ligas:** supervisar ligas, cerrar abusivas.
- **Resultados:** importar (automático o manual), marcar provisionales/definitivos, forzar recálculo.
- **Auditoría:** ver log de acciones sensibles.

## 2. Listado de pantallas (~18)

| # | Pantalla | Propósito |
|---|---|---|
| 1 | Registro / Login | Acceso |
| 2 | Onboarding (tutorial) | Primeros pasos |
| 3 | Dashboard / Home | Resumen: próximo GP, presupuesto, ranking, avisos |
| 4 | Constructor de lineup | Componer/guardar lineup (flujo central) |
| 5 | Mercado (lista) | Explorar activos, precios, tendencias |
| 6 | Detalle de activo | Histórico de precio, estadísticas, quiénes lo tienen |
| 7 | Mi lineup (detalle) | Ver lineup actual, coste, cambios restantes |
| 8 | Historial de cambios | Transfers realizados |
| 9 | Ligas (mis ligas) | Lista de ligas del usuario |
| 10 | Detalle de liga | Ranking, miembros, configuración (si es admin) |
| 11 | Unirse a liga (código) | Flujo de unión |
| 12 | Directorio de ligas públicas | Descubrir ligas |
| 13 | Crear/gestionar liga (admin) | Configurar liga |
| 14 | Resultados del GP | Desglose de puntos por activo |
| 15 | Ranking por GP / general | Posiciones |
| 16 | Calendario de GPs | Temporada, próximos eventos, estado |
| 17 | Perfil / ajustes | Datos, privacidad, eliminación de cuenta |
| 18 | Panel de admin | Gestión global (temporadas, precios, reglas, resultados, auditoría) |

## 3. Patrones de UX transversales

- **Mobile-first:** el constructor de lineup y el dashboard deben ser usables en una mano.
- **Estado siempre visible:** presupuesto, coste, cambios restantes y lockout son visibles en cualquier pantalla de lineup.
- **Motivos de bloqueo explícitos:** nunca un botón "desactivado" sin explicación; siempre un motivo accionable.
- **Feedback de servidor:** toda acción sensible (guardar lineup, unirse a liga, cambiar) muestra el resultado de la validación server-side.
- **Avisos de recálculo:** si un resultado se corrige, el usuario ve un aviso claro y el histórico.
- **Accesibilidad:** contraste, tamaño de toque ≥44px, navegación por teclado en escritorio.
- **Idioma:** español por defecto (extensible).

## 4. Flujos de error y borde

| Situación | Comportamiento |
|---|---|
| Guardar lineup que excede presupuesto | Rechazo server-side + motivo "excede presupuesto por X" |
| Guardar durante lockout | Rechazo + "el GP ya está cerrado" |
| Agotar cambios | Rechazo + "no te quedan cambios; usa tu wildcard" |
| Código de liga inválido | Rechazo + "código no válido" |
| Liga llena | Rechazo + "la liga está llena" |
| Resultado corregido | Aviso + histórico anterior→nuevo |
| GP cancelado | Aviso "GP cancelado, 0 puntos" |

## 5. Decisiones pendientes

- Si el onboarding incluye una liga de práctica con bots.
- Si el directorio de ligas públicas permite búsqueda por nombre/etiquetas.
- Densidad de información en el constructor de lineup (mínimo vs detalle).
