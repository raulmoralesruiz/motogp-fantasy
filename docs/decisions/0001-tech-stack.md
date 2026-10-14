# ADR-0001: Stack tecnológico

- **Estado:** Propuesto (pendiente de ratificación en fase 6)
- **Fecha:** 2026-10-13

## Problema

El repositorio es verde. Hay que elegir el stack de cliente, servidor, base de datos y herramientas, priorizando **mantenibilidad con equipo pequeño** y **validación compartida**.

## Opciones

1. **TypeScript + Next.js + PostgreSQL + Prisma + Zod + tRPC + BullMQ** (recomendada).
2. TypeScript + Express/Fastify (API separada) + React (SPA) + PostgreSQL.
3. Python (Django/FastAPI) + React + PostgreSQL.
4. Node + NestJS + Angular + PostgreSQL.

## Pros/Contras

| Opción          | Pros                                                                                                                                                                             | Contras                                                                       |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1 (recomendada) | Un lenguaje (TS) en todo; tipos compartidos; Next.js da frontend+API en un repo; Prisma da migraciones+tipos; Zod da validación única; tRPC da API tipada E2E; ecosistema maduro | Next.js tiene superficie grande; tRPC acopla a TS (no importa aquí)           |
| 2               | Más control sobre la API                                                                                                                                                         | Dos apps que mantener; validación duplicada cliente/servidor; más boilerplate |
| 3               | Django da admin+ORM maduros                                                                                                                                                      | Dos lenguajes; el dominio es JS/TS-friendly; el admin se construye a medida   |
| 4               | Estructura estricta                                                                                                                                                              | Angular es más pesado para este caso; menos ecosistema frontend               |

## Recomendación

**Opción 1.**

## Justificación

- **Mantenibilidad:** un solo lenguaje y un solo repo reducen la fricción.
- **Validación compartida:** Zod + tipos TS garantizan que cliente y servidor validen igual (crítico para presupuesto/lineup).
- **Simple de operar:** un contenedor (app) + Postgres + Redis.
- **Adecuado a la escala:** el tráfico es acotado (jugadores, no millones); no se necesita la complejidad de microservicios ni de un framework enterprise.

## Impacto de producto

- Onboarding rápido del equipo; iteración rápida en reglas de juego.
- El panel de admin se construye a medida (no hay admin gratuito como en Django), pero es un requisito del producto (gestión de precios/reglas/resultados).

## Impacto técnico

- Migraciones versionadas (Prisma) desde el día 1.
- API tipada E2E (tRPC) elimina errores de serialización.
- Jobs en background (BullMQ/Redis) para importación y recálculo.

## Riesgos

- Next.js cambia con frecuencia → fijar versión y actualizar deliberadamente.
- tRPC acopla a TS → aceptable (todo el stack es TS).

## Validación

- Spike de 1–2 días: montar app + PG + una migración + un endpoint tRPC + un test de integración con Testcontainers. Si el spike se bloquea, reabrir el ADR.

## Addendum (2026-10-14, WP4): destino de despliegue

**Cambio de decisión:** el destino de despliegue pasa de "VPS + deploy automático desde CI" a **TrueNAS Scale en red local (sin IP pública) con modelo pull**. CI (GitHub Actions) solo valida (quality gates + build de imagen + gitleaks + dependabot); el deploy lo inicia el humano en el servidor con `./deploy.sh` (git pull → build → migraciones → up → health-check).

- **Motivo:** no hay VPS; el servidor es un TrueNAS en la LAN gestionado con Docker/Portainer y proxy de Nginx Proxy Manager.
- **Secrets (T-19):** `.env` en el servidor (fuera del repo, `chmod 600`) + gitleaks en CI. Vault/SOPS descartados como sobre-infraestructura para un servidor local.
- **Detalle:** `docs/operations/deploy.md` (runbook) y `docs/architecture/overview.md` (tabla de stack).
