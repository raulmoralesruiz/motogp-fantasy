/**
 * Tests del store de retos TOTP (D-07, ADR-0039): `InMemoryTotpChallengeStore`
 * con reloj inyectable — emisión, resolución, expiración, presupuesto de
 * fallos y consumo.
 */
import { describe, expect, it } from "vitest";

import {
  InMemoryTotpChallengeStore,
  generateTotpChallengeToken,
} from "../totp";

describe("InMemoryTotpChallengeStore", () => {
  it("emite un token opaco y lo resuelve al userId", async () => {
    const store = new InMemoryTotpChallengeStore();
    const token = await store.issue("user-1", 300);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    await expect(store.resolve(token)).resolves.toBe("user-1");
  });

  it("cada reto es único (no colisiona con otro)", async () => {
    const store = new InMemoryTotpChallengeStore();
    const t1 = await store.issue("user-1", 300);
    const t2 = await store.issue("user-2", 300);
    expect(t1).not.toBe(t2);
    await expect(store.resolve(t2)).resolves.toBe("user-2");
  });

  it("un reto expirado no se resuelve (reloj inyectado)", async () => {
    const store = new InMemoryTotpChallengeStore();
    const token = await store.issue("user-1", 60);
    await expect(store.resolve(token)).resolves.toBe("user-1");
    store.setNow(61_000); // 1 s después del TTL
    await expect(store.resolve(token)).resolves.toBeNull();
  });

  it("los fallos se acumulan y se leen con failureCount", async () => {
    const store = new InMemoryTotpChallengeStore();
    const token = await store.issue("user-1", 300);
    expect(await store.failureCount(token)).toBe(0);
    expect(await store.recordFailure(token)).toBe(1);
    expect(await store.recordFailure(token)).toBe(2);
    expect(await store.failureCount(token)).toBe(2);
  });

  it("consume borra el reto y sus fallos (idempotente)", async () => {
    const store = new InMemoryTotpChallengeStore();
    const token = await store.issue("user-1", 300);
    await store.recordFailure(token);
    await store.consume(token);
    await store.consume(token); // segundo consumo sin efecto
    await expect(store.resolve(token)).resolves.toBeNull();
    expect(await store.failureCount(token)).toBe(0);
  });

  it("generateTotpChallengeToken tiene 256 bits de entropía (64 hex)", () => {
    expect(generateTotpChallengeToken()).toMatch(/^[0-9a-f]{64}$/);
    expect(generateTotpChallengeToken()).not.toBe(generateTotpChallengeToken());
  });
});
