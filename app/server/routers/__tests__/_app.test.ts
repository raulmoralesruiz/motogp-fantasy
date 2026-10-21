/**
 * Router raíz de tRPC (T-24): agrupa los routers de cada módulo. Se
 * verifica que expone `health`, `auth`, `profile`, `admin`, `seasons`,
 * `market`, `lineups` y `results`.
 *
 * `getDefaultAuthRouter()` se evalúa al importar `_app` (lee el entorno),
 * así que el env se fija antes del import dinámico y los singletons
 * `../../prisma`/`../../redis` se mockean (excluidos de cobertura por
 * ADR-0011).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../prisma", () => ({ prisma: {} }));
vi.mock("../../redis", () => ({ redis: {} }));

process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
process.env.REDIS_URL = "redis://localhost:6379/0";

const { appRouter } = await import("../_app");

describe("appRouter (T-24)", () => {
  it("expone los routers de health, auth, profile, admin, seasons, market, lineups y results", () => {
    // El caller de tRPC v11 es un proxy recursivo (sin keys propias); el
    // registro del router (`_def.record`) es la fuente de las claves.
    expect(Object.keys(appRouter._def.record).sort()).toEqual([
      "admin",
      "auth",
      "health",
      "lineups",
      "market",
      "profile",
      "results",
      "seasons",
    ]);
  });
});
