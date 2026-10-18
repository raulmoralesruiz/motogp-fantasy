import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Tests unitarios (Fase 0, T-01): módulos puros (economy, scoring) y shared.
// Los tests de integración (test/integration/**) corren por separado con
// vitest.integration.config.ts (T-07): requieren Testcontainers + migraciones.
export default defineConfig({
  // Mismo alias que el tsconfig (`@/*` → `./app/*`).
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./app", import.meta.url)),
    },
  },
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
      // Alcance del gate unitario (ADR-0011, 2026-10-18): la capa
      // unit-testeable = módulos de negocio + shared. La UI de pantallas,
      // los routers tRPC y el glue de servidor (env, prisma, redis) los
      // cubren las suites de integración (PG real) y e2e (Playwright, Fase 5);
      // incluirlos aquí los contaría como 0% y haría el gate inestable
      // (caída 39% → 28.37% tras US-02/T-08/T-09/US-04).
      include: ["app/modules/**", "app/shared/**"],
      // EXCLUDE: en vitest, fijar `exclude` SUSTITUYE a los defaults (los
      // archivos de test dejarían de filtrarse), así que se re-añaden los
      // patrones default relevantes + las decisiones de ADR-0011.
      exclude: [
        // Patrones default de vitest: los test no forman parte del reporte.
        "**/__tests__/**",
        "**/*.test.*",
        "**/*.spec.*",
        "**/*.d.ts",
        // Servicios con transacciones Prisma: su cobertura la aporta la suite
        // de integración (test/integration/**). Lista EXPLÍCITA — añadir un
        // servicio nuevo a esta lista es una decisión visible en el diff.
        "app/modules/identity/auth-service.ts",
        "app/modules/seasons/season-service.ts",
        "app/modules/seasons/gp-service.ts",
        "app/modules/admin/audit.ts",
        // Primitivas de UI: las cubren e2e (Playwright, Fase 5) y T-24 (RTL).
        "app/shared/components/**",
      ],
      reporter: ["text", "lcov"],
      thresholds: {
        // Global unit: PROVISIONAL — calibrado a la medida real de 2026-10-18
        // (559/659 = 84.83% con el alcance de ADR-0011). Historial:
        // 60 (Fase 0) → 39 (2026-10-15, calibración a la medida) → 84
        // (2026-10-18, cambio de alcance del gate). T-24 fusiona la cobertura
        // de integración en el reporte y recalibra al objetivo global ≥95%
        // (D-08); economy/scoring siguen en ≥90%.
        lines: 84,
        "app/modules/economy/**": { lines: 90, statements: 90, functions: 90 },
        "app/modules/scoring/**": { lines: 90, statements: 90, functions: 90 },
      },
    },
  },
});
