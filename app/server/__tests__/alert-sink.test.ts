/**
 * Tests del sink de alertas (T-14, ADR-0036): entrega por log + Sentry +
 * email.
 *
 * - Siempre loguea (canal base; `console.warn` con prefijo `[alert]`).
 * - Envía email SI hay destinatario (`to`), vía el sender inyectado.
 * - SIN destinatario: no llama al sender (Sentry + log solo).
 * - **Nunca lanza**: un fallo del sender se loguea y se traga (el ciclo que
 *   dispara la alerta no se rompe).
 * - Los capturers de Sentry son no-op sin DSN (se verifica el no-op en
 *   `sentry.test.ts`); aquí solo se comprueba que el sink no depende de que
 *   el reporteo funcione.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { NotificationEmailSender } from "@/modules/notifications";
import type { OpsAlert } from "@/modules/jobs";

import { createAlertSink } from "../alert-sink";

const ALERT: OpsAlert = {
  kind: "source-probe-failure",
  consecutiveFailures: 3,
  lastError: "timeout",
};

function makeSender(behavior: "ok" | "fail" = "ok") {
  const send = vi.fn(async (mail: { to: string; subject: string; html: string }) => {
    void mail;
    if (behavior === "fail") throw new Error("RESEND 403 (test)");
  });
  return { sender: { send } as NotificationEmailSender, send };
}

describe("createAlertSink (T-14, ADR-0036)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("con destinatario: envía el email con asunto/cuerpo de la alerta", async () => {
    const { sender, send } = makeSender();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const sink = createAlertSink({ to: "ops@example.test", sender });
    await sink.send(ALERT);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toMatchObject({
      to: "ops@example.test",
      subject: expect.stringContaining("[alerta motogp]"),
      html: expect.stringContaining("PulseLive"),
    });
    // El log siempre va (canal base): una sola línea con el asunto.
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("[alert] [alerta motogp]"),
    );
  });

  it("sin destinatario: no llama al sender", async () => {
    const { sender, send } = makeSender();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const sink = createAlertSink({ to: "", sender });
    await sink.send(ALERT);

    expect(send).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it("fallo del sender: NO lanza (el sink nunca propaga)", async () => {
    const { sender } = makeSender("fail");
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const sink = createAlertSink({ to: "ops@example.test", sender });
    await expect(sink.send(ALERT)).resolves.toBeUndefined();

    expect(errorLog).toHaveBeenCalledWith(
      "[alert] fallo enviando el email de la alerta:",
      "RESEND 403 (test)",
    );
  });
});
