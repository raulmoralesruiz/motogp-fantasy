/**
 * Tests de `ResendEmailSender` (US-36, ADR-0033): forma de la petición
 * (auth, body), manejo de errores y `fetchImpl` inyectable (sin red).
 *
 * Mismo patrón que `pulselive-source-io.test.ts`: `fetchImpl` es una función
 * que captura las llamadas (sin red).
 */
import { describe, expect, it } from "vitest";

import { ResendEmailSender } from "../resend-sender";

const EMAIL = {
  to: "ana@liga.com",
  subject: "Resultados definitivos: GP (ronda 19)",
  html: "<p>Hola</p>",
};

interface CapturedCall {
  url: string;
  init: RequestInit;
}

function fakeFetch(status: number, body?: string): {
  fetchImpl: typeof fetch;
  calls: CapturedCall[];
} {
  const calls: CapturedCall[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Response(body ?? "", { status });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe("ResendEmailSender (US-36)", () => {
  it("POST a la API con Bearer y el body {from, to, subject, html}", async () => {
    const { fetchImpl, calls } = fakeFetch(202, '{"id":"resend-1"}');
    const sender = new ResendEmailSender({
      apiKey: "re_test_key",
      from: "notificaciones@test.local",
      fetchImpl,
    });

    await sender.send(EMAIL);

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe("https://api.resend.com/emails");
    expect(call.init.method).toBe("POST");
    expect(call.init.headers).toMatchObject({
      Authorization: "Bearer re_test_key",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(call.init.body))).toEqual({
      from: "notificaciones@test.local",
      to: "ana@liga.com",
      subject: EMAIL.subject,
      html: EMAIL.html,
    });
  });

  it("respuesta 2xx ⇒ resuelve", async () => {
    const { fetchImpl } = fakeFetch(202, '{"id":"resend-1"}');
    const sender = new ResendEmailSender({
      apiKey: "re_test_key",
      from: "notificaciones@test.local",
      fetchImpl,
    });
    await expect(sender.send(EMAIL)).resolves.toBeUndefined();
  });

  it("respuesta no 2xx ⇒ lanza con el estado y el detalle", async () => {
    const { fetchImpl } = fakeFetch(400, '{"statusCode":400,"message":"invalid from"}');
    const sender = new ResendEmailSender({
      apiKey: "re_test_key",
      from: "no-verificado@test.local",
      fetchImpl,
    });
    await expect(sender.send(EMAIL)).rejects.toThrow(
      /Resend respondió 400.*invalid from/,
    );
  });

  it("respuesta no 2xx sin cuerpo ⇒ lanza con estado y sin detalle", async () => {
    const { fetchImpl } = fakeFetch(500);
    const sender = new ResendEmailSender({
      apiKey: "re_test_key",
      from: "notificaciones@test.local",
      fetchImpl,
    });
    await expect(sender.send(EMAIL)).rejects.toThrow(/Resend respondió 500/);
  });

  it("url de la API inyectable (tests/proxies)", async () => {
    const { fetchImpl, calls } = fakeFetch(202);
    const sender = new ResendEmailSender({
      apiKey: "re_test_key",
      from: "notificaciones@test.local",
      apiUrl: "https://proxy.test/emails",
      fetchImpl,
    });
    await sender.send(EMAIL);
    expect(calls[0]?.url).toBe("https://proxy.test/emails");
  });
});
