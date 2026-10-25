import type { Metadata } from "next";

import JoinLeaguePage from "./join-league-page";

export const metadata: Metadata = {
  title: "Unirse a una liga — Fantasy MotoGP Independiente",
};

export default function JoinLeagueRoute() {
  return (
    <main>
      <h1>
        <span>Unirse a una liga</span>
      </h1>
      <JoinLeaguePage />
    </main>
  );
}
