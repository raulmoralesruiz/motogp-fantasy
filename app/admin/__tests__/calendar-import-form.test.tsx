// @vitest-environment jsdom
/**
 * Tests de `app/admin/calendar-import-form.tsx` (T-24, fase C): import de
 * calendario en 2 pasos (preview de solo lectura y luego import atómico).
 */
import { fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { NormalizedSeasonCalendar, SeasonWithRules } from "../../modules/seasons";
import { clientError } from "../../../test/errors";
import { mockResult, resetTrpcMocks, trpc, utilsMock } from "../../../test/trpc-mock";
import { render, screen, userEvent } from "../../../test/rtl";

import CalendarImportForm from "../calendar-import-form";

vi.mock("@/trpc/client", () => import("../../../test/trpc-mock"));

const season: SeasonWithRules = {
  id: "s1",
  name: "Temporada 2026",
  year: 2026,
  startDate: null,
  endDate: null,
  status: "planned",
  rules: [],
};

const calendar: NormalizedSeasonCalendar = {
  year: 2026,
  seasonRef: "motogp-2026",
  source: { name: "PulseLive", version: "1.0" },
  gps: [
    {
      round: 1,
      name: "GP de Qatar",
      circuit: { name: "Lusail", country: "Qatar", location: null },
      date: new Date("2026-03-08T14:00:00Z"),
      events: [
        { type: "q1", startTime: null },
        { type: "q2", startTime: null },
        { type: "race", startTime: new Date("2026-03-08T14:00:00Z") },
      ],
    },
    {
      round: 2,
      name: "GP de Argentina",
      circuit: {
        name: "Termas de Río Hondo",
        country: "Argentina",
        location: "Santiago del Estero",
      },
      date: new Date("2026-03-22T17:00:00Z"),
      events: [{ type: "race", startTime: null }],
    },
  ],
};

function mockImport(result: Record<string, unknown> = {}) {
  const mutate = vi.fn();
  mockResult(trpc.seasons.calendar.import.useMutation, {
    mutate,
    isPending: false,
    isError: false,
    ...result,
  });
  return mutate;
}

async function downloadCalendar() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Año"), "2026");
  await user.click(screen.getByRole("button", { name: "1. Descargar calendario" }));
  return screen.findByText(/Calendario 2026/);
}

describe("CalendarImportForm", () => {
  beforeEach(() => resetTrpcMocks());

  it("desactiva la descarga con el año vacío", () => {
    mockImport();
    render(<CalendarImportForm seasons={[season]} onImported={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: "1. Descargar calendario" }),
    ).toBeDisabled();
  });

  it("no descarga con un año no numérico", async () => {
    mockImport();
    render(<CalendarImportForm seasons={[season]} onImported={vi.fn()} />);

    // `fireEvent.change`: userEvent no permite letras en un input number.
    fireEvent.change(screen.getByLabelText("Año"), { target: { value: "abc" } });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "1. Descargar calendario" }));

    expect(utilsMock("seasons.calendar.fetch.fetch")).not.toHaveBeenCalled();
    expect(screen.queryByText(/Calendario \d+/)).not.toBeInTheDocument();
  });

  it("muestra el preview con los GPs y desactiva la import sin temporada", async () => {
    utilsMock("seasons.calendar.fetch.fetch").mockResolvedValue(calendar);
    mockImport();
    render(<CalendarImportForm seasons={[season]} onImported={vi.fn()} />);

    await downloadCalendar();

    expect(screen.getByText(/Calendario 2026/)).toHaveTextContent(
      "fuente: PulseLive 1.0",
    );
    expect(screen.getByText(/R1 · GP de Qatar/)).toBeInTheDocument();
    expect(screen.getByText(/R2 · GP de Argentina/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2. Importar GPs" })).toBeDisabled();
  });

  it("muestra el error cuando la fuente no responde", async () => {
    utilsMock("seasons.calendar.fetch.fetch").mockRejectedValue(
      new Error("fuente no disponible"),
    );
    mockImport();
    render(<CalendarImportForm seasons={[season]} onImported={vi.fn()} />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Año"), "2026");
    await user.click(screen.getByRole("button", { name: "1. Descargar calendario" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("fuente no disponible");
  });

  it("importa el preview en la temporada elegida", async () => {
    utilsMock("seasons.calendar.fetch.fetch").mockResolvedValue(calendar);
    const mutate = mockImport();
    render(<CalendarImportForm seasons={[season]} onImported={vi.fn()} />);

    await downloadCalendar();

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Importar en la temporada"), "s1");
    await user.click(screen.getByRole("button", { name: "2. Importar GPs" }));
    expect(mutate).toHaveBeenCalledWith({ seasonId: "s1", calendar });
  });

  it("confirma la import listando las rondas saltadas", async () => {
    utilsMock("seasons.calendar.fetch.fetch").mockResolvedValue(calendar);
    mockImport({
      isSuccess: true,
      data: {
        seasonId: "s1",
        year: 2026,
        created: 2,
        skipped: [{ round: 1, reason: "ya existe" }],
      },
    });
    render(<CalendarImportForm seasons={[season]} onImported={vi.fn()} />);

    await downloadCalendar();

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Importar en la temporada"), "s1");
    await user.click(screen.getByRole("button", { name: "2. Importar GPs" }));

    expect(screen.getByRole("status")).toHaveTextContent(
      "Importados 2 GPs; 1 saltados (R1).",
    );
  });

  it("confirma la import cuando no hay rondas saltadas", async () => {
    utilsMock("seasons.calendar.fetch.fetch").mockResolvedValue(calendar);
    mockImport({
      isSuccess: true,
      data: { seasonId: "s1", year: 2026, created: 2, skipped: [] },
    });
    render(<CalendarImportForm seasons={[season]} onImported={vi.fn()} />);

    await downloadCalendar();

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Importar en la temporada"), "s1");
    await user.click(screen.getByRole("button", { name: "2. Importar GPs" }));

    expect(screen.getByRole("status")).toHaveTextContent("Importados 2 GPs; 0 saltados.");
  });

  it("muestra el error general cuando falla la import", async () => {
    utilsMock("seasons.calendar.fetch.fetch").mockResolvedValue(calendar);
    const error = clientError("Error interno", {
      code: "INTERNAL_SERVER_ERROR",
      message: "Error interno",
    });
    mockImport({ isError: true, error });
    render(<CalendarImportForm seasons={[season]} onImported={vi.fn()} />);

    await downloadCalendar();

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Importar en la temporada"), "s1");
    await user.click(screen.getByRole("button", { name: "2. Importar GPs" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Error interno");
  });
});
