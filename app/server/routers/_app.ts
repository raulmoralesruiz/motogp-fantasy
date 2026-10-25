/**
 * Router raíz de tRPC. Cada módulo de negocio añade aquí su router
 * (dirección de dependencias: UI → tRPC → módulos → shared).
 */
import { router } from "../trpc";

import { adminRouter } from "./admin";
import { getDefaultAuthRouter } from "./auth";
import { getDefaultDashboardRouter } from "./dashboard";
import { getDefaultLeaguesRouter } from "./leagues";
import { getDefaultLineupsRouter } from "./lineups";
import { getDefaultMarketRouter } from "./market";
import { getDefaultProfileRouter } from "./profile";
import { getDefaultResultsRouter } from "./results";
import { getDefaultSeasonsRouter } from "./seasons";
import { healthRouter } from "./health";

export const appRouter = router({
  health: healthRouter,
  auth: getDefaultAuthRouter(),
  profile: getDefaultProfileRouter(),
  admin: adminRouter,
  seasons: getDefaultSeasonsRouter(),
  market: getDefaultMarketRouter(),
  lineups: getDefaultLineupsRouter(),
  results: getDefaultResultsRouter(),
  dashboard: getDefaultDashboardRouter(),
  leagues: getDefaultLeaguesRouter(),
});

export type AppRouter = typeof appRouter;
