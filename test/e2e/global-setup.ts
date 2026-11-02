/**
 * T-11 · Setup global E2E (Playwright `globalSetup`).
 *
 * Qué hace (en orden):
 * 1. Espera a que la app esté sana (`/api/health`), con deadline de ~90 s.
 * 2. Deja hueco en las ligas activas (p. ej. la liga de bienvenida, US-31):
 *    el registro se une atómicamente a la liga y si la liga está llena el
 *    registro entero se revierte (ADR-0029). Una corrida E2E registra ~30
 *    usuarios nuevos (3 viewports en paralelo) y todos entran en la liga de
 *    bienvenida (capacidad 50), así que cada corrida borra las membresías
 *    activas no-admin de las ligas activas (conservando a los admins).
 *    Solo afecta a la BD de desarrollo: en CI la BD es fresca y no hay
 *    ligas (sin `WELCOME_LEAGUE_ID` el hook de bienvenida no actúa).
 * 3. Asegura dos usuarios E2E compartidos (login si ya existen — 2 llamadas
 *    contables por run; registro si no — el registro no cuenta para el
 *    rate-limit de login, US-01):
 *    - `e2e_shared` (usuario normal) → `auth-state.json` (storageState):
 *      responsive builder, flujos de liga, resultados, RBAC negativo.
 *    - `e2e_admin` (rol `global_admin`, US-26/RBAC) → `admin-state.json`:
 *      panel de admin (crear temporada, importar resultados, definitivo).
 *
 * Requisitos previos: `docker compose up -d` (postgres + redis) y
 * `npm run dev` en localhost:3000 (en CI, el workflow lo arranca antes).
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const API_URL = `${BASE_URL}/api/trpc`;

/**
 * Usuarios E2E compartidos. Credenciales fijas de solo local/CI (no PII);
 * los emails usan el dominio `.test` (RFC 6761) para no colisionar con el
 * dataset ficticio (`@ficticio.test`).
 */
const SHARED = { email: "e2e-shared@local.test", username: "e2e_shared" };
const ADMIN = { email: "e2e-admin@local.test", username: "e2e_admin" };
const PASSWORD = "Password123";

/**
 * La ruta se resuelve desde `config.configFile` (directorio de
 * `playwright.config.ts` = raíz del repo).
 */
function stateFile(config: { configFile: string }, name: string): string {
  return path.join(path.dirname(config.configFile), "test", "e2e", name);
}

interface StoredCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Lax" | "Strict" | "None";
}

