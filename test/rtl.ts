/**
 * Helper de React Testing Library para los tests de UI (T-24).
 *
 * - Importa los matchers de `@testing-library/jest-dom` (extienden `expect`
 *   con `toBeInTheDocument`, `toHaveClass`, …).
 * - Re-exporta la API de `@testing-library/react` (render, screen, waitFor,
 *   within, act, cleanup) y `user-event` para las interacciones.
 *
 * Cada test de UI declara `// @vitest-environment jsdom` en su cabecera; el
 * cleanup automático de RTL se registra en el `afterEach` global de Vitest.
 */
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// El auto-cleanup de RTL solo se registra si `afterEach` es global; vitest
// no inyecta globals por defecto, así que se limpia explícitamente aquí.
afterEach(() => {
  cleanup();
});

export * from "@testing-library/react";
export { default as userEvent } from "@testing-library/user-event";
