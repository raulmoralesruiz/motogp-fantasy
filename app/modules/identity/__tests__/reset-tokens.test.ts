import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { evaluateResetToken, generateResetToken, hashResetToken } from "../reset-tokens";

describe("reset-tokens · generación y hash (US-02 CA)", () => {
  it("genera un token aleatorio de 256 bits (64 hex)", () => {
    expect(generateResetToken()).toMatch(/^[0-9a-f]{64}$/);
  });

  it("genera tokens únicos", () => {
    expect(generateResetToken()).not.toBe(generateResetToken());
  });

  it("hashResetToken es el SHA-256 del token (determinista, distinto del claro)", () => {
    const token = generateResetToken();
    const hash = hashResetToken(token);
    expect(hash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(hash).not.toBe(token);
    expect(hashResetToken(token)).toBe(hash);
  });
});

describe("reset-tokens · decisión pura evaluateResetToken (US-02 CA)", () => {
  const now = new Date("2026-10-16T12:00:00Z");

  it("token inexistente → not_found", () => {
    expect(evaluateResetToken(null, now)).toBe("not_found");
  });

  it("token usado → used (aunque no esté expirado)", () => {
    expect(
      evaluateResetToken(
        {
          usedAt: new Date("2026-10-16T11:00:00Z"),
          expiresAt: new Date("2026-10-16T13:00:00Z"),
        },
        now,
      ),
    ).toBe("used");
  });

  it("token expirado → expired", () => {
    expect(
      evaluateResetToken(
        { usedAt: null, expiresAt: new Date("2026-10-16T11:00:00Z") },
        now,
      ),
    ).toBe("expired");
  });

  it("expiración exacta (expiresAt === now) → expired", () => {
    expect(evaluateResetToken({ usedAt: null, expiresAt: now }, now)).toBe("expired");
  });

  it("token vigente → valid", () => {
    expect(
      evaluateResetToken(
        { usedAt: null, expiresAt: new Date("2026-10-16T13:00:00Z") },
        now,
      ),
    ).toBe("valid");
  });
});
