/**
 * Handler de tRPC para Next.js App Router.
 * Todos los endpoints de la API pasan por aquí: /api/trpc/<ruta>.
 */
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

import { appRouter } from "@/server/routers/_app";
import { createContext } from "@/server/trpc";

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext,
  });

export { handler as GET, handler as POST };
