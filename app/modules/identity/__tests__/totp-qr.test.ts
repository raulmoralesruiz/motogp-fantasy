/**
 * Tests del QR de matriculación TOTP (D-07, ADR-0039): la data URL es un
 * SVG estático generado en el servidor (la URI lleva el secreto: no sale a
 * servicios externos).
 */
import { describe, expect, it } from "vitest";

import { toTotpQrDataUrl } from "../totp-qr";

describe("toTotpQrDataUrl", () => {
  it("devuelve una data URL SVG", async () => {
    const uri =
      "otpauth://totp/FantasyMotoGP:admin%40liga.com?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=FantasyMotoGP&algorithm=SHA1&digits=6&period=30";
    const dataUrl = await toTotpQrDataUrl(uri);
    expect(dataUrl).toMatch(/^data:image\/svg\+xml;/);
  });

  it("genera QRs distintos para URIs distintas (no es un placeholder)", async () => {
    const a = await toTotpQrDataUrl("otpauth://totp/A?secret=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    const b = await toTotpQrDataUrl("otpauth://totp/B?secret=BBBBBBBBBBBBBBBBBBBBBBBBBBBBBB");
    expect(a).not.toBe(b);
  });
});
