/**
 * T-11 (docs/architecture/testing.md §2.4 · capa E2E): flujo de admin —
 * crear temporada (US-04), importar resultados (US-16), marcar definitivo
 * y ver el recálculo (US-18/US-19), más el RBAC negativo del panel.
 *
 * Contextos:
 * - `admin-state.json` (usuario `e2e_admin` con rol `global_admin`, lo crea
 *   `globalSetup`): la cadena de admin.
 * - `auth-state.json` (usuario normal): el panel le debe quedar cerrado.
 *
 * Idempotencia (se puede repetir la corrida contra la misma BD de dev):
 * - La temporada se crea con un nombre único por corrida.
 * - La corrección alterna la posición del piloto entre 99/98 → siempre
 *   hay exactamente 1 fila corregida, también en la segunda corrida.
 * - Si el GP ya era definitivo (corrida anterior), "Marcar definitivo"
 *   no se muestra: el test solo verifica el estado final (definitivo + rv).
 *
 * Los 3 proyectos corren en paralelo contra la misma BD, así que cada uno
 * usa SU GP de la temporada ficticia (360 → GP 1, 390 → GP 2, 430 → GP 3):
 * sin ese reparto, los tres corregirían/importarían el mismo GP a la vez.
 *
 * Requisitos previos: `docker compose up -d`, `npm run dev` y
 * `npm run seed:fiction` (mismo contrato que `responsive.test.ts`).
 */

import { test, expect } from "@playwright/test";

const ADMIN_STATE = `${process.cwd()}/test/e2e/admin-state.json`;
const USER_STATE = `${process.cwd()}/test/e2e/auth-state.json`;

test.describe("admin — panel y cadena de resultados (T-11)", () => {
  test.use({ storageState: ADMIN_STATE });
  test.setTimeout(120_000);

  test("crear temporada (US-04): aparece en la lista con su primera versión de reglas", async ({
    page,
  }) => {
    await page.goto("/admin");
    const card = page.locator("section#temporadas");
    await expect(card.getByRole("heading", { name: "Crear temporada" })).toBeVisible();

    const name = `E2E Temporada ${Date.now().toString(36)}`;
    await card.getByLabel("Nombre").fill(name);
    await card.getByLabel("Año").fill("2105");
    await card.getByRole("button", { name: /Crear temporada/i }).click();

    await expect(
      card.getByText("Temporada creada con su primera versión de reglas."),
    ).toBeVisible();
    // La lista de temporadas ya la incluye.
    await expect(card.getByText(name).first()).toBeVisible();
  });

  test("importar corrección + marcar definitivo → recálculo con versión (US-16/US-18)", async ({
    page,
  }) => {
    // "Marcar definitivo" y cancelar/neutralizar abren un window.confirm.
    page.on("dialog", (dialog) => void dialog.accept());

    await page.goto("/admin");
    const sec = page.locator("section#resultados");
    await expect(sec.getByRole("heading", { name: "Resultados" })).toBeVisible();

    // Temporada ficticia → SU GP por proyecto (360 → GP 1, 390 → GP 2,
    // 430 → GP 3): los 3 corren en paralelo contra la misma BD y no deben
    // corregir/importar el mismo GP a la vez (la fixture tiene 11 pilotos
    // con posiciones en la carrera de cada GP).
    const project = test.info().project.name;
    const gpLabel =
      project === "mobile-390"
        ? "R2 · GP Ficticio 2"
        : project === "mobile-430"
          ? "R3 · GP Ficticio 3"
          : "R1 · GP Ficticio 1";
    await sec.getByLabel("Temporada").selectOption({ label: "Temporada Ficticia (2099)" });
    await sec.getByLabel("GP").selectOption({ label: gpLabel });
    await sec.getByLabel("Evento").selectOption({ index: 1 });

    // Listo: pilotos + filas de BD cargados (el botón solo se habilita con
    // entradas — las filas pre-cargadas —; evita leer la tabla a medio cargar).
    const importButton = sec.getByRole("button", { name: "Importar resultados" });
    await expect(importButton).toBeEnabled({ timeout: 20_000 });

    // La tabla llega pre-cargada con las filas de BD; corregimos 1 posición.
    const rows = sec.locator("form .results-table tbody tr");
    const rowCount = await rows.count();
    let positionInput: import("@playwright/test").Locator | null = null;
    for (let i = 0; i < rowCount && positionInput === null; i++) {
      const input = rows.nth(i).locator('input[aria-label^="Posición: "]');
      if ((await input.inputValue()) !== "") positionInput = input;
    }
    if (positionInput === null) {
      throw new Error("E2E: sin posiciones cargadas en el evento (¿seed:fiction ejecutado?)");
    }
    const current = await positionInput.inputValue();
    await positionInput.fill(current === "99" ? "98" : "99");

    await sec.getByLabel(/Motivo/).fill("corrección E2E de la parrilla (T-11)");
    await importButton.click();
    await expect(
      sec.getByText(/Importación completada: 0 creados, 1 corregidos/),
    ).toBeVisible();

    // Estado del GP: si aún no es definitivo, lo marcamos (recálculo rv-1);
    // si ya lo era (corrida anterior), el recálculo inline ya lo reversionó.
    const mark = sec.getByRole("button", { name: "Marcar definitivo" });
    if ((await mark.count()) > 0) {
      await mark.click();
      await expect(sec.getByText(/GP definitivo: \d+ fila\(s\)/)).toBeVisible();
    }
    await expect(
      sec.locator("strong", { hasText: /definitivo \(rv-/ }),
    ).toBeVisible();
  });
});

test.describe("admin — RBAC negativo (T-11)", () => {
  test.use({ storageState: USER_STATE });

  test("un usuario normal no accede al panel de administración", async ({ page }) => {
    await page.goto("/admin");
    await expect(
      page.getByText("Solo el administrador global puede acceder a este panel."),
    ).toBeVisible();
  });
});
