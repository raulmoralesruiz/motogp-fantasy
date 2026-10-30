import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Cobertura FUSIONADA (T-24, ADR-0011): unit + integración en un solo
// `vitest run --coverage`. El global setup arranca UN contenedor
// PostgreSQL (Testcontainers) y aplica las migraciones; los tests unitarios
// no lo usan pero corren en el mismo run para que la cobertura sea real
// (el código de services/routers/UI lo cubren ambas suites).
//
// Requiere Docker. `npm run test:coverage` apunta a este config.
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
    // Todos los tests del repo: unitarios (app/**, __tests__/, scripts/,
    // test/fixtures/) + integración (test/integration/**) + UI (jsdom).
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: ["**/node_modules/**", "**/.next/**", "test/e2e/**"],
    globalSetup: "test/integration/global-setup.ts",
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: "v8",
      // Cobertura GLOBAL real (ADR-0011): toda la app (módulos, server,
      // routers, UI). `all: true` (default) incluye los archivos aunque
      // ningún test los importe, para que el gate mida el código que existe.
      include: ["app/**"],
      // EXCLUDE: en vitest, fijar `exclude` SUSTITUYE a los defaults, así
      // que se re-añaden los patrones default de test + las exclusiones
      // explícitas de glue real justificadas en el ADR-0011 (T-24):
      exclude: [
        // Patrones default de vitest: los test no forman parte del reporte.
        "**/__tests__/**",
        "**/*.test.*",
        "**/*.spec.*",
        "**/*.d.ts",
        // Glue real (singletons de conexión): no contienen lógica
        // testable unitariamente; su comportamiento (conexión perezosa,
        // env) lo cubren la integración y el smoke HTTP de CI.
        "app/server/prisma.ts",
        "app/server/redis.ts",
        // Handler tRPC de Next.js (fetchRequestHandler + cookies): glue de
        // un solo archivo; lo cubren el smoke HTTP de CI y la suite e2e
        // (Playwright, Fase 5). Se excluye el directorio completo porque el
        // nombre literal `[trpc]` chocaría con la sintaxis de clase de
        // caracteres de los glob.
        "app/api/trpc/**",
      ],
      reporter: ["text", "lcov"],
      thresholds: {
        // Global fusionado (T-24 cerrado, ADR-0011 addendum, D-08):
        // medida real 2026-10-19 = 99.94% (3385/3387 líneas, 479 tests).
        // Umbral 99.9%: la única línea no cubierta de la app es la
        // exclusión justificada (pricing.ts L87-88: guard defensivo
        // inalcanzable, ver el addendum).
        lines: 99.9,
        // Módulos puros: ≥90% (testing.md, intacto desde la Fase 0).
        "app/modules/economy/**": { lines: 90, statements: 90, functions: 90 },
        "app/modules/scoring/**": { lines: 90, statements: 90, functions: 90 },
      },
    },
  },
});
