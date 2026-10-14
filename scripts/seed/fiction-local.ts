/**
 * Siembra el dataset FICTICIO (economy.md §7) en la BD local — T-22.
 *
 * Para exploración local (Prisma Studio, psql): siembra la temporada
 * ficticia completa (6 GPs, mercado de 19 activos, 6 usuarios con lineups
 * fijos y 66 resultados anonimizados) en la BD de `DATABASE_URL` (.env).
 *
 * Uso:
 *   npx prisma migrate reset --force   # BD limpia (si tiene datos previos)
 *   npm run seed:fiction               # siembra el dataset
 *   npx prisma studio                  # explora en el navegador (:5555)
 *
 * Si el dataset ya está sembrado, falla con un mensaje claro (los usuarios
 * ficticios tienen email/username fijos y chocarían contra los uniques).
 */
import { PrismaClient } from "@prisma/client";
import { loadFictionDataset } from "../../test/fixtures/fiction/index.js";
import { seedFictionalSeason } from "../../test/fixtures/fiction/loader.js";

async function main(): Promise<void> {
  const ds = loadFictionDataset();
  const prisma = new PrismaClient();
  try {
    const existing = await prisma.season.findFirst({
      where: { name: ds.season.name, year: ds.season.year },
    });
    if (existing) {
      throw new Error(
        "El dataset ficticio ya está sembrado en esta BD. " +
          "Ejecuta `npx prisma migrate reset --force` y luego `npm run seed:fiction` de nuevo.",
      );
    }
    const world = await seedFictionalSeason(prisma, ds);
    const nResults = world.gps.length * world.riders.length;
    console.log("Dataset ficticio (economy.md §7) sembrado en la BD local:");
    console.log(`  Temporada: ${world.season.name} (${world.season.year})`);
    console.log(`  GPs: ${world.gps.length} (cada uno con su evento de carrera)`);
    console.log(
      `  Mercado: ${world.riders.length} pilotos, ${world.constructors.length} constructores, ${world.teams.length} equipos`,
    );
    console.log(
      `  Usuarios: ${world.users.length} (P1–P6) · Lineups: ${world.lineups.length} (6 por GP, composición completa)`,
    );
    console.log(`  Resultados: ${nResults} (provisional, fuente fixture-ficticio-v1)`);
    console.log("");
    console.log("Explora en el navegador: npx prisma studio");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
