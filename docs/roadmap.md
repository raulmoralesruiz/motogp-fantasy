# Roadmap

> Estado: BORRADOR v1 (fase 5). Fases con dependencias. El MVP (fase 3) es el hito principal.

## Fase 0 — Fundaciones (semana 1–2)
**Objetivo:** repo, stack, CI/CD, y los módulos puros testados.
- [ ] Bootstrap del repo (TypeScript, Next.js, PostgreSQL, Prisma, Zod, tRPC, BullMQ).
- [ ] CI/CD (GitHub Actions): lint, typecheck, tests, build, deploy.
- [ ] Estructura de módulos (ver `architecture/overview.md` §3).
- [ ] **Módulo `economy` puro** + tests de unit (fórmulas de presupuesto y precios).
- [ ] **Módulo `scoring` puro** + tests de unit (tablas, bonos, oro/plata, constructor/equipo).
- [ ] Migraciones iniciales (schema base).
- [ ] Spike de integración (Testcontainers + una transacción).
**Dependencias:** ninguna.
**Hito:** los módulos puros (el corazón del producto) están implementados y testeados antes de escribir UI.

## Fase 1 — Identidad y temporada (semana 2–4)
**Objetivo:** usuarios, temporadas, GPs, mercado.
- [ ] Registro/login + sesiones + roles (identity).
- [ ] Panel de admin: crear temporada, GPs, circuitos, eventos.
- [ ] Mercado: pilotos, constructores, equipos, afiliaciones por GP.
- [ ] Precios: P0 + fórmula versionada + histórico.
- [ ] Permisos y auditoría básicos.
**Dependencias:** Fase 0.
**Hito:** el admin puede montar una temporada con mercado y precios.

## Fase 2 — Lineups y economía en juego (semana 4–7)
**Objetivo:** el flujo central de juego.
- [ ] Constructor de lineup (2+2+1+1) con validación server-side.
- [ ] Presupuesto (base + carry) + movimientos + validación de coste.
- [ ] Lockout server-side por GP.
- [ ] Transfers (2/GP + exención + wildcard) + historial de cambios.
- [ ] Mercado (UI): lista, detalle, histórico de precios.
- [ ] Dashboard (próximo GP, presupuesto, ranking).
**Dependencias:** Fase 1.
**Hito:** un usuario puede colocar y cambiar su lineup dentro del presupuesto, con lockout correcto.

## Fase 3 — Resultados y puntuación (semana 7–10)
**Objetivo:** cerrar el bucle de juego.
- [ ] Pipeline de resultados (adapter PulseLive + manual; idempotente; provisional→definitivo).
- [ ] Recálculo auditable versionado.
- [ ] Puntuación por lineup (motor scoring) + desglose.
- [ ] Rankings por GP y general.
- [ ] Pantallas de resultados y ranking.
**Dependencias:** Fase 2.
**Hito:** un GP completo: resultados → puntos → ranking, con recálculo auditable.

## Fase 4 — Ligas (semana 10–12)
**Objetivo:** multi-liga y social.
- [ ] Ligas privadas (código) y públicas.
- [ ] Invitaciones + seguridad de código.
- [ ] Permisos admin/miembro; unirse/salir/expulsar.
- [ ] Rankings por liga (GP y general) + desempates.
- [ ] Directorio de ligas públicas + liga de bienvenida.
- [ ] Multi-liga (mismo lineup, varias ligas).
**Dependencias:** Fase 3.
**Hito:** dos usuarios en la misma liga compiten por GP y por temporada.

## Fase 5 — MVP: endurecimiento y lanzamiento (semana 12–14)
**Objetivo:** calidad, seguridad, y lanzamiento.
- [ ] Suite de tests completa (unit/integración/contrato/e2e/carga/seguridad).
- [ ] Revisión de seguridad (IDOR, fuerza bruta, inyección, presupuesto).
- [ ] Backups + prueba de restore.
- [ ] Monitoreo (Sentry + métricas).
- [ ] Re-simulación económica con parámetros finales (Gini < 0.05).
- [ ] Responsive móvil verificado.
- [ ] Documentación de operaciones.
**Dependencias:** Fase 4.
**Hito (MVP):** criterios de aceptación de `product/mvp.md` §5 cumplidos.

## Post-MVP (seguimiento)
- **Fase 6:** Fuente licenciada (Sportradar) + backfill histórico.
- **Fase 7:** Ligas temporales/personalizadas + notificaciones.
- **Fase 8:** Estadísticas avanzadas + analítica.
- **Fase 9:** Características demand-driven (torneos, draft, API pública).

## Dependencias críticas (camino de la muerte)
```
Fase 0 (módulos puros) → Fase 2 (lineups/economía) → Fase 3 (resultados/puntuación) → Fase 4 (ligas) → Fase 5 (MVP)
```
- **Los módulos puros (Fase 0) son el prerequisito de todo:** si economy/scoring no están testeados, no se construye UI sobre ellos.
- **El pipeline de resultados (Fase 3) bloquea las ligas (Fase 4):** no hay ranking sin puntos.

## Riesgos de planificación
| Riesgo | Mitigación |
|---|---|
| Los módulos puros tardan más | Son el corazón; se priorizan y se testean primero (no se posponen) |
| PulseLive falla en desarrollo | La entrada manual está disponible desde Fase 3 |
| Alcance del MVP crece | El criterio de `mvp.md` es fijo; lo demás va a post-MVP/demand-driven |
