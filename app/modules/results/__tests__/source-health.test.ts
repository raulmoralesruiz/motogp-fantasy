/**
 * Tests del health-check de la fuente (T-14, ADR-0036): `probeSource` con
 * `fetchImpl` inyectado (sin red).
 *
 * Semánticas cubiertas:
 * - ok: 2xx + lista de temporadas → `{ ok: true, latencyMs, error: null }`.
 * - fallo HTTP (no 2xx) → `{ ok: false, error: "HTTP <status>" }`.
 * - cuerpo no esperado (no-array) → `{ ok: false, error }`.
 * - error de red / timeout → `{ ok: false, error }` (nunca lanza).
 * - latencia medida con el reloj; `probedAt` inyectado (testable).
 * - error truncado a 500 (coherente con `last_error` de `source_state`).
 * - `baseUrl`/`endpoint` por defecto: el adapter de resultados
 *   (`api.motogp.pulselive.com/…/results/seasons`).
 */
import { describe, expect, it } from "vitest";

import {
  PULSELIVE_PROBE_ENDPOINT,
  probeSource,
} from "../source-health";
import { PULSELIVE_BASE_URL } from "../pulselive-source";

const NOW = new Date("2026-11-02T10:00:00Z");

/** fetch falso que responde con `body` (JSON) o lanza `error`. */
function fakeFetch(opts: {
  status?: number;
  body?: unknown;
  notJson?: boolean;
  error?: Error;
  delayMs?: number;
}): {
  fetchImpl: typeof fetch;
  calls: Array<{ url: string; signal: AbortSignal | null | undefined }>;
} {
  const calls: Array<{ url: string; signal: AbortSignal | null | undefined }> =
    [];
  const fetchImpl = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = String(input);
    calls.push({ url, signal: init?.signal });
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    if (opts.error) throw opts.error;
    if (opts.notJson) return new Response("esto no es JSON", { status: 200 });
    return new Response(JSON.stringify(opts.body ?? []), {
      status: opts.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe("probeSource (T-14, ADR-0036)", () => {
  it("ok: 2xx con lista de temporadas → ok + latencia, sin error", async () => {
    const { fetchImpl, calls } = fakeFetch({ body: [{ id: "s2026" }] });

    const out = await probeSource({
      fetchImpl,
      timeoutMs: 5000,
      now: NOW,
    });

    expect(out.ok).toBe(true);
    expect(out.error).toBeNull();
    expect(out.latencyMs).toBeTypeOf("number");
    expect(out.probedAt).toEqual(NOW);
    expect(calls).toHaveLength(1);
  });

  it("sonea el endpoint ligero por defecto (adapter de resultados)", async () => {
    const { fetchImpl, calls } = fakeFetch({ body: [] });

    await probeSource({ fetchImpl, timeoutMs: 5000, now: NOW });

    expect(calls[0]!.url).toBe(`${PULSELIVE_BASE_URL}${PULSELIVE_PROBE_ENDPOINT}`);
  });

  it("acepta baseUrl/endpoint custom (proxy/tests)", async () => {
    const { fetchImpl, calls } = fakeFetch({ body: [] });

    await probeSource({
      fetchImpl,
      baseUrl: "https://proxy.test/api",
      endpoint: "/health",
      timeoutMs: 100,
      now: NOW,
    });

    expect(calls[0]!.url).toBe("https://proxy.test/api/health");
  });

  it("fallo HTTP (no 2xx): ok=false + status en el error", async () => {
    const { fetchImpl } = fakeFetch({ status: 503, body: null });

    const out = await probeSource({ fetchImpl, timeoutMs: 5000, now: NOW });

    expect(out.ok).toBe(false);
    expect(out.error).toContain("503");
  });

  it("cuerpo no esperado (JSON pero no-array): ok=false + mensaje", async () => {
    const { fetchImpl } = fakeFetch({ body: { foo: "bar" } });

    const out = await probeSource({ fetchImpl, timeoutMs: 5000, now: NOW });

    expect(out.ok).toBe(false);
    expect(out.error).toContain("lista de temporadas");
  });

  it("cuerpo no parseable (no es JSON): ok=false, nunca lanza", async () => {
    const { fetchImpl } = fakeFetch({ notJson: true });

    const out = await probeSource({ fetchImpl, timeoutMs: 5000, now: NOW });

    expect(out.ok).toBe(false);
    expect(out.error).not.toBeNull();
  });

  it("error de red: nunca lanza; describe el fallo", async () => {
    const { fetchImpl } = fakeFetch({ error: new Error("fetch failed") });

    const out = await probeSource({ fetchImpl, timeoutMs: 5000, now: NOW });

    expect(out.ok).toBe(false);
    expect(out.latencyMs).toBeNull();
    expect(out.error).toContain("fetch failed");
  });

  it("timeout: AbortSignal con el límite + mensaje de timeout", async () => {
    // El fetch "cuelga" hasta que el signal aborta (timeout real de 50 ms).
    const calls: Array<{ url: string; signal: AbortSignal | null | undefined }> =
      [];
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const signal = init?.signal;
      calls.push({ url: String(_input), signal });
      await new Promise<void>((_, reject) => {
        signal?.addEventListener(
          "abort",
          () => reject(new Error("TimeoutError (aborted)")),
          { once: true },
        );
      });
    }) as unknown as typeof fetch;

    const out = await probeSource({ fetchImpl, timeoutMs: 50, now: NOW });

    expect(out.ok).toBe(false);
    expect(out.error).toContain("50 ms");
    expect(calls[0]!.signal).toBeInstanceOf(AbortSignal);
  });

  it("error truncado a 500 caracteres (coherente con last_error)", async () => {
    const { fetchImpl } = fakeFetch({
      error: new Error("x".repeat(800)),
    });

    const out = await probeSource({ fetchImpl, timeoutMs: 5000, now: NOW });

    expect(out.ok).toBe(false);
    expect((out.error ?? "").length).toBeLessThanOrEqual(
      500 + "PulseLive no es alcanzable: ".length,
    );
  });

  it("la latencia refleja el tiempo de respuesta (reloj real)", async () => {
    const { fetchImpl } = fakeFetch({ body: [], delayMs: 60 });

    const out = await probeSource({ fetchImpl, timeoutMs: 5000, now: NOW });

    expect(out.ok).toBe(true);
    expect(out.latencyMs).toBeGreaterThanOrEqual(50);
  });
});
