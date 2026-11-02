/**
 * T-10 (ADR-0034) · Test de rendimiento: GP completo (1000 lineups)
 * recalculado en < 30 s.
 *
 * CA: "rendimiento: GP completo (todos los pilotos/eventos, 1000 lineups)
 * recalculado en < 30 s (test de carga)".
 *
 * El recálculo (`markDefinitive` → `recalculateGp`) puntúa cada lineup del GP
 * (una `Score` por lineup, escritura en BD). Con 1000 lineups son 1000
 * escrituras + carga de resultados/afiliaciones/precios. El umbral de 30 s
 * cubre el caso de uso real con holgura (el objetivo es que el recálculo no
 * sea una bottleneck operable; ver ADR-0034 §rendimiento).
 *
 * Se siembra con `seedHeavyGp` (createMany + IDs pregenerados) para que el
 * seed no distorsione el timing; solo se mide `markDefinitive`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PrismaClient } from "@prisma/client";

import { createPrisma, integrationDbUrl, seedHeavyGp } from "./helpers";

// El singleton `prisma`/env lee DATABASE_URL al cargar: se fija ANTES de
// importar los módulos de la app (mismo patrón que results-definitive.test.ts).
process.env.DATABASE_URL = integrationDbUrl();
process.env.REDIS_URL ??= "redis://localhost:6379/0"; // dummy: lazyConnect

const { ResultsService } = await import("../../app/modules/results");

const LINEUP_COUNT = 1000;
const BUDGET_MS = 30_000;

describe("T-10 · rendimiento del recálculo (1000 lineups < 30 s)", () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = createPrisma();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("recalcula un GP de 1000 lineups en < 30 s y puntúa todos los lineups", async () => {
    const heavy = await seedHeavyGp(prisma, LINEUP_COUNT);
    const service = new ResultsService({ prisma });

    const start = performance.now();
    const result = await service.markDefinitive(heavy.gp.id, {
      actorId: null, // sistema (mismo patrón que el auto-import; evita FK a `users`)
    });
    const elapsedMs = performance.now() - start;

    // Puntuó TODOS los lineups (1 por usuario, invariante 3).
    expect(result.noop).toBe(false);
    expect(result.lineupsScored).toBe(LINEUP_COUNT);
    expect(result.resultsVersion).not.toBeNull();

    // Un Score por lineup (unique `(lineupId, resultsVersion)`).
    const scoreCount = await prisma.score.count({
      where: { gpId: heavy.gp.id, resultsVersion: result.resultsVersion! },
    });
    expect(scoreCount).toBe(LINEUP_COUNT);

    // CA de T-10: < 30 s.
    console.log(
      `[perf] recálculo de ${LINEUP_COUNT} lineups en ${elapsedMs.toFixed(0)} ms`,
    );
    expect(elapsedMs).toBeLessThan(BUDGET_MS);
  }, 90_000); // timeout holgado: el test debe terminar rápido, pero no fallar por timeout en CI lento
});
