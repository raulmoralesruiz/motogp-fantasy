import type { Metadata } from "next";

import LeagueDetailPage from "./league-detail-page";

export const metadata: Metadata = {
  title: "Liga — Fantasy MotoGP Independiente",
};

export default function LeagueDetailRoute() {
  return (
    <main>
      <h1>
        <span>Liga</span>
      </h1>
      <LeagueDetailPage />
    </main>
  );
}
