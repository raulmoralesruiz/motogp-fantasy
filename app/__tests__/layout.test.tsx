// @vitest-environment jsdom
/**
 * Tests de `app/layout.tsx` (T-24, fase C): layout raíz con el proveedor
 * tRPC (mockeado — el real se cubre en `app/trpc/__tests__/client.test.tsx`).
 */
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "../../test/rtl";

import RootLayout from "../layout";

vi.mock("@/trpc/client", () => import("../../test/trpc-mock"));

describe("RootLayout", () => {
  it("renderiza los hijos dentro de <html lang=es> con el proveedor tRPC", () => {
    render(
      <RootLayout>
        <div>contenido</div>
      </RootLayout>,
    );
    expect(screen.getByText("contenido")).toBeInTheDocument();
    // jsdom hoistea el <html> renderizado al documento raíz.
    expect(document.documentElement.getAttribute("lang")).toBe("es");
  });
});
