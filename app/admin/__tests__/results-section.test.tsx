// @vitest-environment jsdom
/**
 * Tests de `app/admin/results-section.tsx` (US-16, ADR-0018): sección de
 * importación manual de resultados (temporada → GP → evento y una fila por
 * piloto del mercado).
 *
 * Los IDs de GP/evento/piloto son UUIDs válidos: el schema compartido
 * (`importEventInputSchema`) los valida y el pre-check local del componente
 * no debe rechazar un payload correcto.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EventResultView, GpEventView, ImportEventResult } from "../../modules/results";
import type { RiderView } from "../../modules/market";
import type { CircuitView, GpView, SeasonWithRules } from "../../modules/seasons";
import { PROVISIONAL_SEASON_RULES } from "../../shared/config/season-rules";
import { act, fireEvent, render, screen, userEvent } from "../../../test/rtl";
import { asMockFn, mockResult, resetTrpcMocks, trpc, type MockFn } from "../../../test/trpc-mock";

import ResultsSection from "../results-section";

vi.mock("@/trpc/client", () => import("../../../test/trpc-mock"));

const seasonId = "s1";
const gpId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const eventId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const r1 = "11111111-1111-4111-8111-111111111111";
const r2 = "22222222-2222-4222-8222-222222222222";
const r3 = "33333333-3333-4333-8333-333333333333";

const season: SeasonWithRules = {
  id: seasonId,
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
  id: gpId,
  seasonId,
  round: 1,
  name: "GP de España",
  circuit,
  date: new Date("2026-04-19T14:00:00Z"),
  status: "scheduled",
  lockoutAt: null,
  events: [{ id: eventId, type: "race", orderNum: 2, startTime: null, status: "scheduled" }],
};

const event: GpEventView = {
  id: eventId,
  type: "race",
  orderNum: 2,
  status: "scheduled",
  resultsStatus: null,
};

const riders: RiderView[] = [
  { id: r1, name: "Piloto Uno", number: 1, isActive: true },
  { id: r2, name: "Piloto Dos", number: 2, isActive: true },
  { id: r3, name: "Piloto Tres", number: 3, isActive: true },
];

/** Fila pre-cargada de BD para r1 (2º, vuelta rápida). */
function r1Row(overrides: Partial<EventResultView> = {}): EventResultView {
  return {
    riderId: r1,
    riderName: "Piloto Uno",
    position: 2,
    started: true,
    finished: true,
    penalties: [],
    bonuses: ["fastest-lap"],
    rawPoints: null,
    derivedStatus: "FINISHED",
    status: "provisional",
    resultsVersion: null,
    ...overrides,
  };
}

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

function mockGpEvents(result: Record<string, unknown> = {}) {
  mockResult(trpc.results.gpEvents.useQuery, {
    data: undefined,
    isPending: true,
    isError: false,
    isSuccess: false,
    error: undefined,
    refetch: vi.fn(),
    ...result,
  });
}

function mockRiders(result: Record<string, unknown> = {}) {
  mockResult(trpc.market.riders.list.useQuery, {
    data: undefined,
    isPending: true,
    isError: false,
    isSuccess: false,
    error: undefined,
    refetch: vi.fn(),
    ...result,
  });
}

function mockEventResults(result: Record<string, unknown> = {}) {
  mockResult(trpc.results.eventResults.useQuery, {
    data: undefined,
    isPending: true,
    isError: false,
    isSuccess: false,
    error: undefined,
    refetch: vi.fn(),
    ...result,
  });
}

function mockImport(result: Record<string, unknown> = {}): MockFn {
  const mutate = vi.fn();
  mockResult(trpc.results.importEvent.useMutation, {
    mutate,
    isPending: false,
    isError: false,
    isSuccess: false,
    error: undefined,
    data: undefined,
    ...result,
  });
  return mutate;
}

/** Todo cargado (GP, evento, pilotos, resultados previos) + mutación en reposo. */
function mockLoaded(eventResultsData: EventResultView[] = []): MockFn {
  mockGps({ isPending: false, isError: false, isSuccess: true, data: [gp] });
  mockGpEvents({ isPending: false, isError: false, isSuccess: true, data: [event] });
  mockRiders({ isPending: false, isError: false, isSuccess: true, data: riders });
  mockEventResults({ isPending: false, isError: false, isSuccess: true, data: eventResultsData });
  return mockImport();
}

