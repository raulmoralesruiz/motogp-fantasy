import type { Metadata } from "next";

import LigasPage from "./ligas-page";

export const metadata: Metadata = {
  title: "Ligas — Fantasy MotoGP Independiente",
};

export default function LigasRoute() {
  return (
    <main>
      <h1>
        <span>Ligas</span>
      </h1>
      <LigasPage />
    </main>
  );
}
