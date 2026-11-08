/**
 * T-16 · Verificación responsive (E2E).
 *
 * Viewports: iPhone SE (360–375px), Pixel 5 (390px), Galaxy S21 (430px).
 *
 * Criterios de aceptación:
 * 1. Constructor de lineup usable en una mano — todas las acciones del flujo
 *    central alcanzables sin zoom.
 * 2. Dashboard y rankings legibles en móvil.
 *
 * Requisitos previos:
 * - `docker compose up -d` (postgres + redis)
 * - `npm run dev` en localhost:3000
 * - Base de datos con al menos 1 temporada y 1 GP (seed:fiction)
 *
 * El builder de lineups requiere sesión (`protectedProcedure`, US-09):
 * `globalSetup` crea un usuario E2E compartido y guarda su cookie en
 * `auth-state.json` (storageState; ver `test/e2e/global-setup.ts`).
 */

import path from "node:path";

import { test, expect, type Page } from "@playwright/test";

/** Sesión E2E compartida (la crea `globalSetup`; se ejecuta desde la raíz del repo). */
const AUTH_STATE = path.join(process.cwd(), "test", "e2e", "auth-state.json");

// ─────────────────────────── helpers ───────────────────────────

/** Verifica que no hay overflow horizontal (scroll X innecesario). */
async function assertNoHorizontalOverflow(
  page: import("@playwright/test").Page,
) {
  const viewportSize = page.viewportSize();
  if (!viewportSize) return; // should not happen in Playwright
  const viewportWidth = viewportSize.width;
  const bodyWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(bodyWidth).toBeLessThanOrEqual(
    viewportWidth + 2, // 2px de margen para el scroll bar
  );
}

/**
 * Verifica que los controles de la app (dentro de `<main>`) tienen touch
 * target ≥ 44px (T-16). Se limita a `<main>` para no contar el widget de
 * devtools de Next.js (solo aparece en dev y queda fuera de la app).
 *
 * Barrido P3 (auth): los checkbox/radio quedan fuera de la enumeración — su
 * target táctil es la etiqueta envolvente (`.form .check` / `.check-cell`,
 * 44 px en CSS), no el `<input>` (20 px), que es solo el indicador visual.
 */
async function assertTouchTargets(page: Page) {
  const violations: Array<{
    tag: string;
    class: string;
    width: number;
    height: number;
  }> = await page.evaluate(() => {
    const root = document.querySelector("main") ?? document;
    const interactive = root.querySelectorAll(
      'button, select, input:not([type="checkbox"]):not([type="radio"])',
    );
    const bad: Array<{
      tag: string;
      class: string;
      width: number;
      height: number;
    }> = [];
    interactive.forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.width < 44 || rect.height < 44) {
        bad.push({
          tag: el.tagName,
          class: el.className,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        });
      }
    });
    return bad;
  });
  expect(violations).toEqual([]);
}

/**
 * Abre el builder siguiendo el flujo real del usuario: `/lineups` →
 * temporada → GP → presupuesto visible (`builder.data` cargado). Prueba
 * temporada/GP hasta encontrar uno con mercado disponible.
 */
async function openBuilder(page: Page): Promise<void> {
  await page.goto("/lineups");
  await expect(page.getByRole("heading", { name: /Temporada y GP/i })).toBeVisible();

  const seasonCount = (await page.locator("#season option").count()) - 1;
  if (seasonCount < 1) {
    throw new Error("E2E: no hay temporadas en la BD (¿seed:fiction ejecutado?)");
  }

  for (let s = 1; s <= seasonCount; s++) {
    await page.selectOption("#season", { index: s });
    await expect(page.locator("#gp")).toBeVisible();
    // Espera a que termine de cargar la lista de GPs (>0 GPs).
    try {
      await expect
        .poll(async () => (await page.locator("#gp option").count()) - 1, {
          timeout: 5_000,
        })
        .toBeGreaterThan(0);
    } catch {
      continue; // temporada sin GPs: probar la siguiente
    }
    const gpCount = (await page.locator("#gp option").count()) - 1;
    for (let g = 1; g <= gpCount; g++) {
      await page.selectOption("#gp", { index: g });
      try {
        await expect(page.getByText(/Presupuesto:/i)).toBeVisible({ timeout: 4_000 });
        return; // builder abierto
      } catch {
        /* GP sin mercado disponible: probar el siguiente */
      }
    }
  }
  throw new Error("E2E: no hay ningún GP con mercado disponible (¿seed:fiction ejecutado?)");
}

