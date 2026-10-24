import type { Metadata } from "next";

import PuntuacionPage from "./puntuacion-page";

export const metadata: Metadata = {
  title: "Mi puntuación — Fantasy MotoGP Independiente",
};

export default function PuntuacionRoute() {
  return (
    <main>
      <h1>
        <span>Mi puntuación</span>
      </h1>
      <PuntuacionPage />
    </main>
  );
}
