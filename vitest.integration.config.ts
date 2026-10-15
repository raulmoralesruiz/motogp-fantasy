import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Tests de integración (T-07): PostgreSQL real vía Testcontainers.
// El global setup arranca UN contenedor por run, aplica las migraciones
// (`prisma migrate deploy`) y publica la URL en un archivo temporal que
// leen los tests (ver test/integration/helpers.ts).
export default defineConfig({
  // Mismo alias que el tsconfig (`@/*` → `./app/*`): los módulos de la
  // app lo usan en sus imports.
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./app", import.meta.url)),
    },
  },
  test: {
    include: ["test/integration/**/*.test.ts"],
    globalSetup: "test/integration/global-setup.ts",
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
