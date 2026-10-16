# Fantasy MotoGP — Independiente

> Un juego de fantasy de MotoGP **propio** (sin licencias ni APIs oficiales), jugable en cualquier navegador, **multi-liga**, con una economía diseñada para ser **justa y transparente**.
>
> **Estado:** Fase 0 cerrada; **Fase 1 en curso** — US-01 (registro/login), T-20 (cabeceras de seguridad + CORS), US-02 (cierre de sesión + recuperación de contraseña), T-08 (RBAC + autorización por recurso), T-09 (auditoría append-only) y US-04 (temporadas + reglas versionadas, panel admin) ya están en producción (imagen `2a2d497`, 2026-10-17). `docs/` sigue siendo la fuente de verdad de las reglas; `app/` contiene el monolito (Next.js) con los módulos puros `economy`/`scoring`, los módulos `identity` y `seasons` y la UI de registro/login/recuperación + panel admin. El código que existe hoy, archivo a archivo: [`docs/architecture/estado-actual.md`](docs/architecture/estado-actual.md).

## Resumen ejecutivo

**El producto.** Cada Gran Premio, cada jugador compone un lineup (2 pilotos oro + 2 plata + 1 constructor + 1 equipo) con presupuesto limitado. El lineup puntúa según el rendimiento real de pilotos, constructor y equipo; los puntos se acumulan por GP y por temporada. Un usuario juega en varias ligas a la vez con el mismo lineup.

**La ventaja central: economía justa.** El juego oficial usa un presupuesto acumulado (ratchet): el valor de tu equipo determina tu presupuesto del siguiente GP. Quien tiene activos que suben, compra mejor; quien tiene activos que bajan, entra en espiral de la muerte. Este producto rompe el ratchet: **cada GP arranca con una base fija (B=100, PROVISIONAL) + carry limitado** (`min(25% del dinero sin usar, 8)`). La ventaja la da la lectura del mercado, no la suerte de resultados previos.

**Evidencia (simulación con datos ficticios, `economy.md` §7):**

| Métrica                                            | Oficial (ratchet)              | Recomendado (base + carry)       |
| -------------------------------------------------- | ------------------------------ | -------------------------------- |
| 2 jugadores con mismo arranque (coste 69, cap 100) | terminan con cap **89 vs 103** | ambos terminan en **108**        |
| Peor arranque (P4): recuperación media GP4–6 / GP1 | **0.83** (no recupera)         | **1.08** (recupera y supera)     |
| Gini de riqueza final                              | **0.0653**                     | **0.0412** (37% más igualitario) |

**Evidencia (simulación con datos reales 2026, `simulacion-2026.md`):** con 40 jugadores simulados sobre la temporada real, el modelo oficial deja **36/40** jugadores por debajo del 90% de la base en algún GP (26/40 terminan por debajo; Gini final 0.063); la opción E deja **0/40** (Gini 0.001). Explicación no técnica: `por-que-opcion-e.md`.

**Puntuación.** Tablas versionadas por temporada (`scoring-vN`), sin doble conteo, oro 100% / plata 50%, constructor y equipo puntúan por media de sus 2 mejores pilotos. Ejemplo completo verificado: un lineup puntúa **170.5** en un GP con sprint (`scoring.md` §5). Resultados provisionales → definitivos con **recálculo auditable y versionado**.

**Ligas.** Privadas (código) y públicas (directorio) en el MVP; de amigos, temporales y personalizadas en post-MVP. Las reglas de juego son **globales** por temporada (los puntos son comparables); por liga varían solo miembros, visibilidad y permisos. Multi-liga con un único lineup por GP.

**Datos.** Sin dependencias de licencias: el núcleo solo conoce un **contrato de fuente de resultados** (adapter). MVP: **PulseLive** (API pública, verificada en vivo) + **entrada manual** (siempre disponible). Producción: fuente licenciada (p. ej. Sportradar) como otro adapter.

**Arquitectura.** Monolito modular: TypeScript + Next.js + PostgreSQL + Prisma + Zod + tRPC + BullMQ. Los módulos `economy` y `scoring` son **fórmulas puras** (sin I/O), implementadas y testeadas antes de cualquier UI. Todo lo que afecta a puntos o presupuesto es versionado y auditable.

**MVP (~14 semanas).** Flujo completo: registro → liga → lineup → resultados → ranking, con resultados manuales + PulseLive, lockout server-side, transfers, multi-liga y panel de admin. Diferido: streaming en vivo, fuente licenciada, ligas avanzadas, notificaciones, OAuth, i18n.

**Riesgos principales y decisiones pendientes.** Los valores numéricos (B, carry, tablas de puntuación, Pmax, límites de concentración, transfers, min/máx de liga) son **PROVISIONAL** y se calibran antes del lanzamiento (tareas `D-xx` del backlog, con re-simulación como puerta: Gini < 0.05, recuperación > 0.95, diversidad > 70%). Riesgo de datos: PulseLive puede cambiar o bloquearse → mitigado con adapter + entrada manual.

