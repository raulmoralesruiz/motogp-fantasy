import type { Metadata } from "next";

import MercadoPage from "./mercado-page";

export const metadata: Metadata = {
  title: "Mercado — Fantasy MotoGP Independiente",
};

export default function MercadoRoute() {
  return (
    <main>
      <h1>
        <span>Mercado</span>
      </h1>
      <MercadoPage />
    </main>
  );
}