/** Espera a que la app responda sana (deadline ~90 s). */
async function waitForApp(): Promise<void> {
  const deadline = Date.now() + 90_000;
  for (;;) {
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.ok) return;
    } catch {
      /* el servidor aún no está levantado: reintento */
    }
    if (Date.now() > deadline) {
      throw new Error(
        `App no sana en ${BASE_URL}/api/health (¿npm run dev corriendo?)`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}

/**
 * Deja hueco en las ligas activas para los registros de la corrida (US-31:
 * el registro se une de forma atómica a la liga de bienvenida — si la liga
 * está llena, el registro entero se revierte; ADR-0029).
 *
 * Cada corrida BORRA las membresías activas no-admin de las ligas activas
 * (conservando siempre a los admins). No se recorta solo cuando la liga
 * está llena: la suite registra ~30 usuarios nuevos por corrida (auth +
 * ligas × 3 viewports en paralelo) y todos entran en la liga de
 * bienvenida (capacidad 50). Recortar al 10 % de la capacidad solo cuando
 * estaba a tope era un "pilla-pílloras": una corrida dejaba la liga a
 * medias (p. ej. 37/50) y la siguiente no recortaba nada → la corrida
 * volvía a llenarla a mitad y los tests de registro fallaban con
 * "La liga está llena.". Las membresías eliminadas son datos de prueba
 * (usuarios E2E de corridas anteriores); en CI la BD es fresca y esto no
 * borra nada relevante. Devuelve el número de membresías eliminadas.
 */
async function makeRoomInFullLeagues(prisma: PrismaClient): Promise<number> {
  const leagues = await prisma.league.findMany({
    where: { status: "active" },
    select: { id: true },
  });
  let removed = 0;
  for (const league of leagues) {
    const result = await prisma.leagueMember.deleteMany({
      where: { leagueId: league.id, status: "active", role: { not: "admin" } },
    });
    removed += result.count;
  }
  return removed;
}

/** Extrae la cookie `session` de un `Set-Cookie`, fiel a sus atributos. */
function parseSessionCookie(setCookie: string, domain: string): StoredCookie {
  const parts = setCookie.split(";").map((p) => p.trim());
  const first = (parts[0] ?? "").split("=");
  const name = first.shift() ?? "";
  const attrs = parts.slice(1).map((a) => a.toLowerCase());
  const sameSite = attrs.find((a) => a.startsWith("samesite=")) ?? "samesite=lax";
  return {
    name,
    value: first.join("="),
    domain,
    path: "/",
    httpOnly: attrs.includes("httponly"),
    secure: attrs.includes("secure"),
    sameSite:
      sameSite === "samesite=none"
        ? "None"
        : sameSite === "samesite=strict"
          ? "Strict"
          : "Lax",
  };
}

async function extractSessionCookie(
  res: Response,
  what: string,
): Promise<StoredCookie> {
  const domain = new URL(BASE_URL).hostname;
  const setCookie = res.headers.getSetCookie().find((c) => c.startsWith("session="));
  if (!setCookie) throw new Error(`${what}: respuesta sin cookie de sesión`);
  return parseSessionCookie(setCookie, domain);
}

/**
 * Asegura un usuario E2E: login si existe (1 llamada contable por run),
 * registro si no (no cuenta para el rate-limit de login). Si `globalAdmin`
 * es `true`, le garantiza también el rol `global_admin` (RBAC, US-26):
 * upsert de `roles` + `user_roles` (idempotente).
 */
async function ensureUser(
  prisma: PrismaClient,
  user: { email: string; username: string },
  globalAdmin: boolean,
): Promise<StoredCookie> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/auth.login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        json: { email: user.email, password: PASSWORD },
      }),
    });
  } catch {
    throw new Error("App no reachable para el login (¿npm run dev corriendo?)");
  }
  if (!res.ok) {
    res = await fetch(`${API_URL}/auth.register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        json: {
          email: user.email,
          username: user.username,
          password: PASSWORD,
          termsAccepted: true,
        },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `registro del usuario E2E ${user.email} falló (${res.status}): ${body.slice(0, 300)}`,
      );
    }
  }

  if (globalAdmin) {
    const dbUser = await prisma.user.findUniqueOrThrow({
      where: { email: user.email },
    });
    const role = await prisma.role.upsert({
      where: { name: "global_admin" },
      update: {},
      create: { name: "global_admin" },
    });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: dbUser.id, roleId: role.id } },
      update: {},
      create: { userId: dbUser.id, roleId: role.id },
    });
  }

  return extractSessionCookie(res, user.email);
}

function writeState(file: string, cookie: StoredCookie): void {
  writeFileSync(file, JSON.stringify({ cookies: [cookie], origins: [] }, null, 2));
}

export default async function globalSetup(config: {
  configFile: string;
}): Promise<void> {
  const sharedStateFile = stateFile(config, "auth-state.json");
  const adminStateFile = stateFile(config, "admin-state.json");

  await waitForApp();

  const prisma = new PrismaClient();
  try {
    const removed = await makeRoomInFullLeagues(prisma);
    if (removed > 0) {
      console.log(
        `[e2e-setup] ${removed} membresías recortadas en ligas al tope (hace sitio para registros E2E)`,
      );
    }

    const sharedCookie = await ensureUser(prisma, SHARED, false);
    const adminCookie = await ensureUser(prisma, ADMIN, true);
    writeState(sharedStateFile, sharedCookie);
    writeState(adminStateFile, adminCookie);
    console.log(`[e2e-setup] usuario E2E compartido listo → ${sharedStateFile}`);
    console.log(`[e2e-setup] usuario E2E admin (global_admin) listo → ${adminStateFile}`);
  } finally {
    await prisma.$disconnect();
  }
}
