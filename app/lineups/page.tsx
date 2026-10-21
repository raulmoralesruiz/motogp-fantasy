import type { Metadata } from "next";

import LineupsPage from "./lineups-page";

export const metadata: Metadata = {
  title: "Lineups — Fantasy MotoGP Independiente",
};

export default function LineupsRoute() {
  return (
    <main>
      <h1>
        <span>Lineups</span>
      </h1>
      <LineupsPage />
    </main>
  );
}
