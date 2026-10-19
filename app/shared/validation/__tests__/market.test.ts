/**
 * Tests de los schemas de entrada del módulo `market` (US-06).
 *
 * - Payloads válidos parsean.
 * - Payloads inválidos se rechazan con el motivo en español.
 * - El constructor NUNCA es parte de la entrada de afiliación: el servidor
 *   lo deriva del equipo (invariante 5).
 */
import { describe, expect, it } from "vitest";

import {
  assetTypeEnum,
  createConstructorInputSchema,
  createRiderInputSchema,
  createTeamInputSchema,
  listAssetPricesInputSchema,
  priceHistoryInputSchema,
  riderIdInputSchema,
  setOpeningPriceInputSchema,
  setRiderAffiliationFromInputSchema,
  setRiderAffiliationInputSchema,
} from "../market.js";

const RIDER_ID = "123e4567-e89b-42d3-a456-426614174000";
const TEAM_ID = "223e4567-e89b-42d3-a456-426614174001";
const GP_ID = "323e4567-e89b-42d3-a456-426614174002";

describe("createRiderInputSchema (US-06)", () => {
  it("acepta un piloto válido con dorsal", () => {
    const result = createRiderInputSchema.safeParse({
      name: "Francesco Bagnaia",
      number: 27,
    });
    expect(result.success).toBe(true);
  });

  it("acepta un piloto sin dorsal (opcional) o con null", () => {
    expect(createRiderInputSchema.safeParse({ name: "Sin dorsal" }).success).toBe(true);
    expect(createRiderInputSchema.safeParse({ name: "Sin dorsal", number: null }).success).toBe(
      true,
    );
  });

  it("rechaza un nombre vacío", () => {
    const result = createRiderInputSchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("El nombre del piloto es obligatorio");
    }
  });

  it("rechaza un dorsal no entero o fuera de rango", () => {
    const base = { name: "T" };
    expect(createRiderInputSchema.safeParse({ ...base, number: 2.5 }).success).toBe(false);
    expect(createRiderInputSchema.safeParse({ ...base, number: 0 }).success).toBe(false);
    expect(createRiderInputSchema.safeParse({ ...base, number: 1000 }).success).toBe(false);
  });
});

describe("createConstructorInputSchema (US-06)", () => {
  it("acepta un constructor válido", () => {
    expect(createConstructorInputSchema.safeParse({ name: "Ducati" }).success).toBe(true);
  });

  it("rechaza un nombre vacío", () => {
    const result = createConstructorInputSchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("El nombre del constructor es obligatorio");
    }
  });

  it("rechaza un nombre de más de 160 caracteres", () => {
    expect(createConstructorInputSchema.safeParse({ name: "a".repeat(161) }).success).toBe(false);
  });
});

