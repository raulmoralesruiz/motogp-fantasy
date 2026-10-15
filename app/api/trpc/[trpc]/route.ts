/**
 * Handler de tRPC para Next.js App Router.
 * Todos los endpoints de la API pasan por aquí: /api/trpc/<ruta>.
 *
 * La cookie de sesión (US-01) se monta aquí: los procedimientos registran
 * la cabecera `Set-Cookie` en `ctx.pendingCookies` (construcción pura en
 * modules/identity) y el handler la añade a la respuesta.
 */
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

import { appRouter } from "@/server/routers/_app";
import { createContext } from "@/server/trpc";

const handler = async (req: Request) => {
  const ctx = await createContext(req);
  const res = await fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: () => ctx,
  });
  for (const setCookie of ctx.pendingCookies) {
    res.headers.append("Set-Cookie", setCookie);
  }
  return res;
};

export { handler as GET, handler as POST };
