/**
 * Liveness de la web (T-24): `GET /api/health` responde sin tocar la BD
 * (si responde, el servidor Next.js está arriba).
 */
import { describe, expect, it } from "vitest";

import { GET } from "../route";

describe("GET /api/health", () => {
  it("responde 200 con JSON { ok: true }", async () => {
    const res = GET();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ ok: true });
  });
});
