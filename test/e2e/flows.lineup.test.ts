/**
 * T-11 (docs/architecture/testing.md §2.4 · capa E2E): flujo completo de
 * usuario — registro → componer lineup → guardar → confirmación.
 *
 * Cubre el caso de uso E2E mínimo del producto:
 * - `/registro` → `/lineups` (builder) → lineup completo (2 oro + 2 plata +
 *   constructor + equipo) → `lineups.save` → mensaje de éxito.
 *
 * US-41 (ADR-0041): la composición se hace con el SELECCIONADOR GRÁFICO
 * (slots + tarjetas con avatar generativo), no con selects nativos:
 * se toca el slot (queda marcado) y la tarjeta del activo (queda asignada);
 * el nombre accesible de la tarjeta es "Nombre, Sublínea, Precio".
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
 * Lineup elegido (concentración máx 2/constructor y 2/equipo — `validateLineup`;
 * precios ficticios del seed GP1, coste 24+22+18+16+8+6 = 94 ≤ presupuesto 100):
 * - Oro: Piloto A + Piloto B (Constructor X / Equipo X).
 * - Plata: Piloto C + Piloto D (Constructor Y / Equipo Y).
 * - Constructor: Constructor X · Equipo: Equipo X (invariante 5: activos distintos).
 */

/**
 * US-41: asigna un activo a un slot del picker gráfico — tocar el slot
 * (queda marcado) y luego la tarjeta del activo (queda asignada).
 * - Slot: nombre accesible "Etiqueta" + " " + (activo | "Vacío").
 * - Tarjeta: nombre accesible "Nombre, Sublínea, Precio" (el nombre del
 *   activo nunca empieza como una etiqueta de slot, así que anclar a
 *   "Nombre," no colisiona con los 6 botones de slot).
 */
async function assignCard(
  page: Page,
  slotLabel: string,
  assetName: string,
): Promise<void> {
  await page
    .getByRole("button", { name: new RegExp(`^${slotLabel} `) })
    .click();
  await page
    .getByRole("button", { name: new RegExp(`^${assetName},`) })
    .click();
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

    // 3) Componer el lineup con el picker gráfico (US-41): slot → tarjeta.
    await assignCard(page, "Piloto oro 1", "Piloto A");
    await expect(
      page.getByRole("button", { name: "Piloto oro 1 Piloto A" }),
    ).toBeVisible();

    // Semántica de movimiento/bloqueo: con Piloto A en "Piloto oro 1", en el
    // slot "Piloto oro 2" la tarjeta de Piloto A queda BLOQUEADA con el motivo
    // escrito (patrón aria-disabled + aria-describedby de la UI) — no desaparece.
    await page.getByRole("button", { name: "Piloto oro 2 Vacío" }).click();
    await expect(
      page.getByRole("button", { name: /^Piloto A,/ }),
    ).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByText("Ya en otro slot")).toBeVisible();

    await assignCard(page, "Piloto oro 2", "Piloto B");
    await assignCard(page, "Piloto plata 1", "Piloto C");
    await assignCard(page, "Piloto plata 2", "Piloto D");
    await assignCard(page, "Constructor", "Constructor X");
    await assignCard(page, "Equipo", "Equipo X");

    // Coste en vivo: 24 + 22 + 18 + 16 + 8 + 6 = 94 ≤ presupuesto base 100.
    await expect(page.getByText("Si guardas ahora:")).toBeVisible();
    await expect(page.getByText("coste 94")).toBeVisible();

    // 4) Guardar: el botón se habilita solo con el lineup completo
    // (aria-disabled + motivo escrito mientras hay slots vacíos).
    const saveButton = page.getByRole("button", { name: /Guardar lineup/i });
    await expect(saveButton).toBeEnabled();
    await saveButton.click();

    // 5) Confirmación.
    await expect(page.getByText(/Lineup guardado para/i)).toBeVisible();
  });
});
