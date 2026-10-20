import type { Metadata } from "next";

import PerfilPage from "./perfil-page";

export const metadata: Metadata = {
  title: "Perfil — Fantasy MotoGP Independiente",
};

export default function PerfilRoute() {
  return (
    <main>
      <h1>
        <span>Perfil</span>
      </h1>
      <PerfilPage />
    </main>
  );
}
