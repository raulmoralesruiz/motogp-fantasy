import type { Metadata } from "next";

import ResultadosPage from "./resultados-page";

export const metadata: Metadata = {
  title: "Resultados — Fantasy MotoGP Independiente",
};

export default function ResultadosRoute() {
  return (
    <main>
      <h1>
        <span>Resultados</span>
      </h1>
      <ResultadosPage />
    </main>
  );
}
