# Estrategia de Testing

> Estado: BORRADOR v1 (fase 4).

## 1. Filosofía

- **Las reglas de juego son el producto.** La economía y la puntuación se testean como **fórmulas puras** (unit), con ejemplos de entrada/salida verificables.
- **La integridad es no negociable:** presupuesto, lineup, idempotencia y autorización se testean en integración (BD real).
- **Cada regla versionada tiene tests de regresión** para esa versión.

## 2. Capas de testing

### 2.1 Unit (fórmulas puras) — Vitest

- **Economía:**
  - `presupuesto(gp) = B + min(t·sin_usar_previo, cmax)`.
  - Motor de precios (fórmula v1): objetivo, suavizado, acotaciones, lesión.
  - **Ejemplo verificable:**
    - Entrada: `B=100, t=0.25, cmax=8, sin_usar_previo=8` → Salida: `presupuesto=102`.
    - Entrada: `sin_usar_previo=40` → `carry=min(10,8)=8` → `presupuesto=108` (tope aplicado).
    - Precio: `P0=20, prev=20, W=50` → `objetivo=20·(0.75+0.25)=20` → `precio=20`.
    - Lesión: `P0=20, prev=20` → `precio=max(5,10)=10`.
- **Puntuación:**
  - Tablas Q2/sprint/GP, bonos, penalizaciones, oro/plata, constructor/equipo (media top-2).
  - **Ejemplo verificable** (el del §5 de `scoring.md`): lineup {A,C oro; E,H plata; X; X-team} → **170.5 puntos**.
  - Sin doble conteo: un DNF puntúa 0 posición + (−5) una sola vez.
- **Validación de lineup:** composición 2+2+1+1, coste ≤ presupuesto, concentración.
- **Desempates de ranking.**

### 2.2 Integración (BD + transacciones + authz) — Testcontainers (PostgreSQL real)

- **Presupuesto:** guardar un lineup que excede presupuesto → rechazado; el presupuesto no se puede inyectar desde el cliente.
- **Idempotencia:** importar dos veces el mismo resultado → no duplica (unique `(gp,event,rider)`).
- **Recálculo:** corregir un resultado → recalcula el GP, conserva histórico, misma `rules_version`.
- **Lockout:** intentar cambiar tras el cierre → rechazado (aunque dos intentos concurrentes).
- **Concurrencia:** dos cambios simultáneos sobre el mismo lineup → uno falla o se serializan correctamente (sin sobre-pasar límites).
- **Authz:** un usuario no puede gestionar la liga de otro; un no-admin no accede al panel; un miembro no expulsa.
- **Multi-liga:** un usuario en 2 ligas → mismos puntos por GP en ambas.
- **Migraciones:** las migraciones se aplican en orden y son reversibles donde aplique.

### 2.3 Contrato (fuentes de datos)

- **Adapter de PulseLive:** con fixtures grabadas (responses reales anonimizados) → normaliza correctamente; maneja errores/timeouts; idempotente.
- **Mapeo de identidades:** `riderRef → riders.id` correcto; "sin mapear" se detecta.
- **Cada fuente** implementa el mismo contrato (tests de contrato comunes).

### 2.4 E2E (flujos de usuario) — Playwright

- **Registro → primer lineup** (<2 min, flujo completo).
- **Unirse a liga por código** (y casos de error: código inválido, llena).
- **Construir y guardar lineup** (con validación de presupuesto visible).
- **Ver resultados y ranking** tras un GP (con fixture de resultados).
- **Admin:** crear temporada, importar resultados, marcar definitivo, ver recálculo.
- **Mobile:** el constructor de lineup es usable en viewport de móvil.

### 2.5 Regresión (cambios de reglas)

- **Por versión de reglas:** cada `season_rules` (p. ej. `scoring-v1`, `economy-v1`) tiene un suite de tests que verifica sus tablas/fórmulas.
- **Golden files:** entradas/salidas conocidas por versión; un cambio de reglas debe actualizar el golden de forma explícita (revisión obligatoria).
- **Re-simulación económica:** antes de cada temporada, se re-ejecuta la simulación de `economy.md` con los parámetros propuestos y se verifican las métricas (Gini < 0.05, etc.).

### 2.6 Carga (lockout y cálculo)

- **Lockout:** N usuarios intentan guardar/cambiar en la ventana de cierre → ninguno se aplica tras el cierre; sin condiciones de carrera.
- **Recálculo:** importar resultados de un GP completo (todos los pilotos/eventos) → el recálculo termina en tiempo aceptable (PROVISIONAL: < 30 s para 1000 lineups).
- **Fin de semana de carrera:** carga sostenida de consultas de precios/rankings durante el evento.

### 2.7 Seguridad

- **Permisos:** suite que intenta acciones no autorizadas (IDOR: acceder a lineup/liga de otro) → todas rechazadas.
- **Fuerza bruta:** login y códigos de liga con rate-limiting → se bloquean.
- **Inyección:** inputs maliciosos en endpoints → sanitizados.
- **Presupuesto:** intentar inyectar coste/presupuesto desde el cliente → ignorado (se recalcula server-side).

## 3. Casos límite obligatorios

| Caso                                          | Capa        | Esperado                                      |
| --------------------------------------------- | ----------- | --------------------------------------------- |
| Lineup con coste exacto = presupuesto         | Unit/Integ  | Aceptado                                      |
| Lineup con coste = presupuesto + 0.01         | Unit/Integ  | Rechazado con motivo                          |
| Piloto reemplazado a mitad de temporada       | Integ       | Puntúa el que sale en ese GP                  |
| Resultado corregido (penalización posterior)  | Integ       | Recalcula + histórico                         |
| Dos lockouts simultáneos (carrera de cambios) | Carga/Integ | Solo se aplican los válidos antes del cierre  |
| Multi-liga (mismo lineup, 2 ligas)            | Integ       | Mismos puntos en ambas                        |
| Empate en ranking                             | Unit        | Desempates en orden definido                  |
| GP cancelado                                  | Integ       | 0 puntos, marcado cancelado, sin penalización |
| Sprint + GP (ambos puntúan)                   | Unit        | Se suman, sin exclusión                       |
| Piloto lesionado (no sale a varios GPs)       | Unit/Integ  | 0 puntos + precio cae por regla               |
| DQ posterior                                  | Integ       | Recalcula con −10                             |
| Non-starter                                   | Unit        | 0 sin penalización de DNF                     |

## 4. Cobertura y puertas de calidad (CI)

- **Cobertura mínima** (PROVISIONAL): 90% en `economy` y `scoring` (fórmulas puras); 70% global.
- **CI (GitHub Actions):** lint + typecheck + unit + integración (Testcontainers) + build en cada PR; e2e + carga en el main/nightly.
- **Bloqueo de merge** si falla lint/typecheck/unit/integración.
- **Golden files** de reglas versionadas como parte del repo (cambios revisados).

## 5. Datos de test

- **Fixtures** de resultados (anonimizados) para contrato e integración.
- **Dataset ficticio** (el de `economy.md`) para la simulación de equilibrio.
- **Nunca** datos reales de PII en tests.

## 6. Decisiones pendientes

- Umbrales exactos de cobertura.
- Frecuencia del suite de carga (nightly vs por release).
- Si se añaden property-based tests (p. ej. fast-check) para las fórmulas de economía/puntuación.
