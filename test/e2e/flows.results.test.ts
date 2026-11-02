/**
 * T-11 (docs/architecture/testing.md §2.4 · capa E2E): ver resultados y
 * ranking tras un GP (US-22/US-21, ADR-0022), con la fixture de resultados
 * del dataset ficticio (`npm run seed:fiction`).
 *
 * El usuario E2E compartido (`auth-state.json`, lo crea `globalSetup`)
 * asegura primero un lineup en el GP 1 de "Temporada Ficticia" (idempotente:
 * si ya lo tiene de una corrida anterior, se reutiliza) y después comprueba
 * la pantalla `/resultados`:
 * - estado del GP (definitivo con versión si la cadena de admin ya lo marcó;
 *   provisional en caso contrario);
 * - sus posiciones en ligas (miembro de la liga de bienvenida en dev, o
 *   "aún no formas parte" en CI, donde no hay `WELCOME_LEAGUE_ID`);
 * - su puntuación (provisional en vivo, US-39, o definitiva).
 *
 * Requisitos previos: `docker compose up -d`, `npm run dev` y
 * `npm run seed:fiction` (mismo contrato que `responsive.test.ts`).
 */

import { test, expect, type Page } from "@playwright/test";

const AUTH_STATE = `${process.cwd()}/test/e2e/auth-state.json`;

/**
 * Asegura un lineup del usuario E2E en el GP 1 de "Temporada Ficticia"
 * (mismo lineup y coste que `flows.lineup.test.ts`: 94 ≤ presupuesto 100).
 */
async function ensureLineupForFirstGp(page: Page): Promise<void> {
  await page.goto("/lineups");
  // El option de `/lineups` es el nombre solo (sin año — `s.name`).
  await page.locator("select#season").selectOption({ label: "Temporada Ficticia" });
  await page.locator("select#gp").selectOption({ index: 1 });
  await expect(page.getByRole("heading", { name: /Lineup —/i })).toBeVisible();

  // Si ya tiene lineup en este GP, el borrador llega pre-rellenado.
  const gold1 = await page.locator("select#gold-1").inputValue();
  if (gold1 !== "") return;

  const pick = async (selectId: string, name: string): Promise<void> => {
    const value = await page
      .locator(`select#${selectId} option`)
      .filter({ hasText: name })
      .first()
      .getAttribute("value");
    expect(value, `Debe existir el activo "${name}" en ${selectId}`).toBeTruthy();
    await page.locator(`select#${selectId}`).selectOption(value as string);
  };

  await pick("gold-1", "Piloto A");
  await pick("gold-2", "Piloto B");
  await pick("silver-1", "Piloto C");
  await pick("silver-2", "Piloto D");
  await pick("constructor", "Constructor X");
  await pick("team", "Equipo X");

  const saveButton = page.getByRole("button", { name: /Guardar lineup/i });
  await expect(saveButton).toBeEnabled();
  await saveButton.click();
  await expect(page.getByText(/Lineup guardado para/i)).toBeVisible();
}

test.describe("resultados y ranking tras un GP (T-11)", () => {
  test.use({ storageState: AUTH_STATE });
  test.setTimeout(120_000);

  test("GP visto tras correr: estado de resultados + posiciones en ligas + puntuación", async ({
    page,
  }) => {
    await ensureLineupForFirstGp(page);

    await page.goto("/resultados");
    // El option de `/resultados` es el nombre solo (sin año — `s.name`).
    await page.locator("select#season").selectOption({ label: "Temporada Ficticia" });
    await page.locator("select#gp").selectOption({ index: 1 });

    await expect(page.getByRole("heading", { name: /Mis resultados —/i })).toBeVisible();

    // Estado del GP: definitivo (si la cadena de admin ya lo marcó) o
    // provisional — ambas son respuestas válidas del servidor.
    await expect(
      page
        .getByText("Resultados definitivos")
        .or(page.getByText("Aún no hay resultados definitivos en este GP."))
        .first(),
    ).toBeVisible();

    // Posiciones en ligas: con posición, sin posición (sin Score aún) o sin
    // ligas (CI: sin liga de bienvenida) — el servidor manda la rama.
    await expect(
      page
        .getByText(/posición \d+ \(/)
        .or(page.getByText("sin posición en este GP"))
        .or(page.getByText("Aún no formas parte de ninguna liga."))
        .first(),
    ).toBeVisible();

    // Mi puntuación: total + estado (provisional en vivo o definitivo).
    const totalLine = page.locator("p", { hasText: /Total: / }).first();
    await expect(totalLine).toBeVisible();
    await expect(
      totalLine.locator("text=/puntos/").first(),
    ).toBeVisible();
  });
});
