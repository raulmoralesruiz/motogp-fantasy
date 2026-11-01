/**
 * Tests de `chooseNotificationSender` (US-36, ADR-0033): con API key →
 * `ResendEmailSender` (producción); sin ella → `LogNotificationSender`
 * (dev/provisional).
 */
import { describe, expect, it } from "vitest";

import { LogNotificationSender } from "../email-sender";
import { ResendEmailSender } from "../resend-sender";
import { chooseNotificationSender } from "../sender-selection";

describe("chooseNotificationSender (US-36)", () => {
  it("con API key → ResendEmailSender", () => {
    const sender = chooseNotificationSender({
      apiKey: "re_test_key",
      from: "notificaciones@test.local",
    });
    expect(sender).toBeInstanceOf(ResendEmailSender);
  });

  it("sin API key (vacía) → LogNotificationSender", () => {
    const sender = chooseNotificationSender({
      apiKey: "",
      from: "notificaciones@test.local",
    });
    expect(sender).toBeInstanceOf(LogNotificationSender);
  });

  it("sin API key (ausente) → LogNotificationSender", () => {
    const sender = chooseNotificationSender({
      from: "notificaciones@test.local",
    });
    expect(sender).toBeInstanceOf(LogNotificationSender);
  });
});
