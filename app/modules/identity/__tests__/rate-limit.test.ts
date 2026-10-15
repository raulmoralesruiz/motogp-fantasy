import { describe, expect, it } from "vitest";

import {
  evaluateLoginAttempt,
  InMemoryRateLimitStore,
  shouldLockAccount,
  type RateLimitConfig,
} from "../rate-limit";

const CFG: RateLimitConfig = {
  maxPerWindow: 3,
  windowSec: 60,
  lockoutThreshold: 2,
  lockoutSec: 900,
};

describe("rate-limit · decisión pura (US-01 CA)", () => {
  it("permite mientras la ventana tiene capacidad", () => {
    const d = evaluateLoginAttempt(
      { ipWindowCount: 2, ipWindowRemainingSec: 30, accountLockRemainingSec: 0 },
      CFG,
    );
    expect(d).toEqual({ allowed: true, reason: "ok", retryAfterSec: 0 });
  });

  it("permite hasta maxPerWindow intentos y rechaza el siguiente", () => {
    // maxPerWindow=3: el 3º intento se permite…
    const ok = evaluateLoginAttempt(
      { ipWindowCount: 3, ipWindowRemainingSec: 42, accountLockRemainingSec: 0 },
      CFG,
    );
    expect(ok.allowed).toBe(true);
    // …el 4º se rechaza.
    const d = evaluateLoginAttempt(
      { ipWindowCount: 4, ipWindowRemainingSec: 42, accountLockRemainingSec: 0 },
      CFG,
    );
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("rate_limited");
    expect(d.retryAfterSec).toBe(42);
  });

  it("el bloqueo de cuenta tiene prioridad sobre el rate limit", () => {
    const d = evaluateLoginAttempt(
      { ipWindowCount: 3, ipWindowRemainingSec: 42, accountLockRemainingSec: 120 },
      CFG,
    );
    expect(d).toEqual({ allowed: false, reason: "locked", retryAfterSec: 120 });
  });

  it("bloquea la cuenta al alcanzar el umbral de fallos", () => {
    expect(shouldLockAccount(1, CFG)).toBe(false);
    expect(shouldLockAccount(2, CFG)).toBe(true);
  });
});

describe("InMemoryRateLimitStore · TTL y reloj (US-01 CA)", () => {
  it("ventana fija: permite hasta el máximo, rechaza después y reinicia al expirar", async () => {
    const store = new InMemoryRateLimitStore();
    store.setNow(0);
    expect((await store.recordAttempt("1.1.1.1", 60)).count).toBe(1);
    expect((await store.recordAttempt("1.1.1.1", 60)).count).toBe(2);
    expect((await store.recordAttempt("1.1.1.1", 60)).count).toBe(3);
    // Ventana agotada: el 4º intento se rechaza en la decisión.
    const { count, remainingSec } = await store.recordAttempt("1.1.1.1", 60);
    expect(count).toBe(4);
    const decision = evaluateLoginAttempt(
      {
        ipWindowCount: count,
        ipWindowRemainingSec: remainingSec,
        accountLockRemainingSec: 0,
      },
      CFG,
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("rate_limited");
    // Otra IP no se ve afectada.
    expect((await store.recordAttempt("2.2.2.2", 60)).count).toBe(1);
    // Al expirar la ventana, el contador se reinicia.
    store.setNow(61_000);
    expect((await store.recordAttempt("1.1.1.1", 60)).count).toBe(1);
  });

  it("bloqueo: bloquea durante el lock y lo levanta al expirar", async () => {
    const store = new InMemoryRateLimitStore();
    store.setNow(0);
    await store.lockAccount("ana@example.com", 900);
    expect(await store.lockRemainingSec("ana@example.com")).toBe(900);
    store.setNow(899_500);
    expect(await store.lockRemainingSec("ana@example.com")).toBe(1);
    store.setNow(900_500);
    expect(await store.lockRemainingSec("ana@example.com")).toBe(0);
  });

  it("fallos: contador consecutivo y reset al login correcto", async () => {
    const store = new InMemoryRateLimitStore();
    expect(await store.recordFailure("ana@example.com")).toBe(1);
    expect(await store.recordFailure("ana@example.com")).toBe(2);
    await store.resetFailures("ana@example.com");
    expect(await store.recordFailure("ana@example.com")).toBe(1);
  });
});
