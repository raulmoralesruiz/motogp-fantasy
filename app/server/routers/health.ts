/**
 * Health-check de la aplicación (T-01): estado de app, BD y Redis.
 * Es infraestructura de la app, no un módulo de negocio.
 */
import { publicProcedure, router } from "../trpc";

const APP_INFO = {
  name: "fantasy-motogp",
  version: "0.1.0",
  fase: "Fase 0 (E1)",
} as const;

const TIMEOUT_MS = 3000;

/** Resuelve `promise` o rechaza si tarda más de `ms` (para no bloquear el health-check). */
function conTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

export const healthRouter = router({
  check: publicProcedure.query(async ({ ctx }) => {
    const [dbOk, redisOk] = await Promise.all([
      conTimeout(
        ctx.prisma.$queryRawUnsafe<{ ok: number }[]>("SELECT 1 AS ok"),
        TIMEOUT_MS,
      )
        .then(() => true)
        .catch(() => false),
      conTimeout(ctx.redis.ping(), TIMEOUT_MS)
        .then(() => true)
        .catch(() => false),
    ]);

    return {
      status: dbOk && redisOk ? ("ok" as const) : ("degradada" as const),
      app: APP_INFO,
      database: { ok: dbOk },
      redis: { ok: redisOk },
      comprobadoEn: new Date().toISOString(),
    };
  }),
});
