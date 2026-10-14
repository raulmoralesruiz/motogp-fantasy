import type { Metadata } from "next";
import type { ReactNode } from "react";

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
        <TRPCReactProvider>{children}</TRPCReactProvider>
      </body>
    </html>
  );
}
