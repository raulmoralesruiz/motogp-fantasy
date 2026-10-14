/**
 * Router raíz de tRPC. Cada módulo de negocio añadirá aquí su router
 * (dirección de dependencias: UI → tRPC → módulos → shared).
 */
import { router } from "../trpc";

import { healthRouter } from "./health";

export const appRouter = router({
  health: healthRouter,
});

export type AppRouter = typeof appRouter;