## Mapa de documentos

| Documento                            | Qué contiene                                                                                                                                                    |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                          | Instrucciones operativas para agentes (módulos, invariantes, versionado, puertas de calidad)                                                                    |
| `CONTRIBUTING.md`                    | Cómo colaborar: quickstart local, comandos, convenciones, Definition of Done, cómo tomar trabajo del backlog                                                    |
| `docs/product/vision.md`             | Propuesta de valor, diferenciación, principios, métricas, riesgos                                                                                               |
| `docs/product/game-rules.md`         | Reglas de juego: composición 2+2+1+1, presupuesto, precios, transfers, lockout, invariantes                                                                     |
| `docs/product/economy.md`            | **Documento central:** problema del ratchet, opciones A–E, modelo recomendado, fórmula de precios, simulaciones                                                 |
| `docs/product/economia-guia.md`      | Guía accesible de `economy.md`: glosario, opciones en lenguaje claro, motor de precios paso a paso, GP completo, calibración                                    |
| `docs/product/simulacion-2026.md`    | Comparación A/B/C/E sobre la temporada 2026 real (PulseLive): puerta T-15, trayectorias por GP, casos nombrados                                                 |
| `docs/product/por-que-opcion-e.md`   | Explicación no técnica: por qué la opción E supera al modelo oficial (ejemplos con datos reales 2026)                                                           |
| `docs/product/scoring.md`            | Tablas de puntuación versionadas, bonos/penalizaciones, ejemplo 170.5, casos límite                                                                             |
| `docs/product/leagues.md`            | Tipos de liga, invitaciones, permisos, min/máx, rankings, desempates, privacidad, anti-abuso                                                                    |
| `docs/product/user-flows.md`         | Flujos de usuario y pantallas (~18), mobile-first                                                                                                               |
| `docs/product/mvp.md`                | Alcance del MVP, diferimientos, criterios de aceptación                                                                                                         |
| `docs/architecture/estado-actual.md` | **El código que existe hoy** (estado por fase, mapa del repo, módulos implementados, invariantes, puertas de calidad)                                           |
| `docs/architecture/overview.md`      | Stack, módulos, flujo de datos, transacciones/concurrencia                                                                                                      |
| `docs/architecture/data-model.md`    | Esquema relacional (PostgreSQL), constraints, fuente de verdad vs derivado                                                                                      |
| `docs/architecture/integrations.md`  | Contrato `ResultsSource`, fuentes evaluadas (PulseLive/Sportradar/comunitarias/manual), pipeline                                                                |
| `docs/architecture/security.md`      | Amenazas y controles, RBAC, auditoría, GDPR, backups                                                                                                            |
| `docs/architecture/testing.md`       | Capas de testing (7), casos límite, ejemplos verificables, puertas de CI                                                                                        |
| `docs/decisions/0001…0010`           | ADRs: stack, economía, puntuación, fuente de datos, ligas, monolito, pipeline de resultados, cabeceras de seguridad/CORS, email provisional, bootstrap de admin |
| `docs/roadmap.md`                    | Fases 0–5 + post-MVP, hitos, camino crítico                                                                                                                     |
| `docs/backlog.md`                    | Epics, user stories, tareas técnicas, dependencias, prioridades, criterios de aceptación verificables                                                           |

## ¿Quieres colaborar?

- **Para empezar a construir:** lee [`CONTRIBUTING.md`](CONTRIBUTING.md) — quickstart local en 6 comandos, tabla de comandos, convenciones, Definition of Done y cómo tomar trabajo del backlog.
- **Para entender el código que ya existe:** [`docs/architecture/estado-actual.md`](docs/architecture/estado-actual.md) (estado por fase, mapa del repo, módulos implementados, dónde vive cada invariante).
- **El trabajo pendiente** está en [`docs/backlog.md`](docs/backlog.md) (IDs, prioridades, dependencias, criterios de aceptación verificables).

## Orden de lectura recomendado

1. `AGENTS.md` (si eres un agente) o `docs/product/vision.md` (contexto).
2. `docs/product/game-rules.md` → `docs/product/economy.md` (el corazón) → `docs/product/scoring.md`.
3. `docs/product/leagues.md` → `docs/product/user-flows.md` → `docs/product/mvp.md`.
4. `docs/architecture/estado-actual.md` (el código de hoy) → `docs/architecture/*` (el diseño) → `docs/decisions/*`.
5. `docs/roadmap.md` → `docs/backlog.md` (para empezar a construir) → `CONTRIBUTING.md` (quickstart).

## Método

Planificación en 6 fases: inspección → investigación → diseño de producto → diseño técnico → planificación → revisión crítica de consistencia. Cada decisión relevante sigue el formato: problema → opciones → pros/contras → recomendación → justificación → impacto → riesgos → validación (ver ADRs).