// ─────────────────────────── lineup builder ───────────────────────────

test.describe("constructor de lineup — T-16", () => {
  // El builder requiere sesión (`protectedProcedure`, US-09): se reutiliza el
  // usuario E2E compartido de `globalSetup` (máx. 1 login contable por run;
  // el rate-limit de login es 10/60 s por IP, US-01).
  test.use({ storageState: AUTH_STATE });
  test("selector de temporada y GP cabe en viewport 375px", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/lineups");
    await expect(page.getByRole("heading", { name: /Temporada y GP/i })).toBeVisible();
    await assertNoHorizontalOverflow(page);
  });

  test("selector de temporada y GP cabe en viewport 390px", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/lineups");
    await expect(page.getByRole("heading", { name: /Temporada y GP/i })).toBeVisible();
    await assertNoHorizontalOverflow(page);
  });

  test("selector de temporada y GP cabe en viewport 430px", async ({ page }) => {
    await page.setViewportSize({ width: 430, height: 932 });
    await page.goto("/lineups");
    await expect(page.getByRole("heading", { name: /Temporada y GP/i })).toBeVisible();
    await assertNoHorizontalOverflow(page);
  });

  test("todos los campos del lineup son touch targets ≥ 44px en 375px", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await openBuilder(page);
    await assertTouchTargets(page);
  });

  test("todos los campos del lineup son touch targets ≥ 44px en 390px", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openBuilder(page);
    await assertTouchTargets(page);
  });

  test("todos los campos del lineup son touch targets ≥ 44px en 430px", async ({ page }) => {
    await page.setViewportSize({ width: 430, height: 932 });
    await openBuilder(page);
    await assertTouchTargets(page);
  });

  test("botón 'Guardar lineup' es alcanzable en 375px", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await openBuilder(page);
    // El botón está deshabilitado hasta completar los 6 slots, pero debe estar en el DOM.
    const button = page.getByRole("button", { name: /Guardar lineup/i });
    await expect(button).toHaveCount(1);
  });

  test("botón 'Guardar lineup' es alcanzable en 390px", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openBuilder(page);
    const button = page.getByRole("button", { name: /Guardar lineup/i });
    await expect(button).toHaveCount(1);
  });

  test("botón 'Guardar lineup' es alcanzable en 430px", async ({ page }) => {
    await page.setViewportSize({ width: 430, height: 932 });
    await openBuilder(page);
    const button = page.getByRole("button", { name: /Guardar lineup/i });
    await expect(button).toHaveCount(1);
  });

  test("información de presupuesto no se desborda en 375px", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await openBuilder(page);
    await expect(page.getByText(/Presupuesto:/i)).toBeVisible();
    await assertNoHorizontalOverflow(page);
  });

  test("información de presupuesto no se desborda en 390px", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openBuilder(page);
    await expect(page.getByText(/Presupuesto:/i)).toBeVisible();
    await assertNoHorizontalOverflow(page);
  });

  test("información de presupuesto no se desborda en 430px", async ({ page }) => {
    await page.setViewportSize({ width: 430, height: 932 });
    await openBuilder(page);
    await expect(page.getByText(/Presupuesto:/i)).toBeVisible();
    await assertNoHorizontalOverflow(page);
  });
});

// ─────────────────────────── dashboard ligas ───────────────────────────

