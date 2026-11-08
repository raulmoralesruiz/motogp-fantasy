import type { Metadata } from "next";
import type { ReactNode } from "react";

import { Header } from "./shared/components";
import { TRPCReactProvider } from "./trpc/client";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fantasy MotoGP — Independiente",
  description:
    "Fantasy de MotoGP propio y multi-liga, con una economía justa: base fija + carry limitado, sin ratchet.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body>
        <TRPCReactProvider>
          {/* A11y (WCAG 2.4.1): skip-link — primer elemento enfocable del
              documento; el teclado/lector salta la cabecera global (T-26)
              y va directo al contenido. */}
          <a className="skip-link" href="#contenido">
            Saltar al contenido
          </a>
          {/* T-26: cabecera global persistente — nav + sesión en todas las
              páginas (sustituye la nav «Secciones» de la home). */}
          <Header />
          {/* Cada página aporta su propio <main>; este wrapper (patrón W3C
              de skip-link) es el destino del enlace y recibe el foco. */}
          <div id="contenido" tabIndex={-1}>
            {children}
          </div>
        </TRPCReactProvider>
      </body>
    </html>
  );
}
