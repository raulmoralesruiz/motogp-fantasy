# MVP — Alcance de la primera versión

> Estado: BORRADOR v1 (fase 3/5). El MVP prioriza **justicia económica + transparencia + multi-liga** sobre cobertura en vivo y características de conveniencia.

## 1. Criterio del MVP

El MVP demuestra la **ventaja central** (economía justa y transparente) con el flujo completo de juego: registro → liga → lineup → resultados → ranking. Sin él, no hay producto; sin las características diferidas, sí lo hay.

## 2. INCLUIDO en el MVP

### Producto

- **Registro/login** con email+contraseña y nombre de usuario.
- **Una temporada** con N GPs (el admin los crea).
- **Lineup 2+2+1+1** con constructor ≠ equipo, oro/plata.
- **Economía recomendada (Opción E):** base fija + carry limitado, precios con fórmula versionada, histórico de precios.
- **Puntuación versionada** (tablas provisionales) para pilotos/constructor/equipo, con bonos y penalizaciones.
- **Lockout server-side** por GP.
- **Transfers** (2 por GP + exención por lesión + 1 wildcard).
- **Ligas:** privada (código) y pública; multi-liga; rankings por GP y general; min/máx miembros; admin/miembro; unirse/salir/expulsar.
- **Resultados:** importación **manual** por el admin (y automática si la fuente autorizada está disponible) + provisional→definitivo + recálculo auditable.
- **Dashboard, constructor de lineup, mercado, rankings, calendario, perfil.**
- **Panel de admin** básico (temporadas, GPs, precios, reglas, resultados, usuarios).
- **Responsive** (móvil/tablet/escritorio).

### Técnico

- Stack recomendado (ver `architecture/overview.md`): TypeScript, Next.js, PostgreSQL, ORM+migraciones, auth, validación compartida, API tipada, jobs en background, tests, CI/CD, monitoreo, secrets.
- **Validación server-side** de presupuesto/lineup/lockout.
- **Idempotencia** de importación de resultados.
- **Auditoría** de acciones sensibles.
- **Tests** de las capas críticas (economía, puntuación, validación, authz).

## 3. DIFERIDO (post-MVP, con justificación)

| Característica                                      | Razón del diferimiento                                                                                                    |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Cobertura en vivo (streaming)**                   | Complejidad alta (websocket, timing en vivo); el MVP importa por sesión. No es la ventaja central.                        |
| **Sportradar / proveedor licenciado**               | Requiere contrato/licencia; el MVP funciona con fuente pública + manual. Se añade como adaptador (ver `integrations.md`). |
| **Ligas temporales y personalizadas avanzadas**     | El MVP cubre privada + pública; los demás tipos reutilizan el mismo motor.                                                |
| **Notificaciones push/email**                       | Conveniencia; no bloquea el flujo central.                                                                                |
| **Chat / multijugador en tiempo real**              | Fuera del alcance del producto central.                                                                                   |
| **Estadísticas avanzadas / analítica de jugadores** | Value-add; el MVP muestra histórico de precios y puntos básicos.                                                          |
| **OAuth / SSO**                                     | El email+contraseña es suficiente para el MVP.                                                                            |
| **Modo espectador / ver lineups de otros**          | Privacidad por defecto; se habilita como opción.                                                                          |
| **i18n completo**                                   | El MVP es en español; la arquitectura permite añadir idiomas.                                                             |
| **App nativa**                                      | El PWA responsive cubre la necesidad; la app nativa es optimización posterior.                                            |

## 4. DEMAND-DRIVEN (solo si hay demanda)

| Característica                             | Señal de demanda                     |
| ------------------------------------------ | ------------------------------------ |
| Ligas con reglas de entrada a medida       | Peticiones de organizadores          |
| Torneos / eliminatorias                    | Peticiones de ligas públicas grandes |
| Mercados de "draft" (elección por rondas)  | Peticiones de variedad               |
| API pública para integraciones de terceros | Peticiones de desarrolladores        |
| Temas / personalización visual             | Peticiones cosméticas                |

## 5. Criterios de aceptación del MVP (resumen)

1. Un usuario nuevo puede registrarse y colocar su primer lineup en <2 min.
2. Dos usuarios en la misma liga pueden competir por GP y por temporada con rankings correctos.
3. El presupuesto de cada usuario es `base + carry` (nunca ratchet); verificado por tests.
4. Un resultado importado dos veces no duplica puntos (idempotencia).
5. Un resultado corregido recalcula el GP conservando el histórico.
6. El lockout impide cambios server-side durante el fin de semana.
7. Un usuario puede estar en 2+ ligas con el mismo lineup y puntos.
8. El admin puede crear una temporada, importar resultados y forzar recálculo.
9. El Gini de presupuesto entre jugadores por GP es < 0.05 en la simulación de carga.
10. La app es usable en móvil (constructor de lineup en una mano).

## 6. Fuera del MVP explícitamente

- Dinero real / apuestas.
- Uso de branding o datos licenciados de MotoGP.
- Dependencia de APIs privadas del juego oficial.
- Garantía de datos en vivo segundo a segundo.
