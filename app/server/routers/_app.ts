/**
 * Router raíz de tRPC. Cada módulo de negocio añade aquí su router
 * (dirección de dependencias: UI → tRPC → módulos → shared).
 */
import { router } from "../trpc";

import { adminRouter } from "./admin";
import { getDefaultAuthRouter } from "./auth";
import { healthRouter } from "./health";

export const appRouter = router({
  health: healthRouter,
  auth: getDefaultAuthRouter(),
  admin: adminRouter,
});

export type AppRouter = typeof appRouter;
