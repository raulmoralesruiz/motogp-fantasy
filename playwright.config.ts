import { defineConfig, devices } from "@playwright/test";

/**
 * Configuración E2E (T-16): verificación responsive en viewports móviles.
 *
 * Se ejecuta contra el dev server (localhost:3000).
 * Asegúrate de tener `docker compose up -d` y `npm run dev` corriendo antes.
 */
export default defineConfig({
  testDir: "./test/e2e",
  // T-11: espera a la app sana, hace sitio en la liga de bienvenida (US-31)
  // y crea el usuario E2E compartido (storageState para tests con sesión).
  globalSetup: "./test/e2e/global-setup.ts",
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "mobile-360",
      // WebKit (default de los devices iOS) no está disponible en este entorno;
      // se fija Chromium con las mismas emulaciones de viewport/touch.
      use: { ...devices["iPhone SE"], defaultBrowserType: "chromium" }, // 375 × 667
    },
    {
      name: "mobile-390",
      use: {
        ...devices["Pixel 5"], // 393 × 851
        viewport: { width: 390, height: 844 },
        defaultBrowserType: "chromium",
      },
    },
    {
      name: "mobile-430",
      use: {
        ...devices["Galaxy S21"], // 412 × 915
        viewport: { width: 430, height: 932 },
        defaultBrowserType: "chromium",
      },
    },
  ],
});
