import { defineConfig } from "vitest/config";

// Tests unitarios (Fase 0, T-01): módulos puros (economy, scoring) y shared.
// Los tests de integración (test/integration/**) corren por separado con
// vitest.integration.config.ts (T-07): requieren Testcontainers + migraciones.
export default defineConfig({
  test: {
    include: ["**/*.test.ts"],
    exclude: ["**/node_modules/**", "test/integration/**"],
    // Coverage (T-02, WP4): solo unit (los tests de integración corren aparte).
    // Puerta de testing.md: ≥90% en economy/scoring; global PROVISIONAL (D-08).
    // Nota: en vitest 2.x los umbrales por globo deben ser OBJETO ({lines, ...});
    // un número suelto se ignora en silencio.
    // No se pone umbral de branches en economy: las ramas sin cubrir son checks
    // defensivos inalcanzables (throw muerto y fallthrough de switch exhaustivo).
    coverage: {
      provider: "v8",
      // Alcance "global" = el monolito (app/); los scripts de tooling no cuentan.
      include: ["app/**"],
      reporter: ["text", "lcov"],
      thresholds: {
        // Global: calibrado a la medida real de Fase 0 (2026-10-14: 60%).
        // PROVISIONAL — se recalibra en D-08 conforme crecen los tests.
        lines: 60,
        "app/modules/economy/**": { lines: 90, statements: 90, functions: 90 },
        "app/modules/scoring/**": { lines: 90, statements: 90, functions: 90 },
      },
    },
  },
});
