/**
 * T-08 · Decisiones puras de autorización por roles (security.md §1.5).
 */
import { describe, expect, it } from "vitest";

import { canAccessGlobalAdmin } from "../roles";

describe("canAccessGlobalAdmin (T-08)", () => {
  it("solo global_admin accede al panel de administración", () => {
    expect(canAccessGlobalAdmin(["global_admin"])).toBe(true);
    expect(canAccessGlobalAdmin(["user", "global_admin"])).toBe(true);
  });

  it("el rol user (y la ausencia de roles) no otorgan acceso", () => {
    expect(canAccessGlobalAdmin(["user"])).toBe(false);
    expect(canAccessGlobalAdmin([])).toBe(false);
  });
});
