// @vitest-environment jsdom
/**
 * Tests de `app/admin/affiliations-panel.tsx` (US-06, ADR-0013): panel de
 * afiliaciones por GP («desde este GP» y «para este GP»), selección de
 * temporada/piloto/equipo/GP, informes de creación/salto, errores y lista
 * de afiliaciones actuales.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SeasonWithRules } from "../../modules/seasons";
import { PROVISIONAL_SEASON_RULES } from "../../shared/config/season-rules";
import { asMockFn, mockResult, resetTrpcMocks, trpc } from "../../../test/trpc-mock";
import { render, screen, userEvent } from "../../../test/rtl";

import AffiliationsPanel from "../affiliations-panel";

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
const secondSeason: SeasonWithRules = {
  ...season,
  id: "s2",
  name: "Temporada 2027",
  year: 2027,
};

const rider = { id: "r1", name: "Francesco Bagnaia", number: 27, isActive: true };
const team = {
  id: "t1",
  name: "Ducati Lenovo Team",
  constructorId: "c1",
  constructorName: "Ducati",
};

const gps = [
  {
    id: "g1",
    seasonId: "s1",
    round: 1,
    name: "GP de España",
    date: new Date("2026-04-19T14:00:00Z"),
  },
  {
    id: "g2",
    seasonId: "s1",
    round: 2,
    name: "GP de Portugal",
    date: new Date("2026-05-03T14:00:00Z"),
  },
];

const riderDetail = {
  rider,
  affiliations: [
    {
      id: "a1",
      riderId: "r1",
      teamId: "t1",
      constructorId: "c1",
      gpId: "g1",
      gp: {
        id: "g1",
        seasonId: "s1",
        round: 1,
        name: "GP de España",
        date: new Date("2026-04-19T14:00:00Z"),
      },
      team: { id: "t1", name: "Ducati Lenovo Team" },
      manufacturer: { id: "c1", name: "Ducati" },
    },
  ],
};

function mockGps() {
  mockResult(trpc.seasons.gps.list.useQuery, {
    data: gps,
    isPending: false,
    isError: false,
    isSuccess: true,
    refetch: vi.fn(),
  });
}

async function selectGp(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(screen.getByLabelText("Temporada"), "s1");
  await user.selectOptions(screen.getByLabelText("Piloto"), "r1");
  await user.selectOptions(screen.getByLabelText("Equipo"), "t1");
  await user.selectOptions(screen.getByLabelText("GP"), "g1");
}

describe("AffiliationsPanel", () => {
  beforeEach(() => resetTrpcMocks());

  it("muestra el panel con los botones desactivados y el GP bloqueado sin temporada", () => {
    render(<AffiliationsPanel riders={[rider]} teams={[team]} seasons={[season]} />);

    expect(screen.getByLabelText("GP")).toBeDisabled();
    expect(screen.getByText("Elige primero una temporada")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Asignar desde este GP" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Asignar para este GP" })).toBeDisabled();
    expect(screen.queryByText("Afiliaciones actuales")).not.toBeInTheDocument();
  });

  it("consulta los GPs de la temporada elegida y resetea el GP al cambiar de temporada", async () => {
    mockGps();
    render(
      <AffiliationsPanel riders={[rider]} teams={[team]} seasons={[season, secondSeason]} />,
    );

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Temporada"), "s1");
    const calls = asMockFn(trpc.seasons.gps.list.useQuery).mock.calls;
    expect(calls[calls.length - 1]?.[0]).toEqual({ seasonId: "s1" });
    await user.selectOptions(screen.getByLabelText("GP"), "g1");
    expect(screen.getByLabelText("GP")).toHaveValue("g1");

    await user.selectOptions(screen.getByLabelText("Temporada"), "s2");
    expect(screen.getByLabelText("GP")).toHaveValue("");
    expect(screen.getByText("— Elige un GP —")).toBeInTheDocument();
  });

  it("asigna desde el GP elegido (setFrom)", async () => {
    mockGps();
    const mutate = vi.fn();
    mockResult(trpc.market.affiliations.setFrom.useMutation, {
      mutate,
      isPending: false,
      isError: false,
    });
    render(<AffiliationsPanel riders={[rider]} teams={[team]} seasons={[season]} />);

    const user = userEvent.setup();
    await selectGp(user);
    await user.click(screen.getByRole("button", { name: "Asignar desde este GP" }));

    expect(mutate).toHaveBeenCalledWith({ riderId: "r1", teamId: "t1", fromGpId: "g1" });
  });

  it("asigna para un GP concreto (set, ajuste fino)", async () => {
    mockGps();
    const mutate = vi.fn();
    mockResult(trpc.market.affiliations.set.useMutation, {
      mutate,
      isPending: false,
      isError: false,
    });
    render(<AffiliationsPanel riders={[rider]} teams={[team]} seasons={[season]} />);

    const user = userEvent.setup();
    await selectGp(user);
    await user.click(screen.getByRole("button", { name: "Asignar para este GP" }));

    expect(mutate).toHaveBeenCalledWith({ riderId: "r1", teamId: "t1", gpId: "g1" });
  });

  it("muestra el informe de «desde este GP» con GPs saltados", () => {
    mockResult(trpc.market.affiliations.setFrom.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: false,
      isSuccess: true,
      data: {
        riderId: "r1",
        teamId: "t1",
        fromGpId: "g1",
        seasonId: "s1",
        created: 2,
        skipped: [
          {
            gpId: "g2",
            round: 2,
            reason: "La ronda 2 ya tiene afiliación (Ducati Lenovo Team)",
          },
          { gpId: "g3", round: 3, reason: "La ronda 3 ya tiene afiliación (KTM)" },
        ],
      },
    });
    render(<AffiliationsPanel riders={[rider]} teams={[team]} seasons={[season]} />);

    expect(
      screen.getByText("Aplicado desde el GP elegido: 2 afiliaciones creadas, 2 saltadas."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("La ronda 2 ya tiene afiliación (Ducati Lenovo Team)"),
    ).toBeInTheDocument();
  });

  it("muestra el informe singular sin GPs saltados", () => {
    mockResult(trpc.market.affiliations.setFrom.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: false,
      isSuccess: true,
      data: {
        riderId: "r1",
        teamId: "t1",
        fromGpId: "g1",
        seasonId: "s1",
        created: 1,
        skipped: [],
      },
    });
    render(<AffiliationsPanel riders={[rider]} teams={[team]} seasons={[season]} />);

    expect(
      screen.getByText("Aplicado desde el GP elegido: 1 afiliación creada."),
    ).toBeInTheDocument();
  });

  it("muestra el error al no poder asignar", () => {
    mockResult(trpc.market.affiliations.setFrom.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error: new Error("El GP de inicio no existe."),
    });
    render(<AffiliationsPanel riders={[rider]} teams={[team]} seasons={[season]} />);

    expect(
      screen.getByText("No se pudo asignar: El GP de inicio no existe."),
    ).toBeInTheDocument();
  });

  it("muestra el error al no poder asignar para un GP concreto (set)", () => {
    mockResult(trpc.market.affiliations.set.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error: new Error("El piloto no existe."),
    });
    render(<AffiliationsPanel riders={[rider]} teams={[team]} seasons={[season]} />);

    expect(
      screen.getByText("No se pudo asignar: El piloto no existe."),
    ).toBeInTheDocument();
  });

  it("confirma la asignación para un GP", () => {
    mockResult(trpc.market.affiliations.set.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: false,
      isSuccess: true,
      data: {
        affiliation: { id: "a1", riderId: "r1", teamId: "t1", constructorId: "c1", gpId: "g1" },
        changed: true,
      },
    });
    render(<AffiliationsPanel riders={[rider]} teams={[team]} seasons={[season]} />);

    expect(screen.getByText("Afiliación asignada para el GP.")).toBeInTheDocument();
  });

  it("indica que la afiliación ya existía (sin cambios)", () => {
    mockResult(trpc.market.affiliations.set.useMutation, {
      mutate: vi.fn(),
      isPending: false,
      isError: false,
      isSuccess: true,
      data: {
        affiliation: { id: "a1", riderId: "r1", teamId: "t1", constructorId: "c1", gpId: "g1" },
        changed: false,
      },
    });
    render(<AffiliationsPanel riders={[rider]} teams={[team]} seasons={[season]} />);

    expect(
      screen.getByText("El piloto ya tenía esa afiliación para el GP (sin cambios)."),
    ).toBeInTheDocument();
  });

  it("muestra las afiliaciones actuales del piloto", async () => {
    mockGps();
    mockResult(trpc.market.riders.get.useQuery, {
      data: riderDetail,
      isPending: false,
      isError: false,
      isSuccess: true,
      refetch: vi.fn(),
    });
    render(<AffiliationsPanel riders={[rider]} teams={[team]} seasons={[season]} />);

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Piloto"), "r1");

    expect(screen.getByText("Afiliaciones actuales")).toBeInTheDocument();
    expect(screen.getByText(/Ronda 1 — GP de España:/)).toBeInTheDocument();
    expect(screen.getByText("Ducati Lenovo Team")).toBeInTheDocument();
  });

  it("muestra «Consultando…» mientras carga las afiliaciones", async () => {
    mockGps();
    render(<AffiliationsPanel riders={[rider]} teams={[team]} seasons={[season]} />);

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Piloto"), "r1");

    expect(screen.getByText("Consultando…")).toBeInTheDocument();
  });

  it("muestra el estado vacío de afiliaciones", async () => {
    mockGps();
    mockResult(trpc.market.riders.get.useQuery, {
      data: { rider, affiliations: [] },
      isPending: false,
      isError: false,
      isSuccess: true,
      refetch: vi.fn(),
    });
    render(<AffiliationsPanel riders={[rider]} teams={[team]} seasons={[season]} />);

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Piloto"), "r1");

    expect(screen.getByText("Este piloto aún no tiene afiliaciones.")).toBeInTheDocument();
  });

  it("muestra el error al cargar las afiliaciones", async () => {
    mockGps();
    mockResult(trpc.market.riders.get.useQuery, {
      data: undefined,
      isPending: false,
      isError: true,
      isSuccess: false,
      error: new Error("sin conexión"),
      refetch: vi.fn(),
    });
    render(<AffiliationsPanel riders={[rider]} teams={[team]} seasons={[season]} />);

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Piloto"), "r1");

    expect(
      screen.getByText("No se pudieron cargar las afiliaciones: sin conexión"),
    ).toBeInTheDocument();
  });

  it("desactiva los botones mientras asigna", async () => {
    mockGps();
    mockResult(trpc.market.affiliations.setFrom.useMutation, {
      mutate: vi.fn(),
      isPending: true,
      isError: false,
    });
    render(<AffiliationsPanel riders={[rider]} teams={[team]} seasons={[season]} />);

    const user = userEvent.setup();
    await selectGp(user);

    // El botón de la mutación pendiente cambia de etiqueta; el otro queda
    // deshabilitado por `busy` aunque conserve la suya.
    expect(screen.getByRole("button", { name: "Asignando…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Asignar para este GP" })).toBeDisabled();
  });

  it("refresca las afiliaciones tras asignar (onSuccess → refetch)", async () => {
    mockGps();
    const refetch = vi.fn();
    mockResult(trpc.market.riders.get.useQuery, {
      data: riderDetail,
      isPending: false,
      isError: false,
      isSuccess: true,
      refetch,
    });
    render(<AffiliationsPanel riders={[rider]} teams={[team]} seasons={[season]} />);

    const user = userEvent.setup();
    await selectGp(user);
    await user.click(screen.getByRole("button", { name: "Asignar desde este GP" }));

    const options = asMockFn(trpc.market.affiliations.setFrom.useMutation).mock
      .calls[0]?.[0] as { onSuccess?: () => void };
    options.onSuccess?.();

    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
