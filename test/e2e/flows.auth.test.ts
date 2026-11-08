/**
 * T-11 (docs/architecture/testing.md §2.4 · capa E2E): flujos de usuario
 * end-to-end con Playwright — registro → sesión → logout, incluidos los
 * caminos de error (email duplicado, credenciales incorrectas).
 *
 * Requisitos previos (mismo contrato que `responsive.test.ts`):
 * - `docker compose up -d` (postgres + redis)
 * - `npm run dev` en localhost:3000
 * - Base de datos con al menos 1 temporada y 1 GP (seed:ficticio: `npm run seed:fiction`)
 *
 * El dataset ficticio (usuarios fijos, email/username `player-pN@ficticio.test`)
 * no tiene password usable, así que los flujos E2E se autogeneran con un email
 * único por test (no colisionan con los uniques del seed). El número de intentos
 * de auth por IP se mantiene bajo el default del servidor (10/ventana/60 s) para
 * no chocar con el rate-limit en CI.
 */

import { test, expect, type Page } from "@playwright/test";

/** Sufijo aleatorio por test para no colisionar con el dataset ficticio. */
function uniq(prefix: string): string {
  // Solo alfanumérico + guion bajo: el regex de usernameSchema es ^[a-zA-Z0-9_]+$
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Registro completo por UI (campos + checkbox + submit). */
async function registerViaUi(page: Page, email: string, password: string): Promise<void> {
  const username = `e2e_${uniq("u")}`;
  await page.goto("/registro");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Nombre de usuario").fill(username);
  await page.getByLabel("Contraseña").fill(password);
  await page.locator("#termsAccepted").check();
  await page.getByRole("button", { name: /Crear cuenta/i }).click();
}

/** Login por UI (email + contraseña + submit). */
async function loginViaUi(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: /Iniciar sesión/i }).click();
}

/**
 * T-26: la sesión vive en la cabecera global — «logueado» = el header
 * muestra «Cerrar sesión» (antes: el texto «Sesión activa» de la home).
 */
async function expectLoggedIn(page: Page): Promise<void> {
  await expect(page.getByRole("button", { name: /Cerrar sesión/i })).toBeVisible();
}

/** T-26: «anónimo» = el header ofrece «Iniciar sesión» y no «Cerrar sesión». */
async function expectAnonymous(page: Page): Promise<void> {
  await expect(page.getByRole("link", { name: "Iniciar sesión" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Cerrar sesión/i })).not.toBeVisible();
}

test.describe("flujos E2E — auth (T-11)", () => {
  test("registro válido → redirige al home con sesión activa", async ({ page }) => {
    const email = `e2e-${uniq("e2e")}@ficticio.test`;
    await registerViaUi(page, email, "Password123");
    await expect(page).toHaveURL(/\/$/);
    await expectLoggedIn(page);
  });

  test("registro → logout → login válida → sesión activa", async ({ page }) => {
    const email = `e2e-${uniq("e2e")}@ficticio.test`;
    await registerViaUi(page, email, "Password123");
    await expectLoggedIn(page);

    await page.getByRole("button", { name: /Cerrar sesión/i }).click();
    await expectAnonymous(page);

    await loginViaUi(page, email, "Password123");
    await expect(page).toHaveURL(/\/$/);
    await expectLoggedIn(page);
  });

  test("registro → logout → login inválida → error 'Credenciales incorrectas.'", async ({
    page,
  }) => {
    const email = `e2e-${uniq("e2e")}@ficticio.test`;
    await registerViaUi(page, email, "Password123");
    await page.getByRole("button", { name: /Cerrar sesión/i }).click();
    await expectAnonymous(page);

    await loginViaUi(page, email, "WrongPassword123");
    await expect(page.getByText("Credenciales incorrectas.")).toBeVisible();
  });

  test("registro → logout → sesión anónima en home", async ({ page }) => {
    const email = `e2e-${uniq("e2e")}@ficticio.test`;
    await registerViaUi(page, email, "Password123");
    await expectLoggedIn(page);

    await page.getByRole("button", { name: /Cerrar sesión/i }).click();
    await expectAnonymous(page);
  });

  test("registro con email duplicado → error 'El email ya está registrado.'", async ({
    page,
  }) => {
    const email = `e2e-${uniq("e2e")}@ficticio.test`;
    await registerViaUi(page, email, "Password123");
    await expectLoggedIn(page);

    // Logout antes de repetir el registro (el duplicado se detecta por email).
    await page.getByRole("button", { name: /Cerrar sesión/i }).click();
    await expectAnonymous(page);

    await registerViaUi(page, email, "Password123");
    await expect(page.getByText("El email ya está registrado.")).toBeVisible();
  });
});
