import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createFullLineup, createPrisma, seedWorld } from "./helpers";

// T-06 · CA (verificado en CI contra BD real): los constraints duros existen en BD.
// Cada test siembra un mundo aislado (seedWorld) para no interferir entre sí.
describe("T-06 · Constraints duros en BD (PostgreSQL real)", () => {
  let prisma!: PrismaClient;

  beforeAll(() => {
    prisma = createPrisma();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("composición de lineup (trigger check_lineup_composition)", () => {
    it("rechaza un insert parcial (3 slots)", async () => {
      const world = await seedWorld(prisma);
      const lineup = await prisma.lineup.create({
        data: { userId: world.user.id, gpId: world.gp.id },
      });
      await expect(
        prisma.lineupSlot.createMany({
          data: [
            {
              lineupId: lineup.id,
              slotType: "gold",
              assetType: "rider",
              assetId: world.riders[0].id,
            },
            {
              lineupId: lineup.id,
              slotType: "gold",
              assetType: "rider",
              assetId: world.riders[1].id,
            },
            {
              lineupId: lineup.id,
              slotType: "silver",
              assetType: "rider",
              assetId: world.riders[2].id,
            },
          ],
        }),
      ).rejects.toThrow(/Composición de lineup inválida/);
      expect(await prisma.lineupSlot.count({ where: { lineupId: lineup.id } })).toBe(0);
    });

    it("acepta la composición completa (2 oro + 2 plata + 1 constructor + 1 equipo) en una sola sentencia", async () => {
      const world = await seedWorld(prisma);
      const slots = await createFullLineup(prisma, world);
      expect(slots).toHaveLength(6);
    });

    it("rechaza borrar un slot de un lineup completo", async () => {
      const world = await seedWorld(prisma);
      const slots = await createFullLineup(prisma, world);
      const firstSlot = slots[0];
      if (!firstSlot) throw new Error("createFullLineup debe devolver los 6 slots");
      await expect(
        prisma.lineupSlot.delete({ where: { id: firstSlot.id } }),
      ).rejects.toThrow(/Composición de lineup inválida/);
      expect(
        await prisma.lineupSlot.count({ where: { lineupId: firstSlot.lineupId } }),
      ).toBe(6);
    });
  });

  describe("uniques duros", () => {
    it("lineups: a lo sumo 1 por (user, gp)", async () => {
      const world = await seedWorld(prisma);
      const data = { userId: world.user.id, gpId: world.gp.id };
      await prisma.lineup.create({ data });
      await expect(prisma.lineup.create({ data })).rejects.toMatchObject({
        code: "P2002",
      });
    });

    it("rider_affiliations: 1 afiliación por (rider, gp)", async () => {
      const world = await seedWorld(prisma);
      const data = {
        riderId: world.riders[0].id,
        teamId: world.team.id,
        constructorId: world.ctor.id,
        gpId: world.gp.id,
      };
      await prisma.riderAffiliation.create({ data });
      await expect(prisma.riderAffiliation.create({ data })).rejects.toMatchObject({
        code: "P2002",
      });
    });

    it("prices: 1 precio por (asset_type, asset_id, gp)", async () => {
      const world = await seedWorld(prisma);
      const data = {
        assetType: "rider" as const,
        assetId: world.riders[0].id,
        gpId: world.gp.id,
      };
      await prisma.price.create({ data: { ...data, price: 24, reason: "formula" } });
      await expect(
        prisma.price.create({ data: { ...data, price: 25, reason: "manual" } }),
      ).rejects.toMatchObject({
        code: "P2002",
      });
    });

    it("prices: a lo sumo 1 precio de apertura (P0, gp_id NULL) por activo (índice parcial)", async () => {
      const world = await seedWorld(prisma);
      const data = { assetType: "rider" as const, assetId: world.riders[0].id };
      await prisma.price.create({ data: { ...data, price: 24, reason: "formula" } });
      await expect(
        prisma.price.create({ data: { ...data, price: 25, reason: "formula" } }),
      ).rejects.toMatchObject({
        code: "P2002",
      });
    });

    it("results: idempotencia — unique (gp, event, rider)", async () => {
      const world = await seedWorld(prisma);
      const data = {
        gpId: world.gp.id,
        eventId: world.event.id,
        riderId: world.riders[0].id,
        source: "manual" as const,
      };
      await prisma.result.create({ data: { ...data, position: 1 } });
      await expect(
        prisma.result.create({ data: { ...data, position: 2 } }),
      ).rejects.toMatchObject({ code: "P2002" });
    });

    it("league_members: unique (league, user)", async () => {
      const world = await seedWorld(prisma);
      const league = await prisma.league.create({
        data: { name: `Liga ${randomUUID().slice(0, 8)}` },
      });
      const data = { leagueId: league.id, userId: world.user.id };
      await prisma.leagueMember.create({ data });
      await expect(prisma.leagueMember.create({ data })).rejects.toMatchObject({
        code: "P2002",
      });
    });

    it("season_rules: unique (season, version)", async () => {
      const world = await seedWorld(prisma);
      const data = {
        seasonId: world.season.id,
        version: "economy-v1",
        rules: { B: 100 },
      };
      await prisma.seasonRule.create({ data });
      await expect(prisma.seasonRule.create({ data })).rejects.toMatchObject({
        code: "P2002",
      });
    });
  });

  it("price_history: la vista derivada refleja los precios (P0 + por GP)", async () => {
    const world = await seedWorld(prisma);
    await prisma.price.create({
      data: {
        assetType: "rider",
        assetId: world.riders[0].id,
        price: 24,
        reason: "formula",
      },
    });
    await prisma.price.create({
      data: {
        assetType: "rider",
        assetId: world.riders[0].id,
        gpId: world.gp.id,
        price: 25,
        reason: "formula",
      },
    });
    const rows = (await prisma.$queryRaw`
      SELECT count(*)::int AS n FROM price_history WHERE asset_id = ${world.riders[0].id}::uuid
    `) as Array<{ n: number }>;
    expect(rows[0]?.n).toBe(2);
  });
});
