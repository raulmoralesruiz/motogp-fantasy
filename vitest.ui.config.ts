import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Tests de UI (React Testing Library, T-24): jsdom, sin Docker ni coverage.
// Iteración rápida de los tests de pantalla/admin. La cobertura FUSIONADA
// (unit + integración + UI) la mide `vitest.full.config.ts` (requiere Docker).
//
// Los test de UI declaran `// @vitest-environment jsdom` en su cabecera, así
// que este config solo filtra por extensión `.test.tsx` (no arranca el
// global-setup de Testcontainers, que solo necesita la suite de integración).
export default defineConfig({
  // Mismo alias que el tsconfig (`@/*` → `./app/*`).
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./app", import.meta.url)),
    },
  },
  // JSX runtime automático (igual que Next.js): no hace falta importar React.
  esbuild: {
    jsx: "automatic",
  },
  test: {
    include: ["**/*.test.tsx"],
    exclude: ["**/node_modules/**", "**/.next/**"],
  },
});