test.describe("dashboard de ligas — T-16", () => {
  test("lista de ligas cabe en viewport 375px", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/ligas");
    await expect(page.getByRole("heading", { name: /Mis ligas/i })).toBeVisible();
    await assertNoHorizontalOverflow(page);
  });

  test("lista de ligas cabe en viewport 390px", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/ligas");
    await expect(page.getByRole("heading", { name: /Mis ligas/i })).toBeVisible();
    await assertNoHorizontalOverflow(page);
  });

  test("lista de ligas cabe en viewport 430px", async ({ page }) => {
    await page.setViewportSize({ width: 430, height: 932 });
    await page.goto("/ligas");
    await expect(page.getByRole("heading", { name: /Mis ligas/i })).toBeVisible();
    await assertNoHorizontalOverflow(page);
  });
});

// ─────────────────────────── directorio de ligas públicas ───────────────────────────

test.describe("directorio de ligas públicas — T-16", () => {
  test("directorio cabe en viewport 375px", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/ligas");
    await assertNoHorizontalOverflow(page);
  });

  test("directorio cabe en viewport 390px", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/ligas");
    await assertNoHorizontalOverflow(page);
  });

  test("directorio cabe en viewport 430px", async ({ page }) => {
    await page.setViewportSize({ width: 430, height: 932 });
    await page.goto("/ligas");
    await assertNoHorizontalOverflow(page);
  });
});

// ─────────────────────────── resultados y ranking ───────────────────────────

test.describe("resultados y ranking — T-16", () => {
  test("página de resultados cabe en viewport 375px", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/resultados");
    await assertNoHorizontalOverflow(page);
  });

  test("página de resultados cabe en viewport 390px", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/resultados");
    await assertNoHorizontalOverflow(page);
  });

  test("página de resultados cabe en viewport 430px", async ({ page }) => {
    await page.setViewportSize({ width: 430, height: 932 });
    await page.goto("/resultados");
    await assertNoHorizontalOverflow(page);
  });

  test("página de puntuación cabe en viewport 375px", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/puntuacion");
    await assertNoHorizontalOverflow(page);
  });

  test("página de puntuación cabe en viewport 390px", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/puntuacion");
    await assertNoHorizontalOverflow(page);
  });

  test("página de puntuación cabe en viewport 430px", async ({ page }) => {
    await page.setViewportSize({ width: 430, height: 932 });
    await page.goto("/puntuacion");
    await assertNoHorizontalOverflow(page);
  });
});

// ─────────────────────────── mercado ───────────────────────────

test.describe("mercado — T-16", () => {
  test("mercado cabe en viewport 375px", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/mercado");
    await assertNoHorizontalOverflow(page);
  });

  test("mercado cabe en viewport 390px", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/mercado");
    await assertNoHorizontalOverflow(page);
  });

  test("mercado cabe en viewport 430px", async ({ page }) => {
    await page.setViewportSize({ width: 430, height: 932 });
    await page.goto("/mercado");
    await assertNoHorizontalOverflow(page);
  });
});

// ─────────────────────────── cabecera global (T-26) ───────────────────────────

/**
 * Verifica que los controles interactivos visibles de la cabecera global
 * (T-26) tienen touch target ≥ 44px en móvil. Se abre el menú hamburguesa
 * antes de medir para que nav + sesión estén visibles (cerrados, quedan
 * `display:none` y no cuentan).
 */
async function assertHeaderTouchTargets(page: Page): Promise<void> {
  const burger = page.getByRole("button", { name: /Abrir menú/i });
  if (await burger.isVisible()) {
    await burger.click();
  }
  const violations = await page.evaluate(() => {
    const header = document.querySelector("header");
    if (!header) return ["<header> no encontrado"];
    const interactive = header.querySelectorAll("button, a");
    const bad: Array<{
      tag: string;
      class: string;
      width: number;
      height: number;
    }> = [];
    interactive.forEach((el) => {
      const rect = el.getBoundingClientRect();
      // Solo elementos renderizados (los `display:none` devuelven 0×0).
      if (rect.width === 0 && rect.height === 0) return;
      if (rect.width < 44 || rect.height < 44) {
        bad.push({
          tag: el.tagName,
          class: el.className,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        });
      }
    });
    return bad;
  });
  expect(violations).toEqual([]);
}

