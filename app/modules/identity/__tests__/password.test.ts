/**
 * Tests de `password.ts` (US-01, T-24): round-trip argon2id, verificación
 * contra hash malformado (debe devolver `false`, no lanzar) y el hash de
 * relleno memoizado (anti-enumeración).
 */
import { describe, expect, it } from "vitest";

import { getDummyHash, hashPassword, verifyPassword } from "../password.js";

describe("password (US-01)", () => {
  it("round-trip: verifica la contraseña correcta y rechaza otra", async () => {
    const hash = await hashPassword("clave-secreta-1");
    expect(hash).toMatch(/^\$argon2/);
    await expect(verifyPassword("clave-secreta-1", hash)).resolves.toBe(true);
    await expect(verifyPassword("otra-clave", hash)).resolves.toBe(false);
  });

  it("hash malformado → false (sin lanzar)", async () => {
    await expect(verifyPassword("clave-secreta-1", "no-es-un-hash-argon2")).resolves.toBe(
      false,
    );
  });

  it("getDummyHash: memoizado (mismo valor en llamadas sucesivas)", async () => {
    const [first, second] = await Promise.all([getDummyHash(), getDummyHash()]);
    expect(first).toBe(second);
    expect(first).toMatch(/^\$argon2/);
  });
});