describe("createTeamInputSchema (US-06)", () => {
  it("acepta un equipo con constructor válido", () => {
    expect(
      createTeamInputSchema.safeParse({ name: "Team Rossi", constructorId: RIDER_ID }).success,
    ).toBe(true);
  });

  it("rechaza un nombre vacío", () => {
    const result = createTeamInputSchema.safeParse({
      name: "",
      constructorId: RIDER_ID,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("El nombre del equipo es obligatorio");
    }
  });

  it("rechaza un constructorId que no es UUID", () => {
    const result = createTeamInputSchema.safeParse({ name: "T", constructorId: "no-uuid" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("El identificador de constructor no es válido");
    }
  });
});

describe("riderIdInputSchema (US-06)", () => {
  it("acepta un riderId válido", () => {
    expect(riderIdInputSchema.safeParse({ riderId: RIDER_ID }).success).toBe(true);
  });

  it("rechaza un riderId que no es UUID", () => {
    const result = riderIdInputSchema.safeParse({ riderId: "no-uuid" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("El identificador de piloto no es válido");
    }
  });
});

describe("setRiderAffiliationInputSchema (US-06)", () => {
  it("acepta una afiliación por GP válida", () => {
    expect(
      setRiderAffiliationInputSchema.safeParse({
        riderId: RIDER_ID,
        teamId: TEAM_ID,
        gpId: GP_ID,
      }).success,
    ).toBe(true);
  });

  it("rechaza un campo que no es UUID", () => {
    const base = { riderId: RIDER_ID, teamId: TEAM_ID, gpId: GP_ID };
    expect(setRiderAffiliationInputSchema.safeParse({ ...base, riderId: "x" }).success).toBe(false);
    expect(setRiderAffiliationInputSchema.safeParse({ ...base, teamId: "x" }).success).toBe(false);
    expect(setRiderAffiliationInputSchema.safeParse({ ...base, gpId: "x" }).success).toBe(false);
  });

  it("no acepta un constructor en la entrada (lo deriva el servidor)", () => {
    // El schema no debe tener campo `constructorId`: si aparece, se ignora
    // (passthrough no está activado) y nunca viaja al servicio.
    const parsed = setRiderAffiliationInputSchema.parse({
      riderId: RIDER_ID,
      teamId: TEAM_ID,
      gpId: GP_ID,
      constructorId: RIDER_ID,
    });
    expect("constructorId" in parsed).toBe(false);
  });
});

describe("setRiderAffiliationFromInputSchema (US-06, ADR-0013)", () => {
  it("acepta una afiliación desde GP válida", () => {
    expect(
      setRiderAffiliationFromInputSchema.safeParse({
        riderId: RIDER_ID,
        teamId: TEAM_ID,
        fromGpId: GP_ID,
      }).success,
    ).toBe(true);
  });

  it("rechaza un fromGpId que no es UUID", () => {
    const result = setRiderAffiliationFromInputSchema.safeParse({
      riderId: RIDER_ID,
      teamId: TEAM_ID,
      fromGpId: "x",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        "El identificador de GP de inicio no es válido",
      );
    }
  });
});

describe("assetTypeEnum (US-07)", () => {
  it("acepta rider, constructor y team", () => {
    for (const tipo of ["rider", "constructor", "team"]) {
      expect(assetTypeEnum.safeParse(tipo).success).toBe(true);
    }
  });

  it("rechaza un tipo inválido con motivo en español", () => {
    const result = assetTypeEnum.safeParse("motorcycle");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        "El tipo de activo no es válido (piloto, constructor o equipo)",
      );
    }
  });
});

describe("setOpeningPriceInputSchema (US-07)", () => {
  const base = { assetType: "rider" as const, assetId: RIDER_ID };

  it("acepta un precio entero, con decimales y el tope de sanidad", () => {
    expect(setOpeningPriceInputSchema.safeParse({ ...base, price: 20 }).success).toBe(true);
    expect(
      setOpeningPriceInputSchema.safeParse({ ...base, assetType: "team", assetId: TEAM_ID, price: 12.5 }).success,
    ).toBe(true);
    expect(
      setOpeningPriceInputSchema.safeParse({ ...base, assetType: "constructor", assetId: GP_ID, price: 9999.99 }).success,
    ).toBe(true);
  });

  it("rechaza un precio no positivo", () => {
    const cero = setOpeningPriceInputSchema.safeParse({ ...base, price: 0 });
    expect(cero.success).toBe(false);
    if (!cero.success) {
      expect(cero.error.issues[0]?.message).toBe("El precio de apertura debe ser positivo");
    }
    expect(setOpeningPriceInputSchema.safeParse({ ...base, price: -5 }).success).toBe(false);
  });

  it("rechaza un precio por encima del tope de sanidad", () => {
    const result = setOpeningPriceInputSchema.safeParse({ ...base, price: 10000 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("El precio de apertura no puede superar 9999.99");
    }
  });

  it("rechaza más de 2 decimales", () => {
    const result = setOpeningPriceInputSchema.safeParse({ ...base, price: 10.999 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some(
          (i) => i.message === "El precio de apertura no puede tener más de 2 decimales",
        ),
      ).toBe(true);
    }
  });

  it("rechaza un assetId que no es UUID", () => {
    const result = setOpeningPriceInputSchema.safeParse({ ...base, assetId: "no-uuid", price: 20 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("El identificador del activo no es válido");
    }
  });

  it("rechaza un assetType inválido", () => {
    const result = setOpeningPriceInputSchema.safeParse({ assetType: "x", assetId: RIDER_ID, price: 20 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some(
          (i) => i.message === "El tipo de activo no es válido (piloto, constructor o equipo)",
        ),
      ).toBe(true);
    }
  });
});

describe("priceHistoryInputSchema (US-07)", () => {
  it("acepta un histórico válido", () => {
    expect(
      priceHistoryInputSchema.safeParse({ assetType: "rider", assetId: RIDER_ID }).success,
    ).toBe(true);
  });

  it("rechaza un assetId que no es UUID", () => {
    const result = priceHistoryInputSchema.safeParse({ assetType: "team", assetId: "x" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("El identificador del activo no es válido");
    }
  });

  it("rechaza un assetType inválido", () => {
    const result = priceHistoryInputSchema.safeParse({ assetType: "x", assetId: RIDER_ID });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some(
          (i) => i.message === "El tipo de activo no es válido (piloto, constructor o equipo)",
        ),
      ).toBe(true);
    }
  });
});

describe("listAssetPricesInputSchema (US-07)", () => {
  it("acepta un tipo de activo válido", () => {
    for (const tipo of ["rider", "constructor", "team"]) {
      expect(listAssetPricesInputSchema.safeParse({ assetType: tipo }).success).toBe(true);
    }
  });

  it("rechaza un assetType inválido", () => {
    const result = listAssetPricesInputSchema.safeParse({ assetType: "x" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some(
          (i) => i.message === "El tipo de activo no es válido (piloto, constructor o equipo)",
        ),
      ).toBe(true);
    }
  });
});
