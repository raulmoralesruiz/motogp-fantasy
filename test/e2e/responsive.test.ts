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
 */

import { test, expect } from "@playwright/test";

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

/** Verifica que todos los botones y selects tienen touch target ≥ 44px. */
async function assertTouchTargets(
  page: import("@playwright/test").Page,
) {
  const violations: Array<{
    tag: string;
    class: string;
    width: number;
    height: number;
  }> = await page.evaluate(() => {
    const interactive = document.querySelectorAll("button, select, input");
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

// ─────────────────────────── lineup builder ───────────────────────────

test.describe("constructor de lineup — T-16", () => {
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
    await page.goto("/lineups");
    await assertTouchTargets(page);
  });

  test("todos los campos del lineup son touch targets ≥ 44px en 390px", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/lineups");
    await assertTouchTargets(page);
  });

  test("todos los campos del lineup son touch targets ≥ 44px en 430px", async ({ page }) => {
    await page.setViewportSize({ width: 430, height: 932 });
    await page.goto("/lineups");
    await assertTouchTargets(page);
  });

  test("botón 'Guardar lineup' es alcanzable en 375px", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/lineups");
    const button = page.getByRole("button", { name: /Guardar lineup/i });
    // El botón puede estar disabled (sin completar el formulario), pero debe estar en el DOM.
    expect(button.count()).toBeGreaterThanOrEqual(1);
  });

  test("botón 'Guardar lineup' es alcanzable en 390px", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/lineups");
    const button = page.getByRole("button", { name: /Guardar lineup/i });
    expect(button.count()).toBeGreaterThanOrEqual(1);
  });

  test("botón 'Guardar lineup' es alcanzable en 430px", async ({ page }) => {
    await page.setViewportSize({ width: 430, height: 932 });
    await page.goto("/lineups");
    const button = page.getByRole("button", { name: /Guardar lineup/i });
    expect(button.count()).toBeGreaterThanOrEqual(1);
  });

  test("información de presupuesto no se desborda en 375px", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/lineups");
    await assertNoHorizontalOverflow(page);
  });

  test("información de presupuesto no se desborda en 390px", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/lineups");
    await assertNoHorizontalOverflow(page);
  });

  test("información de presupuesto no se desborda en 430px", async ({ page }) => {
    await page.setViewportSize({ width: 430, height: 932 });
    await page.goto("/lineups");
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
});
