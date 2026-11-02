/**
 * Tests de `MemoryProbeStateStore` (T-14, ADR-0036): el estado acumulado
 * del health-check de la fuente.
 *
 * Semántica (coherente con `source_state`, ADR-0019):
 * - éxito: `consecutiveFailures = 0`, `lastSuccessAt` actualizado;
 *   **NO limpia `lastError`** (auditoría del último fallo visto).
 * - fallo: `consecutiveFailures + 1`, `lastError` actualizado.
 */
import { describe, expect, it } from "vitest";

import { MemoryProbeStateStore } from "../probe-state";

const T0 = new Date("2026-11-02T10:00:00Z");
const T1 = new Date("2026-11-02T10:05:00Z");
const T2 = new Date("2026-11-02T10:10:00Z");

describe("MemoryProbeStateStore (T-14, ADR-0036)", () => {
  it("read() ⇒ null hasta que hay una sonda", async () => {
    const store = new MemoryProbeStateStore();
    expect(await store.read()).toBeNull();
  });

  it("fallo: incrementa y registra el error", async () => {
    const store = new MemoryProbeStateStore();

    const s1 = await store.recordAttempt({
      ok: false,
      error: "HTTP 503",
      latencyMs: null,
      at: T0,
    });

    expect(s1.consecutiveFailures).toBe(1);
    expect(s1.lastError).toBe("HTTP 503");
    expect(s1.lastSuccessAt).toBeNull();
    expect(s1.lastAttemptAt).toBe(T0.toISOString());
    expect(s1.lastLatencyMs).toBeNull();
  });

  it("fallo sobre fallo: suma (2 → 3)", async () => {
    const store = new MemoryProbeStateStore();
    await store.recordAttempt({ ok: false, error: "e1", latencyMs: null, at: T0 });

    const s2 = await store.recordAttempt({
      ok: false,
      error: "timeout",
      latencyMs: null,
      at: T1,
    });

    expect(s2.consecutiveFailures).toBe(2);
    expect(s2.lastError).toBe("timeout");
  });

  it("éxito: resetea a 0, actualiza lastSuccessAt y conserva lastError (auditoría)", async () => {
    const store = new MemoryProbeStateStore();
    await store.recordAttempt({ ok: false, error: "e1", latencyMs: null, at: T0 });
    await store.recordAttempt({ ok: false, error: "e2", latencyMs: null, at: T1 });

    const ok = await store.recordAttempt({
      ok: true,
      error: null,
      latencyMs: 180,
      at: T2,
    });

    expect(ok.consecutiveFailures).toBe(0);
    expect(ok.lastSuccessAt).toBe(T2.toISOString());
    expect(ok.lastError).toBe("e2"); // conserva el último fallo
    expect(ok.lastLatencyMs).toBe(180);
  });

  it("read() devuelve una copia (mutar la respuesta no corrompe el store)", async () => {
    const store = new MemoryProbeStateStore();
    await store.recordAttempt({ ok: false, error: "e1", latencyMs: null, at: T0 });

    const snapshot = (await store.read())!;
    snapshot.consecutiveFailures = 999;

    expect((await store.read())!.consecutiveFailures).toBe(1);
  });

  it("read() tras éxito devuelve lastSuccessAt correcta", async () => {
    const store = new MemoryProbeStateStore();
    await store.recordAttempt({ ok: false, error: "e1", latencyMs: null, at: T0 });
    await store.recordAttempt({ ok: true, error: null, latencyMs: 90, at: T1 });

    const state = await store.read();
    expect(state).toEqual({
      consecutiveFailures: 0,
      lastError: "e1",
      lastAttemptAt: T1.toISOString(),
      lastSuccessAt: T1.toISOString(),
      lastLatencyMs: 90,
    });
  });
});
