"use client";

/**
 * Página de error global (T-14, ADR-0036): captura en Sentry cualquier
 * error de render de la app (App Router) y muestra la página de error
 * estándar de Next.js.
 *
 * Sin DSN `Sentry.captureException` es un no-op (el SDK no inicializa;
 * `instrumentation-client.ts`).
 */
import * as Sentry from "@sentry/nextjs";
import NextError from "next/error";
import { useEffect } from "react";

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="es">
      <body>
        {/*
         * `statusCode={0}`: el error global de App Router no expone un
         * código de estado; 0 renderiza el mensaje genérico (patrón
         * oficial de Sentry).
         */}
        <NextError statusCode={0} />
      </body>
    </html>
  );
}
