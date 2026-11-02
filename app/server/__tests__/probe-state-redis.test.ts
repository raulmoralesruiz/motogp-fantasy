/**
 * Tests de `redisProbeStateStore` (T-14, ADR-0036): implementa
 * `ProbeStateStore` sobre Redis (clave `mon:source:probe`, JSON).
 *
 * Se mockea `../redis` (mismo patrón que `rate-limit-redis.test.ts`),
 * verificando: clave, serialización, parseo defensivo (JSON corrupto ⇒
 * estado ausente) y la semántica de la transición (éxito resetea, fallo
 * suma, `lastError` se conserva al recuperar).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redis: {
    get: vi.fn(),
    set: vi.fn(),
  },
}));

vi.mock("../redis", () => ({ redis: mocks.redis }));

import {
  PROBE_STATE_KEY,
  redisProbeStateStore,
} from "../probe-state-redis";

const T0 = new Date("2026-11-02T10:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.redis.get.mockResolvedValue(null);
  mocks.redis.set.mockResolvedValue("OK");
});

describe("redisProbeStateStore (T-14, ADR-0036)", () => {
  it("read(): clave estable `mon:source:probe`", async () => {
    await redisProbeStateStore.read();
    expect(mocks.redis.get).toHaveBeenCalledWith(PROBE_STATE_KEY);
    expect(PROBE_STATE_KEY).toBe("mon:source:probe");
  });

  it("read(): clave ausente ⇒ null", async () => {
    mocks.redis.get.mockResolvedValue(null);
    expect(await redisProbeStateStore.read()).toBeNull();
  });

  it("read(): JSON válido ⇒ ProbeState", async () => {
    const state = {
      consecutiveFailures: 2,
      lastError: "HTTP 503",
      lastAttemptAt: T0.toISOString(),
      lastSuccessAt: null,
      lastLatencyMs: null,
    };
    mocks.redis.get.mockResolvedValue(JSON.stringify(state));

    expect(await redisProbeStateStore.read()).toEqual(state);
  });

  it("read(): JSON corrupto ⇒ null (no lanza)", async () => {
    mocks.redis.get.mockResolvedValue("esto no es JSON{");
    expect(await redisProbeStateStore.read()).toBeNull();
  });

  it("read(): JSON sin campo obligatorio ⇒ null (defensivo)", async () => {
    mocks.redis.get.mockResolvedValue(JSON.stringify({ lastError: "x" }));
    expect(await redisProbeStateStore.read()).toBeNull();
  });

  it("recordAttempt(fallo): get + set con el estado serializado", async () => {
    const out = await redisProbeStateStore.recordAttempt({
      ok: false,
      error: "HTTP 503",
      latencyMs: null,
      at: T0,
    });

    expect(mocks.redis.set).toHaveBeenCalledTimes(1);
    const [key, raw] = mocks.redis.set.mock.calls[0] as unknown as [
      string,
      string,
    ];
    expect(key).toBe(PROBE_STATE_KEY);
    expect(JSON.parse(raw)).toEqual({
      consecutiveFailures: 1,
      lastError: "HTTP 503",
      lastAttemptAt: T0.toISOString(),
      lastSuccessAt: null,
      lastLatencyMs: null,
    });
    expect(out).toEqual(JSON.parse(raw));
  });

  it("recordAttempt(éxito): resetea fallos y conserva el último error", async () => {
    const prev = {
      consecutiveFailures: 4,
      lastError: "timeout",
      lastAttemptAt: T0.toISOString(),
      lastSuccessAt: null,
      lastLatencyMs: null,
    };
    mocks.redis.get.mockResolvedValue(JSON.stringify(prev));

    const out = await redisProbeStateStore.recordAttempt({
      ok: true,
      error: null,
      latencyMs: 120,
      at: T0,
    });

    expect(out.consecutiveFailures).toBe(0);
    expect(out.lastError).toBe("timeout");
    expect(out.lastSuccessAt).toBe(T0.toISOString());
    expect(out.lastLatencyMs).toBe(120);
  });

  it("recordAttempt(fallo) con estado previo: suma el contador", async () => {
    const prev = {
      consecutiveFailures: 1,
      lastError: "e0",
      lastAttemptAt: T0.toISOString(),
      lastSuccessAt: null,
      lastLatencyMs: null,
    };
    mocks.redis.get.mockResolvedValue(JSON.stringify(prev));

    const out = await redisProbeStateStore.recordAttempt({
      ok: false,
      error: "e1",
      latencyMs: null,
      at: T0,
    });

    expect(out.consecutiveFailures).toBe(2);
    expect(out.lastError).toBe("e1");
  });
});
