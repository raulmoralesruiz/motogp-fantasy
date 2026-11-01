/**
 * Tests de `LogNotificationSender` (US-36, ADR-0033): loguea la
 * notificación con una etiqueta estable para grep en los logs.
 */
import { describe, expect, it, vi } from "vitest";

import { LogNotificationSender } from "../email-sender";

describe("LogNotificationSender (US-36)", () => {
  it("logea destinatario y asunto con la etiqueta estable", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const sender = new LogNotificationSender();

    await sender.send({
      to: "ana@liga.com",
      subject: "Resultados definitivos: GP (ronda 19)",
      html: "<p>Hola</p>",
    });

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0]?.[0]).toContain("[notification]");
    expect(logSpy.mock.calls[0]?.[0]).toContain("destinatario=ana@liga.com");
    expect(logSpy.mock.calls[0]?.[0]).toContain("asunto=\"Resultados definitivos: GP (ronda 19)\"");
    logSpy.mockRestore();
  });
});
