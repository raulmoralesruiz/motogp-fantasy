/**
 * T-11 (docs/architecture/testing.md §2.4 · capa E2E): unirse a una liga
 * por código de invitación (US-25, ADR-0025), incluidos los casos de error:
 * código inválido y liga llena.
 *
 * Diseño de sesiones (una cookie `session` por contexto de navegador):
 * - El contexto principal trae la sesión del usuario E2E compartido
 *   (`auth-state.json`, la crea `globalSetup`) y actúa como creador de liga.
 * - Cada "unirse" usa un contexto fresco con un usuario nuevo registrado
 *   (así la cookie del creador no se sobreescribe y cada unirse parte de
 *   cero, como un extraño real).
 *
 * Anti-fuerza-bruta (US-25): los intentos de unión por IP caben dentro de
 * `LEAGUE_JOIN_RATE_LIMIT_MAX` (10/ventana) y los fallos (2) quedan por
 * debajo del umbral de bloqueo (5) — ver `app/server/env.ts`.
 *
 * Requisitos previos: `docker compose up -d`, `npm run dev` y
 * `npm run seed:fiction` (mismo contrato que `responsive.test.ts`).
 */

import { test, expect, type Page, type BrowserContext } from "@playwright/test";

const AUTH_STATE = `${process.cwd()}/test/e2e/auth-state.json`;
const PASSWORD = "Password123";

/** Sufijo aleatorio por test para no colisionar con el dataset ficticio. */
function uniq(prefix: string): string {
  // Solo alfanumérico + guion bajo: el regex de usernameSchema es ^[a-zA-Z0-9_]+$
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

interface NewLeague {
  id: string;
  name: string;
  code: string;
}

/**
 * Crea una liga privada por código (tRPC, en la sesión del creador). Es
 * setup de los tests: lo que se verifica por UI es el flujo de "unirse".
 */
async function createLeagueViaApi(
  page: Page,
  name: string,
  maxMembers: number,
): Promise<NewLeague> {
  const res = await page.request.post("/api/trpc/leagues.create", {
    data: {
      json: {
        name,
        type: "private",
        visibility: "private",
        // Las ligas exigen min ≥ 2 (leagues.md §2); la liga "llena" usa
        // min = max = 2: creador (1 plaza) + relleno (1 plaza) → llena.
        minMembers: 2,
        maxMembers,
        entryMode: "code",
      },
    },
  });
  expect(res.ok(), `leagues.create falló (${res.status()})`).toBeTruthy();
  const body = await res.json();
  // Transformer superjson: el payload vive en `result.data.json`.
  const data = body?.result?.data?.json;
  if (!data?.id || !data?.code) {
    throw new Error(
      `E2E: leagues.create devolvió una respuesta sin id/código: ${JSON.stringify(body).slice(0, 200)}`,
    );
  }
  return { id: data.id, name: data.name, code: data.code };
}

/** Registra un usuario nuevo en un contexto (setup, no PII: solo local/CI). */
async function registerUser(
  context: BrowserContext,
  prefix: string,
): Promise<void> {
  const res = await context.request.post("/api/trpc/auth.register", {
    data: {
      json: {
        email: `e2e-${prefix}@ficticio.test`,
        username: `e2e_${prefix}`,
        password: PASSWORD,
        termsAccepted: true,
      },
    },
  });
  if (!res.ok()) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `auth.register de ${prefix} falló (${res.status()}): ${body.slice(0, 300)}`,
    );
  }
}

test.describe("unirse a liga por código (US-25) — T-11", () => {
  test.use({ storageState: AUTH_STATE });
  test.setTimeout(120_000);

  test("código válido: el externo se une y ve la liga en el detalle", async ({
    page,
    context,
  }) => {
    const leagueName = `E2E Liga ${Date.now().toString(36)}`;
    const league = await createLeagueViaApi(page, leagueName, 50);

    const joinerCtx = await (await context.browser() as import("@playwright/test").Browser).newContext();
    try {
      const joiner = await joinerCtx.newPage();
      await registerUser(joinerCtx, uniq("liga"));

      await joiner.goto("/unirse");
      await joiner.getByLabel("Código de invitación").fill(league.code);
      await joiner.getByRole("button", { name: "Unirme" }).click();

      // Redirige al detalle y el externo ya es miembro.
      await expect(joiner).toHaveURL(new RegExp(`/ligas/${league.id}$`));
      await expect(joiner.getByRole("heading", { name: leagueName })).toBeVisible();
    } finally {
      await joinerCtx.close();
    }
  });

  test("código inválido: error en español y no se unió", async ({ page }) => {
    await page.goto("/unirse");
    await page.getByLabel("Código de invitación").fill("NOEXISTE000");
    await page.getByRole("button", { name: "Unirme" }).click();

    await expect(page.getByText("El código no es válido.")).toBeVisible();
    await expect(page).toHaveURL(/\/unirse$/);
  });

  test("liga llena: la plaza extra se rechaza con motivo en español", async ({
    page,
    context,
  }) => {
    // Liga con máx. 2 miembros: el creador ocupa 1 plaza…
    const league = await createLeagueViaApi(page, `E2E Liga llena ${Date.now().toString(36)}`, 2);

    // …y un "relleno" (setup por tRPC) ocupa la segunda.
    const fillerCtx = await (await context.browser() as import("@playwright/test").Browser).newContext();
    try {
      await registerUser(fillerCtx, uniq("r"));
      const joinRes = await fillerCtx.request.post("/api/trpc/leagues.join", {
        data: { json: { code: league.code } },
      });
      expect(
        joinRes.ok(),
        `leagues.join del relleno falló (${joinRes.status()})`,
      ).toBeTruthy();
    } finally {
      await fillerCtx.close();
    }

    // El tercer usuario (por UI) no entra: liga llena.
    const thirdCtx = await (await context.browser() as import("@playwright/test").Browser).newContext();
    try {
      const third = await thirdCtx.newPage();
      await registerUser(thirdCtx, uniq("t"));

      await third.goto("/unirse");
      await third.getByLabel("Código de invitación").fill(league.code);
      await third.getByRole("button", { name: "Unirme" }).click();

      await expect(third.getByText("La liga está llena.")).toBeVisible();
      await expect(third).toHaveURL(/\/unirse$/);
    } finally {
      await thirdCtx.close();
    }
  });
});