/** Selecciona temporada → GP → evento y devuelve el `user` para seguir usando. */
async function selectEvent() {
  const user = userEvent.setup();
  await user.selectOptions(screen.getByLabelText("Temporada"), seasonId);
  await user.selectOptions(screen.getByLabelText("GP"), gpId);
  await user.selectOptions(screen.getByLabelText("Evento"), eventId);
  return user;
}

/** Marca una fila nueva terminada con la posición indicada. */
async function markFinished(user: ReturnType<typeof userEvent.setup>, name: string, position: string) {
  await user.click(screen.getByLabelText(`Salió: ${name}`));
  await user.click(screen.getByLabelText(`Terminó: ${name}`));
  await user.type(screen.getByLabelText(`Posición: ${name}`), position);
}

describe("ResultsSection", () => {
  beforeEach(() => resetTrpcMocks());

  it("pide elegir una temporada cuando no hay ninguna seleccionada", () => {
    render(<ResultsSection seasons={[season]} />);
    expect(screen.getByText("Elige una temporada para ver sus GPs.")).toBeInTheDocument();
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
  });

  it("pre-carga las filas ya importadas en BD", async () => {
    mockLoaded([r1Row()]);
    render(<ResultsSection seasons={[season]} />);
    await selectEvent();

    expect(screen.getByLabelText("Salió: Piloto Uno")).toBeChecked();
    expect(screen.getByLabelText("Terminó: Piloto Uno")).toBeChecked();
    // jest-dom convierte el valor de inputs number a número (compareAsSet estricto).
    expect(screen.getByLabelText("Posición: Piloto Uno")).toHaveValue(2);
    expect(screen.getByLabelText("Bono fastest-lap: Piloto Uno")).toBeChecked();
    expect(screen.getByText("FINISHED")).toBeInTheDocument();
    // Las filas vacías sin pre-carga derivan ABSENT.
    expect(screen.getAllByText("ABSENT")).toHaveLength(2);
  });

  it("etiqueta los eventos por tipo y estado de resultados (y marca los cancelados)", async () => {
    const finishedEvent: GpEventView = {
      ...event,
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      resultsStatus: "finished",
    };
    const cancelledEvent: GpEventView = {
      ...event,
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      status: "cancelled",
    };
    mockGps({ isPending: false, isError: false, isSuccess: true, data: [gp] });
    mockGpEvents({
      isPending: false,
      isError: false,
      isSuccess: true,
      data: [finishedEvent, cancelledEvent],
    });
    render(<ResultsSection seasons={[season]} />);
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Temporada"), seasonId);
    await user.selectOptions(screen.getByLabelText("GP"), gpId);

    expect(
      screen.getByRole("option", { name: "carrera principal — con resultados" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "carrera principal — evento cancelado" }),
    ).toBeInTheDocument();
  });

  it("envía solo los pilotos con datos o con fila pre-cargada (orden de pilotos)", async () => {
    const mutate = mockLoaded([r1Row()]);
    render(<ResultsSection seasons={[season]} />);
    const user = await selectEvent();

    // r2: fila nueva (salió + terminó + posición). r3: vacío y sin pre-carga → excluido.
    await markFinished(user, "Piloto Dos", "1");

    await user.click(screen.getByRole("button", { name: "Importar resultados" }));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith({
      gpId,
      eventId,
      entries: [
        {
          riderId: r1,
          position: 2,
          started: true,
          finished: true,
          penalties: [],
          bonuses: ["fastest-lap"],
          rawPoints: null,
        },
        {
          riderId: r2,
          position: 1,
          started: true,
          finished: true,
          penalties: [],
          bonuses: [],
          rawPoints: null,
        },
      ],
      reason: undefined,
    });
  });

  it("envía el motivo cuando se indica", async () => {
    const mutate = mockLoaded();
    render(<ResultsSection seasons={[season]} />);
    const user = await selectEvent();

    await markFinished(user, "Piloto Dos", "1");
    await user.type(
      screen.getByLabelText("Motivo (obligatorio si la importación corrige resultados existentes)"),
      "corrección de parrilla",
    );

    await user.click(screen.getByRole("button", { name: "Importar resultados" }));

    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "corrección de parrilla" }),
    );
  });

  it("corrige a ABSENT un piloto pre-cargado que se vacía", async () => {
    const mutate = mockLoaded([r1Row()]);
    render(<ResultsSection seasons={[season]} />);
    const user = await selectEvent();

    // La auto-limpieza no toca bonos/penalizaciones: el admin los desmarca a mano.
    await user.click(screen.getByLabelText("Bono fastest-lap: Piloto Uno"));
    await user.click(screen.getByLabelText("Salió: Piloto Uno"));
    expect(screen.getByLabelText("Terminó: Piloto Uno")).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Importar resultados" }));

    expect(mutate).toHaveBeenCalledWith({
      gpId,
      eventId,
      entries: [
        {
          riderId: r1,
          position: null,
          started: false,
          finished: false,
          penalties: [],
          bonuses: [],
          rawPoints: null,
        },
      ],
      reason: undefined,
    });
  });

  it("marca y desmarca penalizaciones por piloto", async () => {
    mockLoaded();
    render(<ResultsSection seasons={[season]} />);
    const user = await selectEvent();

    const dq = screen.getByLabelText("Penalización dq: Piloto Dos");
    await user.click(dq);
    expect(dq).toBeChecked();
    await user.click(dq);
    expect(dq).not.toBeChecked();
  });

  it("marca un bono en una fila nueva y lo envía en el payload", async () => {
    const mutate = mockLoaded();
    render(<ResultsSection seasons={[season]} />);
    const user = await selectEvent();

    await user.click(screen.getByLabelText("Bono fastest-lap: Piloto Dos"));
    expect(screen.getByLabelText("Bono fastest-lap: Piloto Dos")).toBeChecked();

    await user.click(screen.getByRole("button", { name: "Importar resultados" }));

    expect(mutate).toHaveBeenCalledWith({
      gpId,
      eventId,
      entries: [
        {
          riderId: r2,
          position: null,
          started: false,
          finished: false,
          penalties: [],
          bonuses: ["fastest-lap"],
          rawPoints: null,
        },
      ],
      reason: undefined,
    });
  });

  it("rechaza localmente un piloto que terminó sin posición", async () => {
    const mutate = mockLoaded();
    render(<ResultsSection seasons={[season]} />);
    const user = await selectEvent();

    await user.click(screen.getByLabelText("Salió: Piloto Dos"));
    await user.click(screen.getByLabelText("Terminó: Piloto Dos"));

    await user.click(screen.getByRole("button", { name: "Importar resultados" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Un piloto que terminó necesita posición",
    );
    expect(mutate).not.toHaveBeenCalled();
  });

  it("rechaza localmente una posición no entera (1e2)", async () => {
    const mutate = mockLoaded();
    render(<ResultsSection seasons={[season]} />);
    const user = await selectEvent();

    await user.click(screen.getByLabelText("Salió: Piloto Dos"));
    await user.click(screen.getByLabelText("Terminó: Piloto Dos"));
    // jsdom conserva "1e2" (float válido) en inputs number; el regex del
    // componente es lo que lo rechaza.
    fireEvent.change(screen.getByLabelText("Posición: Piloto Dos"), {
      target: { value: "1e2" },
    });

    await user.click(screen.getByRole("button", { name: "Importar resultados" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "La posición de Piloto Dos debe ser un número entero.",
    );
    expect(mutate).not.toHaveBeenCalled();
  });

  it("rechaza localmente puntos crudos no numéricos (1e2)", async () => {
    const mutate = mockLoaded();
    render(<ResultsSection seasons={[season]} />);
    const user = await selectEvent();

    // jsdom conserva "1e2" (float válido) en inputs number; el regex del
    // componente es lo que lo rechaza.
    fireEvent.change(screen.getByLabelText("Puntos crudos: Piloto Dos"), {
      target: { value: "1e2" },
    });

    await user.click(screen.getByRole("button", { name: "Importar resultados" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Los puntos crudos de Piloto Dos deben ser un número.",
    );
    expect(mutate).not.toHaveBeenCalled();
  });

  it("muestra el error del servidor cuando no hay issues de Zod", async () => {
    mockLoaded();
    mockImport({
      isError: true,
      isPending: false,
      error: new Error("El GP está cancelado: no se pueden importar resultados."),
    });
    render(<ResultsSection seasons={[season]} />);
    const user = await selectEvent();

    await markFinished(user, "Piloto Dos", "1");
    await user.click(screen.getByRole("button", { name: "Importar resultados" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "El GP está cancelado: no se pueden importar resultados.",
    );
  });

  it("muestra los issues de Zod del servidor", async () => {
    mockLoaded();
    const serverError = new Error("bad request");
    (serverError as { data?: unknown }).data = {
      zod: [
        { path: ["entries", 0, "riderId"], message: "El identificador de piloto no es válido" },
      ],
    };
    mockImport({ isError: true, isPending: false, error: serverError });
    render(<ResultsSection seasons={[season]} />);
    const user = await selectEvent();

    await markFinished(user, "Piloto Dos", "1");
    await user.click(screen.getByRole("button", { name: "Importar resultados" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "El identificador de piloto no es válido",
    );
  });

  it("muestra el resumen de la importación al completar", async () => {
    mockLoaded();
    render(<ResultsSection seasons={[season]} />);
    const user = await selectEvent();

    await markFinished(user, "Piloto Dos", "1");
    await user.click(screen.getByRole("button", { name: "Importar resultados" }));

    const options = asMockFn(trpc.results.importEvent.useMutation).mock.calls[0]?.[0] as {
      onSuccess: (data: ImportEventResult) => void;
    };
    act(() => {
      options.onSuccess({ created: 2, corrected: 1, unchanged: 3, kept: 5 });
    });

    expect(screen.getByRole("status")).toHaveTextContent(
      "Importación completada: 2 creados, 1 corregidos, 3 sin cambios y 5 conservados.",
    );
  });

  it("desactiva el botón mientras importa", async () => {
    mockLoaded();
    mockImport({ isPending: true });
    render(<ResultsSection seasons={[season]} />);
    const user = await selectEvent();

    await markFinished(user, "Piloto Dos", "1");

    expect(screen.getByRole("button", { name: "Importando…" })).toBeDisabled();
  });

  it("muestra el error al cargar los pilotos", async () => {
    mockGps({ isPending: false, isError: false, isSuccess: true, data: [gp] });
    mockGpEvents({ isPending: false, isError: false, isSuccess: true, data: [event] });
    mockRiders({ isPending: false, isError: true, error: new Error("sin conexión") });
    mockEventResults({ isPending: false, isError: false, isSuccess: true, data: [] });
    render(<ResultsSection seasons={[season]} />);
    await selectEvent();

    expect(screen.getByText("No se pudieron cargar los resultados: sin conexión")).toBeInTheDocument();
  });

  it("muestra el error al cargar los resultados previos", async () => {
    mockGps({ isPending: false, isError: false, isSuccess: true, data: [gp] });
    mockGpEvents({ isPending: false, isError: false, isSuccess: true, data: [event] });
    mockRiders({ isPending: false, isError: false, isSuccess: true, data: riders });
    mockEventResults({ isPending: false, isError: true, error: new Error("fallo de BD") });
    render(<ResultsSection seasons={[season]} />);
    await selectEvent();

    expect(screen.getByText("No se pudieron cargar los resultados: fallo de BD")).toBeInTheDocument();
  });

  it("muestra el estado vacío cuando no hay pilotos en el mercado", async () => {
    mockGps({ isPending: false, isError: false, isSuccess: true, data: [gp] });
    mockGpEvents({ isPending: false, isError: false, isSuccess: true, data: [event] });
    mockRiders({ isPending: false, isError: false, isSuccess: true, data: [] });
    mockEventResults({ isPending: false, isError: false, isSuccess: true, data: [] });
    render(<ResultsSection seasons={[season]} />);
    await selectEvent();

    expect(screen.getByText("Aún no hay pilotos en el mercado.")).toBeInTheDocument();
  });

  it("muestra 'Consultando…' mientras carga los GPs de la temporada", async () => {
    mockGps({ isPending: true });
    render(<ResultsSection seasons={[season]} />);
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Temporada"), seasonId);

    expect(screen.getByText("Consultando…")).toBeInTheDocument();
  });

  it("muestra el error al cargar los GPs de la temporada", async () => {
    mockGps({ isPending: false, isError: true, error: new Error("fallo de BD") });
    render(<ResultsSection seasons={[season]} />);
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Temporada"), seasonId);

    expect(screen.getByText("No se pudieron cargar los GPs: fallo de BD")).toBeInTheDocument();
  });

  it("muestra el estado vacío cuando la temporada no tiene GPs", async () => {
    mockGps({ isPending: false, isError: false, isSuccess: true, data: [] });
    render(<ResultsSection seasons={[season]} />);
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Temporada"), seasonId);

    expect(screen.getByText("Esta temporada aún no tiene GPs.")).toBeInTheDocument();
  });

  it("muestra 'Consultando…' mientras carga los eventos del GP", async () => {
    mockGps({ isPending: false, isError: false, isSuccess: true, data: [gp] });
    mockGpEvents({ isPending: true });
    render(<ResultsSection seasons={[season]} />);
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Temporada"), seasonId);
    await user.selectOptions(screen.getByLabelText("GP"), gpId);

    expect(screen.getByText("Consultando…")).toBeInTheDocument();
  });

  it("muestra el error al cargar los eventos del GP", async () => {
    mockGps({ isPending: false, isError: false, isSuccess: true, data: [gp] });
    mockGpEvents({ isPending: false, isError: true, error: new Error("fallo de eventos") });
    render(<ResultsSection seasons={[season]} />);
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Temporada"), seasonId);
    await user.selectOptions(screen.getByLabelText("GP"), gpId);

    expect(screen.getByText("No se pudieron cargar los eventos: fallo de eventos")).toBeInTheDocument();
  });

  it("muestra el estado vacío cuando el GP no tiene eventos", async () => {
    mockGps({ isPending: false, isError: false, isSuccess: true, data: [gp] });
    mockGpEvents({ isPending: false, isError: false, isSuccess: true, data: [] });
    render(<ResultsSection seasons={[season]} />);
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Temporada"), seasonId);
    await user.selectOptions(screen.getByLabelText("GP"), gpId);

    expect(screen.getByText("Este GP aún no tiene eventos.")).toBeInTheDocument();
  });

  it("muestra 'Consultando…' mientras carga pilotos y resultados previos", async () => {
    mockGps({ isPending: false, isError: false, isSuccess: true, data: [gp] });
    mockGpEvents({ isPending: false, isError: false, isSuccess: true, data: [event] });
    mockRiders({ isPending: true });
    mockEventResults({ isPending: true });
    render(<ResultsSection seasons={[season]} />);
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Temporada"), seasonId);
    await user.selectOptions(screen.getByLabelText("GP"), gpId);
    await user.selectOptions(screen.getByLabelText("Evento"), eventId);

    expect(screen.getByText("Consultando…")).toBeInTheDocument();
  });

  it("muestra '—' en la columna de bonos para eventos sin bonos (sprint)", async () => {
    const sprintEvent: GpEventView = {
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      type: "sprint",
      orderNum: 1,
      status: "scheduled",
      resultsStatus: null,
    };
    mockGps({ isPending: false, isError: false, isSuccess: true, data: [gp] });
    mockGpEvents({ isPending: false, isError: false, isSuccess: true, data: [sprintEvent] });
    mockRiders({ isPending: false, isError: false, isSuccess: true, data: riders });
    mockEventResults({ isPending: false, isError: false, isSuccess: true, data: [] });
    mockImport();
    render(<ResultsSection seasons={[season]} />);
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Temporada"), seasonId);
    await user.selectOptions(screen.getByLabelText("GP"), gpId);
    await user.selectOptions(screen.getByLabelText("Evento"), sprintEvent.id);

    // Un '—' por cada piloto: el sprint no tiene bonos importables (ADR-0018).
    expect(screen.getAllByText("—")).toHaveLength(3);
  });
});
