/**
 * `createEventRefResolver` (US-17, ADR-0019): el vínculo GP ↔ evento de la
 * fuente se resuelve en la capa de router (DI: el adapter no toca la BD).
 *
 * - GP existe → `{ seasonYear, eventRef, gpName }` con el select exacto;
 *   `eventRef = null` si el GP no está vinculado (el adapter lanza
 *   `SourceNotLinkedError` aguas abajo).
 * - GP no existe → `PulseLiveSourceError` «El GP no existe.»
 *
 * Los singletons `../../prisma` y `../../redis` se mockean (excluidos de
 * cobertura por ADR-0011); el env se fija ANTES de importar el router.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../prisma", () => ({ prisma: {} }));
vi.mock("../../redis", () => ({ redis: {} }));

// Env válido ANTES de importar el router (por los singletons de la app).
process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
process.env.REDIS_URL = "redis://localhost:6379/0";

const { createEventRefResolver } = await import("../results");
const { PulseLiveSourceError } = await import("@/modules/results");

/** BD fake con `gp.findUnique` controlado. */
function dbConGp(gp: unknown) {
  const findUnique = vi.fn().mockResolvedValue(gp);
  return { db: { gp: { findUnique } } as never, findUnique };
}

describe("createEventRefResolver (US-17, ADR-0019)", () => {
  it("GP existe: resuelve seasonYear/eventRef/gpName con el select exacto", async () => {
    const { db, findUnique } = dbConGp({
      name: "GP de España",
      sourceRef: "evt-123",
      season: { year: 2026 },
    });

    const result = await createEventRefResolver(db)("gp-1");

    expect(result).toEqual({
      seasonYear: 2026,
      eventRef: "evt-123",
      gpName: "GP de España",
    });
    expect(findUnique).toHaveBeenCalledTimes(1);
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: "gp-1" },
      select: {
        name: true,
        sourceRef: true,
        season: { select: { year: true } },
      },
    });
  });

  it("GP existe pero no está vinculado: eventRef = null (el adapter lanza SourceNotLinkedError)", async () => {
    const { db } = dbConGp({
      name: "GP de Francia",
      sourceRef: null,
      season: { year: 2026 },
    });

    const result = await createEventRefResolver(db)("gp-2");

    expect(result).toEqual({
      seasonYear: 2026,
      eventRef: null,
      gpName: "GP de Francia",
    });
  });

  it("GP no existe: PulseLiveSourceError «El GP no existe.»", async () => {
    const { db } = dbConGp(null);

    await expect(createEventRefResolver(db)("gp-inexistente")).rejects.toBeInstanceOf(
      PulseLiveSourceError,
    );
    await expect(createEventRefResolver(db)("gp-inexistente")).rejects.toThrow(
      "El GP no existe.",
    );
  });
});
