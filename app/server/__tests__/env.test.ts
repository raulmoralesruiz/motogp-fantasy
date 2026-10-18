/**
 * Validación del entorno del servidor (T-24).
 *
 * `getServerEnv()` cachea el resultado en una variable de módulo, así que
 * cada test re-importa el módulo con `vi.resetModules()` + `import()`
 * dinámico y controla `process.env` de forma aislada.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ENV_KEYS = [
  "DATABASE_URL",
  "REDIS_URL",
  "SESSION_TTL_DAYS",
  "AUTH_RATE_LIMIT_MAX",
  "AUTH_RATE_LIMIT_WINDOW_SEC",
  "AUTH_LOCKOUT_THRESHOLD",
  "AUTH_LOCKOUT_SEC",
  "SESSION_COOKIE_SECURE",
  "RESET_TOKEN_TTL_SEC",
  "RESET_RATE_LIMIT_MAX",
  "RESET_RATE_LIMIT_WINDOW_SEC",
  "NEXT_PUBLIC_APP_URL",
  "BOOTSTRAP_ADMIN_EMAIL",
] as const;

function setBaseEnv(): void {
  process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
  process.env.REDIS_URL = "redis://localhost:6379/0";
}

async function loadEnvModule() {
  vi.resetModules();
  return import("../env");
}

beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getServerEnv", () => {
  it("devuelve los valores por defecto con un env mínimo", async () => {
    setBaseEnv();
    const { getServerEnv } = await loadEnvModule();
    const env = getServerEnv();
    expect(env.SESSION_TTL_DAYS).toBe(7);
    expect(env.AUTH_RATE_LIMIT_MAX).toBe(10);
    expect(env.AUTH_RATE_LIMIT_WINDOW_SEC).toBe(60);
    expect(env.AUTH_LOCKOUT_THRESHOLD).toBe(5);
    expect(env.AUTH_LOCKOUT_SEC).toBe(900);
    expect(env.RESET_TOKEN_TTL_SEC).toBe(3600);
    expect(env.RESET_RATE_LIMIT_MAX).toBe(5);
    expect(env.RESET_RATE_LIMIT_WINDOW_SEC).toBe(300);
    expect(env.NEXT_PUBLIC_APP_URL).toBe("http://localhost:3000");
    expect(env.BOOTSTRAP_ADMIN_EMAIL).toBe("");
    expect(env.SESSION_COOKIE_SECURE).toBeUndefined();
  });

  it("respete los valores explícitos del env", async () => {
    setBaseEnv();
    process.env.SESSION_TTL_DAYS = "30";
    process.env.NEXT_PUBLIC_APP_URL = "https://app.ejemplo.com";
    process.env.BOOTSTRAP_ADMIN_EMAIL = "admin@ejemplo.com";
    const { getServerEnv } = await loadEnvModule();
    const env = getServerEnv();
    expect(env.SESSION_TTL_DAYS).toBe(30);
    expect(env.NEXT_PUBLIC_APP_URL).toBe("https://app.ejemplo.com");
    expect(env.BOOTSTRAP_ADMIN_EMAIL).toBe("admin@ejemplo.com");
  });

  it("lanza con detalle si falta DATABASE_URL", async () => {
    process.env.REDIS_URL = "redis://localhost:6379/0";
    const { getServerEnv } = await loadEnvModule();
    expect(() => getServerEnv()).toThrowError(/Entorno del servidor inválido/);
    expect(() => getServerEnv()).toThrowError(/DATABASE_URL/);
  });

  it("lanza con detalle si falta REDIS_URL", async () => {
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
    const { getServerEnv } = await loadEnvModule();
    expect(() => getServerEnv()).toThrowError(/REDIS_URL/);
  });

  it("lanza si SESSION_TTL_DAYS no es un entero positivo", async () => {
    setBaseEnv();
    process.env.SESSION_TTL_DAYS = "abc";
    const { getServerEnv } = await loadEnvModule();
    expect(() => getServerEnv()).toThrowError(/SESSION_TTL_DAYS/);
  });

  it("lanza si SESSION_COOKIE_SECURE no es 'true' ni 'false'", async () => {
    setBaseEnv();
    process.env.SESSION_COOKIE_SECURE = "yes";
    const { getServerEnv } = await loadEnvModule();
    expect(() => getServerEnv()).toThrowError(/SESSION_COOKIE_SECURE/);
  });

  it("cachea el resultado: no re-lee el env en la segunda llamada", async () => {
    setBaseEnv();
    const { getServerEnv } = await loadEnvModule();
    const first = getServerEnv();
    process.env.SESSION_TTL_DAYS = "30";
    const second = getServerEnv();
    expect(second).toBe(first);
    expect(second.SESSION_TTL_DAYS).toBe(7);
  });
});

describe("isSessionCookieSecure", () => {
  it("true si SESSION_COOKIE_SECURE=true (aunque sea producción)", async () => {
    setBaseEnv();
    process.env.SESSION_COOKIE_SECURE = "true";
    vi.stubEnv("NODE_ENV", "development");
    const { isSessionCookieSecure } = await loadEnvModule();
    expect(isSessionCookieSecure()).toBe(true);
  });

  it("false si SESSION_COOKIE_SECURE=false (aunque sea producción)", async () => {
    setBaseEnv();
    process.env.SESSION_COOKIE_SECURE = "false";
    vi.stubEnv("NODE_ENV", "production");
    const { isSessionCookieSecure } = await loadEnvModule();
    expect(isSessionCookieSecure()).toBe(false);
  });

  it("por defecto true en producción", async () => {
    setBaseEnv();
    vi.stubEnv("NODE_ENV", "production");
    const { isSessionCookieSecure } = await loadEnvModule();
    expect(isSessionCookieSecure()).toBe(true);
  });

  it("por defecto false fuera de producción", async () => {
    setBaseEnv();
    vi.stubEnv("NODE_ENV", "development");
    const { isSessionCookieSecure } = await loadEnvModule();
    expect(isSessionCookieSecure()).toBe(false);
  });
});
