import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createPrisma } from "./helpers";

// T-07 · CA: un test de integración corre contra PostgreSQL real (Testcontainers)
// y completa una transacción (insert + rollback) en < 30 s.
describe("T-07 · Integración contra PostgreSQL real (Testcontainers)", () => {
  let prisma!: PrismaClient;

  beforeAll(() => {
    prisma = createPrisma();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("completa una transacción (insert + rollback) en < 30 s", async () => {
    const start = performance.now();

    // Insert + rollback intencional: no debe persistir nada.
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.season.create({ data: { name: "Temporada rollback", year: 2099 } });
        throw new Error("rollback intencional");
      }),
    ).rejects.toThrow("rollback intencional");

    // Insert + commit dentro de una transacción interactiva.
    const season = await prisma.$transaction(async (tx) => {
      return tx.season.create({ data: { name: "Temporada commit", year: 2099 } });
    });

    const elapsedSec = (performance.now() - start) / 1000;
    expect(elapsedSec).toBeLessThan(30);
    expect(await prisma.season.count({ where: { name: "Temporada rollback" } })).toBe(0);
    expect(await prisma.season.count({ where: { id: season.id } })).toBe(1);
  });
});
