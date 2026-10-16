import { describe, expect, it, vi } from "vitest";

import { LogEmailSender } from "../email";

describe("email · LogEmailSender provisional (US-02, ADR-0009)", () => {
  it("loguea el destinatario y el link con etiqueta estable para grep", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const sender = new LogEmailSender();
      await sender.sendResetLink({
        to: "usuario@example.com",
        link: "http://localhost:3000/reestablecer-contrasena?token=abc123",
      });
      expect(spy).toHaveBeenCalledTimes(1);
      const line = spy.mock.calls[0]?.[0];
      expect(typeof line).toBe("string");
      expect(line).toContain("[reset-link]");
      expect(line).toContain("PROVISIONAL");
      expect(line).toContain("usuario@example.com");
      expect(line).toContain(
        "http://localhost:3000/reestablecer-contrasena?token=abc123",
      );
    } finally {
      spy.mockRestore();
    }
  });
});
