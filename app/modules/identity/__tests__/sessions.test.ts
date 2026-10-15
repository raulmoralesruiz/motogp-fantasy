import { describe, expect, it } from "vitest";

import {
  buildSessionCookie,
  generateSessionToken,
  parseCookieHeader,
  SESSION_COOKIE_NAME,
} from "../sessions";

describe("sessions · cookie (US-01 CA)", () => {
  it("construye la cookie con HttpOnly + Secure + SameSite=Lax + Path=/", () => {
    const cookie = buildSessionCookie("abc123", { maxAgeSec: 604_800, secure: true });
    expect(cookie).toBe(
      `${SESSION_COOKIE_NAME}=abc123; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800; Secure`,
    );
  });

  it("omite Secure cuando secure=false (solo dev local)", () => {
    const cookie = buildSessionCookie("abc123", { maxAgeSec: 100, secure: false });
    expect(cookie).not.toContain("Secure");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
  });

  it("parsea una cabecera Cookie", () => {
    expect(parseCookieHeader("a=1; b=2; c=3")).toEqual({ a: "1", b: "2", c: "3" });
    expect(parseCookieHeader(null)).toEqual({});
    expect(parseCookieHeader("")).toEqual({});
    expect(parseCookieHeader("siniguales; a=1")).toEqual({ a: "1" });
  });

  it("genera tokens opacos de 256 bits (64 hex), únicos", () => {
    const t1 = generateSessionToken();
    const t2 = generateSessionToken();
    expect(t1).toMatch(/^[0-9a-f]{64}$/);
    expect(t1).not.toBe(t2);
  });
});
