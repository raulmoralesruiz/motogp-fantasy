# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Jugador fan casual de MotoGP (primario):** juega con amigos desde el móvil durante el fin de semana de carrera; quiere entrar, montar su lineup y competir sin fricción. Meta del flujo: <2 min hasta el primer lineup; ~80% del uso es móvil (`docs/product/user-flows.md` §1, `docs/product/vision.md` §4.6).
- **Fan competitivo:** optimiza y analiza el mercado: historial de precios, métricas, reglas versionadas y recálculos auditables.
- **Organizador de liga:** controla su liga (reglas, precios, participantes, invitaciones) con panel de administración.
- **Jugador multi-liga:** unas fichas, varias ligas: el mismo lineup compite en todas sus ligas.

## Product Purpose

Fantasy MotoGP Independiente es un juego de fantasy de MotoGP propio, multi-liga y sin licencias ni APIs oficiales. Cada Gran Premio, cada jugador compone un lineup (2 pilotos oro + 2 pilotos plata + 1 constructor + 1 equipo) con un presupuesto limitado y compite en todas sus ligas con las mismas fichas. Existe para ofrecer una economía justa, estratégica y transparente en la que la ventaja procede de leer el mercado, no de la inercia de los resultados.

Estado y ambición (confirmado): proyecto indie público en producción, gratuito, con ambición de comunidad.

Éxito (norte, `docs/product/vision.md` §6): activación >60% (primer lineup tras el registro), retención semanal >30%, ligas activas >50, Gini de riqueza por GP <0.05, diversidad de lineups >70% y confianza en datos >95% de GPs definitivos sin recálculo manual.

## Positioning

Mecanismo diferenciador: el **modelo anti-ratchet** («Opción E»: base fija por GP + carry limitado). El juego oficial acumula presupuesto según el valor de mercado del equipo, lo que crea dependencia de trayectoria (quien arranca bien, sigue bien); aquí `presupuesto(gp) = B + min(t·sin_usar_previo, cmax)` (B=100, t=0.25, cmax=8) y el presupuesto **nunca** depende del valor de mercado del equipo: «la competencia se decide por estrategia de mercado, no por inercia de resultados» (`docs/product/vision.md` §2). Diferenciadores secundarios: transparencia total (un jugador puede explicar por qué su puntuación es la que es) y multi-liga con lineups compartidos.

Evidencia interna (fundamenta la decisión de diseño; no es una garantía universal de equilibrio): las simulaciones sobre la temporada 2026 real (`docs/product/simulacion-2026.md`, `docs/product/por-que-opcion-e.md`) muestran que el modelo oficial deja a 36/40 jugadores por debajo del 90% de la base en algún GP, frente a 0/40 con Opción E; Gini 0.063 frente a 0.001. Son datos de temporadas concretas que respaldan la elección del modelo, no una promesa de equilibrio para todas las temporadas.

## Operating Context

- **Roles:** `user` / `global_admin` (roles globales); el admin de liga vive en la pertenencia a la liga. Cada endpoint revalida la autorización por recurso.
- **Temporadas y reglas:** cada temporada declara `season_rules` (JSONB versionado: B, t, cmax, tablas de puntuación, límites). Las versiones publicadas nunca se mutan; los cambios se aplican solo a GPs futuros o mediante recálculo explícito y auditado.
- **Ritual de resultados:** importación (manual o automática por polling cada 5 min vía PulseLive) → provisional → el admin marca definitivo → recálculo con lock por GP. Las correcciones generan una nueva `results_version` con histórico: los resultados no se borran, se corrigen.
- **Auditoría:** `audit_log` append-only para acciones sensibles (precios manuales, reglas, resultados, recálculos, roles, ligas, 2FA).
- **Operación:** runbook de operaciones (importar resultados, marcar definitivo, recálculo, backups y restore con verificación periódica, incidentes, monitoreo y alertas — Sentry + email de ops —, rotación de secrets); despliegue pull en TrueNAS Scale (Docker/Portainer + Nginx Proxy Manager); notificaciones por email (Resend) con opt-out.

## Capabilities and Constraints

Capacidades confirmadas: registro/login (con 2FA TOTP opcional), perfil con exportación de datos y eliminación/anonimización de cuenta (GDPR), mercado (pilotos, constructores y equipos con precios por GP: fórmula versionada + ajuste manual auditado), constructor de lineups con lockout por GP, transfers (2 + exención + 1 wildcard), puntuación con desglose, resultados y rankings por GP y general con recálculos versionados, ligas privadas (por código) y públicas (directorio), permisos de admin/miembro, liga de bienvenida opcional y notificaciones por email.