test.describe("cabecera global — T-26 (móvil)", () => {
  test("cabecera no se desborda en 375px", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await assertNoHorizontalOverflow(page);
  });

  test("cabecera no se desborda en 390px", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await assertNoHorizontalOverflow(page);
  });

  test("cabecera no se desborda en 430px", async ({ page }) => {
    await page.setViewportSize({ width: 430, height: 932 });
    await page.goto("/");
    await assertNoHorizontalOverflow(page);
  });

  test("hamburguesa abre el menú de secciones en 375px", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    const burger = page.getByRole("button", { name: /Abrir menú/i });
    await expect(burger).toBeVisible();
    await burger.click();
    await expect(page.getByRole("button", { name: /Cerrar menú/i })).toBeVisible();
    // La nav de secciones queda accesible al abrir el menú.
    await expect(page.getByRole("navigation", { name: /Secciones/i })).toBeVisible();
  });

  test("controles de la cabecera son touch targets ≥ 44px en 375px", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/");
    await assertHeaderTouchTargets(page);
  });

  test("controles de la cabecera son touch targets ≥ 44px en 390px", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await assertHeaderTouchTargets(page);
  });

  test("controles de la cabecera son touch targets ≥ 44px en 430px", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 430, height: 932 });
    await page.goto("/");
    await assertHeaderTouchTargets(page);
  });
});

// ─────────────────────────── login / registro ───────────────────────────

test.describe("auth — T-16", () => {
  test("formulario de login cabe en viewport 375px", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/login");
    await assertNoHorizontalOverflow(page);
  });

  test("formulario de login cabe en viewport 390px", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/login");
    await assertNoHorizontalOverflow(page);
  });

  test("formulario de login cabe en viewport 430px", async ({ page }) => {
    await page.setViewportSize({ width: 430, height: 932 });
    await page.goto("/login");
    await assertNoHorizontalOverflow(page);
  });

  test("formulario de registro cabe en viewport 375px", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/registro");
    await assertNoHorizontalOverflow(page);
  });

  test("formulario de registro cabe en viewport 390px", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/registro");
    await assertNoHorizontalOverflow(page);
  });

  test("formulario de registro cabe en viewport 430px", async ({ page }) => {
    await page.setViewportSize({ width: 430, height: 932 });
    await page.goto("/registro");
    await assertNoHorizontalOverflow(page);
  });

  // Barrido P2 (auth): gate de regresión de la Regla de los 44 en login/registro
  // (antes solo corría en el builder; un cambio de CSS futuro podría romperla
  // en auth sin que el gate lo detectara).
  test("login: todos los controles son touch targets ≥ 44px en 375px", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/login");
    await assertTouchTargets(page);
  });

  test("login: todos los controles son touch targets ≥ 44px en 390px", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/login");
    await assertTouchTargets(page);
  });

  test("login: todos los controles son touch targets ≥ 44px en 430px", async ({ page }) => {
    await page.setViewportSize({ width: 430, height: 932 });
    await page.goto("/login");
    await assertTouchTargets(page);
  });

  test("registro: todos los controles son touch targets ≥ 44px en 375px", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/registro");
    await assertTouchTargets(page);
  });

  test("registro: todos los controles son touch targets ≥ 44px en 390px", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/registro");
    await assertTouchTargets(page);
  });

  test("registro: todos los controles son touch targets ≥ 44px en 430px", async ({ page }) => {
    await page.setViewportSize({ width: 430, height: 932 });
    await page.goto("/registro");
    await assertTouchTargets(page);
  });
});
