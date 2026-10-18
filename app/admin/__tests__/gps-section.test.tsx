// @vitest-environment jsdom
/**
 * Tests de `app/admin/gps-section.tsx` (T-24, fase C): sección de GPs
 * (selector de temporada, lista de GPs con sus acciones y creación manual).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CircuitView, GpView, SeasonWithRules } from "../../modules/seasons";
import { PROVISIONAL_SEASON_RULES } from "../../shared/config/season-rules";
import { asMockFn, mockResult, resetTrpcMocks, trpc } from "../../../test/trpc-mock";
import { render, screen, userEvent } from "../../../test/rtl";

import GpsSection from "../gps-section";

vi.mock("@/trpc/client", () => import("../../../test/trpc-mock"));

const season: SeasonWithRules = {
  id: "s1",
  name: "Temporada 2026",
  year: 2026,
  startDate: null,
  endDate: null,
  status: "planned",
  rules: [
    {
      id: "r1",
      version: "provisional-v1",
      rules: PROVISIONAL_SEASON_RULES,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    },
  ],
};

const circuit: CircuitView = {
  id: "c1",
  name: "Circuito de Jerez",
  country: "España",
  location: "Jerez de la Frontera",
};

const gp: GpView = {
  id: "gp1",
  seasonId: "s1",
  round: 1,
  name: "GP de España",
  circuit,
  date: new Date("2026-04-19T14:00:00Z"),
  status: "scheduled",
  lockoutAt: null,
  events: [
    { id: "e1", type: "q2", orderNum: 1, startTime: null, status: "scheduled" },
    { id: "e2", type: "race", orderNum: 2, startTime: null, status: "scheduled" },
  ],
};

function mockGps(result: Record<string, unknown> = {}) {
  mockResult(trpc.seasons.gps.list.useQuery, {
    data: undefined,
    isPending: true,
    isError: false,
    isSuccess: false,
    error: undefined,
    refetch: vi.fn(),
    ...result,
  });
}

async function selectSeason() {
  const user = userEvent.setup();
  await user.selectOptions(screen.getByLabelText("Temporada"), "s1");
}

describe("GpsSection", () => {
  beforeEach(() => resetTrpcMocks());

  it("pide elegir una temporada cuando no hay ninguna seleccionada", () => {
    render(<GpsSection seasons={[season]} circuits={[circuit]} />);
    expect(screen.getByText("Elige una temporada para ver sus GPs.")).toBeInTheDocument();
    expect(screen.queryByText("Crear GP manual")).not.toBeInTheDocument();
  });

  it("consulta los GPs de la temporada seleccionada", async () => {
    mockGps();
    render(<GpsSection seasons={[season]} circuits={[circuit]} />);
    await selectSeason();
    expect(asMockFn(trpc.seasons.gps.list.useQuery)).toHaveBeenCalledWith(
      { seasonId: "s1" },
      { enabled: true },
    );
  });

  it("muestra el estado de carga mientras consulta", async () => {
    mockGps();
    render(<GpsSection seasons={[season]} circuits={[circuit]} />);
    await selectSeason();
    expect(screen.getByText("Consultando…")).toBeInTheDocument();
  });

  it("muestra el error cuando no se pueden cargar los GPs", async () => {
    mockGps({ isPending: false, isError: true, error: new Error("sin conexión") });
    render(<GpsSection seasons={[season]} circuits={[circuit]} />);
    await selectSeason();
    expect(
      screen.getByText("No se pudieron cargar los GPs: sin conexión"),
    ).toBeInTheDocument();
  });

  it("muestra el estado vacío y el formulario de creación manual", async () => {
    mockGps({ isPending: false, isError: false, isSuccess: true, data: [] });
    render(<GpsSection seasons={[season]} circuits={[circuit]} />);
    await selectSeason();
    expect(screen.getByText("Esta temporada aún no tiene GPs.")).toBeInTheDocument();
    expect(screen.getByText("Crear GP manual")).toBeInTheDocument();
  });

  it("renderiza las acciones de cada GP", async () => {
    mockGps({ isPending: false, isError: false, isSuccess: true, data: [gp] });
    render(<GpsSection seasons={[season]} circuits={[circuit]} />);
    await selectSeason();
    expect(screen.getByText("R1 · GP de España")).toBeInTheDocument();
  });
});