Invariantes duras: lineup de exactamente 2 oro + 2 plata + 1 constructor + 1 equipo; coste ≤ presupuesto, siempre validado en el servidor; a lo sumo 1 lineup activo por usuario por GP; los puntos por GP de un usuario son iguales en todas sus ligas; constructor ≠ equipo (activos, precios y puntuación distintos; nunca intercambiables); importación idempotente; cada puntuación referencia `rules_version` + `results_version` (sin cambios retroactivos silenciosos).

Restricciones: producto, documentación, UI y mensajes **en español** (identificadores de código en inglés); **sin** branding, logos ni datos licenciados de MotoGP y sin depender de APIs privadas del juego oficial; sin apuestas con dinero real; los parámetros de reglas son configurables por temporada (nunca constantes mágicas); el servidor es siempre la fuente de verdad.

Hechos sin decidir (registrados como tales): modelo de ingresos — el juego es **gratuito**; se contempla la posibilidad de aceptar **donaciones voluntarias** en el futuro, pero no existe un modelo de monetización definido y no hay compromiso de funcionalidades premium ni de suscripciones; traducción a otros idiomas (el español es el idioma por defecto, «extensible»); estándar de accesibilidad formal (ver Accessibility & Inclusion).

## Brand Commitments

- **Nombre:** «Fantasy MotoGP — Independiente» (títulos de página, metadata y pie de emails).
- **Identidad visual (compromiso confirmado, sin expandir):** «deportiva, moderna, profesional» (`docs/product/user-flows.md` §3). Identidad propia, sin marcas ni logos licenciados. No existen logos ni assets de marca todavía (`public/` está vacío).
- **Voz de la UI:** mensajes, errores y motivos de rechazo en español; los motivos de bloqueo siempre explícitos y accionables (nunca un botón «desactivado» sin explicación).

## Evidence on Hand

- Dataset ficticio canónico (`test/fixtures/fiction/`): mercado de 11 pilotos / 4 constructores / 4 equipos, 6 GPs y 6 jugadores; simulación reproducible (`npm run simulate`).
- Golden files por versión de reglas (`economy-v1`, `scoring-v1`, `lineups-v1`); el lineup de ejemplo de referencia puntúa 170.5.
- Integraciones verificadas en vivo: fixtures de resultados PulseLive grabados en vivo (2026-10-21), calendario PulseLive verificado en vivo (2026-10-18) y envío de email (Resend) verificado en vivo.
- Datos reales de las temporadas 2025/2026 (`data/fixtures/`, `docs/product/simulacion-2026.md`) usados en la comparativa de modelos económicos.

Ausencias que el trabajo futuro **no debe fabricar:** testimonios, clientes o casos de éxito (no existen); datos o licencias de MotoGP; PII ni datos reales de usuarios en tests ni fixtures; proveedores de datos no verificados en vivo (Sportradar es una alternativa futura, no disponible); datos de simulación como predicción (el dataset ficticio es 100% ficticio salvo los datos explícitamente marcados como reales).

## Product Principles

1. **Justicia antes que complejidad.** Si una regla no puede explicarse en una frase, se simplifica. (`docs/product/vision.md` §4.1)
2. **Transparencia total.** Todo lo que afecta a puntos o presupuesto es visible y versionado; un jugador puede explicar por qué su puntuación es la que es. (§4.2)
3. **La ventaja procede de la estrategia de mercado, no de la inercia de los resultados.** El presupuesto nunca depende del valor de mercado del equipo (anti-ratchet). (§2)
4. **Reversibilidad.** Nada se pierde por un dato mal importado: los resultados no se borran, se corrigen y se versionan. (§4.3)
5. **El servidor manda.** Toda validación de presupuesto, lineup, lockout y permisos es server-side; el frontend es una vista. (§4.5)

## Accessibility & Inclusion

Requisitos confirmados (`docs/product/user-flows.md` §3, `docs/architecture/testing.md` §2.4): contraste suficiente, objetivos táctiles ≥44px y navegación por teclado en escritorio; diseño responsive (móvil/tablet/escritorio), verificado en viewports de 375/390/430 px (T-16). El estándar formal está **pendiente de decisión**: **WCAG 2.2 AA** es el objetivo recomendado, no un cumplimiento ya verificado.
