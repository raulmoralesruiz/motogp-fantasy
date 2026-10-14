"use client";

/**
 * Cliente tRPC + TanStack Query para la UI.
 * `AppRouter` se importa SOLO como tipo desde el servidor: tipos E2E
 * sin código de servidor en el bundle del cliente.
 */
import { httpBatchLink, loggerLink } from "@trpc/client";
import { createTRPCReact } from "@trpc/react-query";
import superjson from "superjson";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import type { AppRouter } from "@/server/routers/_app";

export const trpc = createTRPCReact<AppRouter>();

function makeClient() {
  return trpc.createClient({
    links: [
      loggerLink({
        enabled: (op) =>
          process.env.NODE_ENV === "development" &&
          op.direction === "down" &&
          op.result instanceof Error,
      }),
      httpBatchLink({ url: "/api/trpc", transformer: superjson }),
    ],
  });
}

export function TRPCReactProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 5_000, retry: 1 } },
      }),
  );
  const [trpcClient] = useState(makeClient);

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
