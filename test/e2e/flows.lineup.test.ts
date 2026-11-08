/**
 * T-11 (docs/architecture/testing.md §2.4 · capa E2E): flujo completo de
 * usuario — registro → componer lineup → guardar → confirmación.
 *
 * Cubre el caso de uso E2E mínimo del producto:
 * - `/registro` → `/lineups` (builder) → lineup completo (2 oro + 2 plata +
 *   constructor + equipo) → `lineups.save` → mensaje de éxito.
 *
 * Requisitos previos (mismo contrato que `responsive.test.ts`):
 * - `docker compose up -d` (postgres + redis)
 * - `npm run dev` en localhost:3000
 * - Base de datos con al menos 1 temporada y 1 GP (seed:ficticio: `npm run seed:fiction`)
 */

import { test, expect, type Page } from "@playwright/test";

/**
 * T-11 (testing.md §2.4 · E2E): el builder debe cargarse y permitir el save.
 *
 * Lineup elegido (máx 2 pilotos/constructor y por equipo — concentración del
 * `validateLineup`; precios ficticios del seed, coste 94 ≤ presupuesto base 100):
 * - Oro: Piloto A + Piloto B (Constructor X / Equipo X).
 * - Plata: Piloto C + Piloto D (otro constructor; concentración ≤ 2/constructor).
 * - Constructor: Constructor X · Equipo: Equipo X.
 */
async function selectRider(
  page: Page,
  selectId: string,
  riderName: string,
): Promise<void> {
  const value = await page
    .locator(`select#${selectId} option`)
    .filter({ hasText: riderName })
    .first()
    .getAttribute("value");
  expect(value, `Debe existir el piloto "${riderName}" en ${selectId}`).toBeTruthy();
  await page.locator(`select#${selectId}`).selectOption(value as string);
}

async function selectAsset(
  page: Page,
  selectId: string,
  assetName: string,
): Promise<void> {
  const value = await page
    .locator(`select#${selectId} option`)
    .filter({ hasText: assetName })
    .first()
    .getAttribute("value");
  expect(value, `Debe existir el activo "${assetName}" en ${selectId}`).toBeTruthy();
  await page.locator(`select#${selectId}`).selectOption(value as string);
}

test.describe("flujo E2E — registro → lineup (T-11)", () => {
  test.setTimeout(90_000);

  test("registro → componer → guardar lineup con éxito", async ({ page }) => {
    const email = `e2e-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@ficticio.test`;
    const username = `e2e_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

    // 1) Registro por UI → redirige al home con sesión activa
    // (T-26: la sesión vive en la cabecera global — «Cerrar sesión» visible).
    await page.goto("/registro");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Nombre de usuario").fill(username);
    await page.getByLabel("Contraseña").fill("Password123");
    await page.locator("#termsAccepted").check();
    await page.getByRole("button", { name: /Crear cuenta/i }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("button", { name: /Cerrar sesión/i })).toBeVisible();

    // 2) Builder de lineup: temporada → GP.
    await page.goto("/lineups");
    await page.locator("select#season").selectOption({ label: "Temporada Ficticia" });
    await page.locator("select#gp").selectOption({ index: 1 });
    await expect(page.getByRole("heading", { name: /Lineup —/i })).toBeVisible();

    // 3) Componer el lineup (borrador: IDs de activos).
    await selectRider(page, "gold-1", "Piloto A");
    await selectRider(page, "gold-2", "Piloto B");
    await selectRider(page, "silver-1", "Piloto C");
    await selectRider(page, "silver-2", "Piloto D");
    await selectAsset(page, "constructor", "Constructor X");
    await selectAsset(page, "team", "Equipo X");

    // 4) Guardar: el botón se habilita solo con el lineup completo.
    const saveButton = page.getByRole("button", { name: /Guardar lineup/i });
    await expect(saveButton).toBeEnabled();
    await saveButton.click();

    // 5) Confirmación.
    await expect(page.getByText(/Lineup guardado para/i)).toBeVisible();
  });
});
