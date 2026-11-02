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
import { captureException } from "@/server/sentry";
import { createContext } from "@/server/trpc";

const handler = async (req: Request) => {
  const ctx = await createContext(req);
  const res = await fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: () => ctx,
    // T-14 (ADR-0036): solo errores IMPREVISTOS (INTERNAL_SERVER_ERROR) van
    // a Sentry, con contexto (ruta tRPC). Los rechazos esperados
    // (FORBIDDEN/NOT_FOUND/BAD_REQUEST/UNAUTHORIZED) son parte del
    // contrato, no errores: no spamean el panel. No-op si no hay DSN.
    onError({ error, path }) {
      if (error.code === "INTERNAL_SERVER_ERROR") {
        captureException(error, { "trpc.path": path ?? "desconocida" });
      }
    },
  });
  for (const setCookie of ctx.pendingCookies) {
    res.headers.append("Set-Cookie", setCookie);
  }
  return res;
};

export { handler as GET, handler as POST };
