/**
 * Schemas de entrada del módulo `market` (US-06/US-07): pilotos,
 * constructores, equipos, afiliaciones por GP y precios de apertura (P0).
 *
 * El cliente usa estos schemas para la UX; el servidor siempre revalida
 * (AGENTS.md §8). El constructor de una afiliación NUNCA lo envía el
 * cliente: el servidor lo deriva del equipo (invariante 5: constructor ≠
 * equipo, activos distintos).
 */

import { z } from "zod";

/** Creación de piloto (US-06): nombre (unique en BD) + dorsal opcional. */
export const createRiderInputSchema = z.object({
  name: z
    .string()
    .min(1, "El nombre del piloto es obligatorio")
    .max(160, "El nombre del piloto no puede superar los 160 caracteres"),
  number: z
    .number()
    .int("El dorsal debe ser un entero")
    .min(1, "El dorsal debe ser 1 o mayor")
    .max(999, "El dorsal no puede superar 999")
    .nullish(),
});

/** Creación de constructor (US-06): nombre (unique en BD). */
export const createConstructorInputSchema = z.object({
  name: z
    .string()
    .min(1, "El nombre del constructor es obligatorio")
    .max(160, "El nombre del constructor no puede superar los 160 caracteres"),
});

/**
 * Creación de equipo (US-06): nombre (unique en BD) + constructor (debe
 * existir). Un equipo pertenece a exactamente un constructor (CA US-06).
 */
export const createTeamInputSchema = z.object({
  name: z
    .string()
    .min(1, "El nombre del equipo es obligatorio")
    .max(160, "El nombre del equipo no puede superar los 160 caracteres"),
  constructorId: z
    .string()
    .uuid("El identificador de constructor no es válido"),
});

/** Búsqueda de un piloto (US-06). */
export const riderIdInputSchema = z.object({
  riderId: z.string().uuid("El identificador de piloto no es válido"),
});

/**
 * Afiliación por GP (US-06, ajuste fino): asigna el equipo al piloto para
 * ese GP; si ya hay afiliación se reemplaza. El constructor se deriva del
 * equipo en el servidor.
 */
export const setRiderAffiliationInputSchema = z.object({
  riderId: z.string().uuid("El identificador de piloto no es válido"),
  teamId: z.string().uuid("El identificador de equipo no es válido"),
  gpId: z.string().uuid("El identificador de GP no es válido"),
});

/**
 * Afiliación "desde el GP X en adelante" (US-06, ADR-0013): aplica al GP
 * de inicio y a todos los GPs siguientes de la misma temporada que no
 * tengan afiliación; los GPs anteriores nunca se tocan.
 */
export const setRiderAffiliationFromInputSchema = z.object({
  riderId: z.string().uuid("El identificador de piloto no es válido"),
  teamId: z.string().uuid("El identificador de equipo no es válido"),
  fromGpId: z.string().uuid("El identificador de GP de inicio no es válido"),
});

/** Tipo de activo de mercado (US-07): piloto, constructor o equipo. */
export const assetTypeEnum = z.enum(["rider", "constructor", "team"], {
  message: "El tipo de activo no es válido (piloto, constructor o equipo)",
});

/**
 * Fijar precio de apertura (P0) (US-07, ADR-0014): upsert auditado — si
 * no existe se crea, si existe con el mismo valor no hace nada y si existe
 * con otro valor se actualiza. `price` admite hasta 2 decimales (tipo de
 * BD Decimal(10, 2)); el tope 9999.99 es un límite de sanidad de entrada,
 * no un parámetro de reglas (esos viven en `season_rules`).
 */
export const setOpeningPriceInputSchema = z.object({
  assetType: assetTypeEnum,
  assetId: z.string().uuid("El identificador del activo no es válido"),
  price: z
    .number()
    .positive("El precio de apertura debe ser positivo")
    .max(9999.99, "El precio de apertura no puede superar 9999.99")
    .refine((p) => Number(p.toFixed(2)) === p, {
      message: "El precio de apertura no puede tener más de 2 decimales",
    }),
});

/** Histórico de precios de un activo (US-07): P0 + una fila por GP. */
export const priceHistoryInputSchema = z.object({
  assetType: assetTypeEnum,
  assetId: z.string().uuid("El identificador del activo no es válido"),
});

/**
 * Exploración del mercado (US-14): lista filtrable por tipo de activo,
 * constructor/equipo (solo riders, vía su afiliación en el GP) y rango de
 * precio sobre el precio actual del GP elegido (con fallback a P0).
 * `priceMin`/`priceMax` siguen el mismo patrón de sanidad que los ajustes
 * de precio (positivo, ≤9999.99, ≤2 decimales).
 */
export const marketListInputSchema = z.object({
  gpId: z.string().uuid("El identificador de GP no es válido"),
  assetType: assetTypeEnum,
  constructorId: z.string().uuid("El identificador de constructor no es válido").optional(),
  teamId: z.string().uuid("El identificador de equipo no es válido").optional(),
  priceMin: z
    .number()
    .positive("El precio mínimo debe ser positivo")
    .max(9999.99, "El precio mínimo no puede superar 9999.99")
    .refine((p) => Number(p.toFixed(2)) === p, {
      message: "El precio mínimo no puede tener más de 2 decimales",
    })
    .optional(),
  priceMax: z
    .number()
    .positive("El precio máximo debe ser positivo")
    .max(9999.99, "El precio máximo no puede superar 9999.99")
    .refine((p) => Number(p.toFixed(2)) === p, {
      message: "El precio máximo no puede tener más de 2 decimales",
    })
    .optional(),
});

/** Detalle de un activo en el mercado (US-14): histórico completo + concentración. */
export const marketDetailInputSchema = z.object({
  gpId: z.string().uuid("El identificador de GP no es válido"),
  assetType: assetTypeEnum,
  assetId: z.string().uuid("El identificador del activo no es válido"),
});

/** Activos de un tipo con su P0 (US-07): lista para el panel admin. */
export const listAssetPricesInputSchema = z.object({
  assetType: assetTypeEnum,
});

/**
 * Ajuste manual de precio por GP (US-08): el admin fija o cambia el precio
 * de un activo para un GP concreto. `reason = manual`, `createdBy = actor`,
 * auditado. El GP no puede estar en lockout (gate US-08: los precios no
 * cambian durante el lockout).
 */
export const setManualPriceInputSchema = z.object({
  assetType: assetTypeEnum,
  assetId: z.string().uuid("El identificador del activo no es válido"),
  gpId: z.string().uuid("El identificador de GP no es válido"),
  price: z
    .number()
    .positive("El precio debe ser positivo")
    .max(9999.99, "El precio no puede superar 9999.99")
    .refine((p) => Number(p.toFixed(2)) === p, {
      message: "El precio no puede tener más de 2 decimales",
    }),
});

/**
 * Aplicar la fórmula de precios (pricing-v1) para un GP (US-08): el admin
 * (o el job) dispara el cálculo del precio del siguiente GP para todos los
 * activos con P0. `gpId` es el GP que acaba de quedarse definitivo.
 */
export const applyFormulaInputSchema = z.object({
  gpId: z.string().uuid("El identificador de GP no es válido"),
});

export type CreateRiderInput = z.infer<typeof createRiderInputSchema>;
export type CreateConstructorInput = z.infer<typeof createConstructorInputSchema>;
export type CreateTeamInput = z.infer<typeof createTeamInputSchema>;
export type RiderIdInput = z.infer<typeof riderIdInputSchema>;
export type SetRiderAffiliationInput = z.infer<typeof setRiderAffiliationInputSchema>;
export type SetRiderAffiliationFromInput = z.infer<typeof setRiderAffiliationFromInputSchema>;
export type AssetType = z.infer<typeof assetTypeEnum>;
export type SetOpeningPriceInput = z.infer<typeof setOpeningPriceInputSchema>;
export type PriceHistoryInput = z.infer<typeof priceHistoryInputSchema>;
export type ListAssetPricesInput = z.infer<typeof listAssetPricesInputSchema>;
export type SetManualPriceInput = z.infer<typeof setManualPriceInputSchema>;
export type ApplyFormulaInput = z.infer<typeof applyFormulaInputSchema>;
export type MarketListInput = z.infer<typeof marketListInputSchema>;
export type MarketDetailInput = z.infer<typeof marketDetailInputSchema>;

// ── Import de mercado (US-06, ADR-0013) ──────────────────────────────────

/**
 * Constructor normalizado (preview del import de mercado).
 */
const normalizedConstructorSchema = z.object({
  sourceId: z.string().min(1).nullable(),
  name: z
    .string()
    .min(1, "El nombre del constructor es obligatorio")
    .max(160, "El nombre del constructor no puede superar los 160 caracteres"),
});

/**
 * Equipo normalizado (preview del import de mercado).
 */
const normalizedTeamSchema = z.object({
  sourceId: z.string().min(1).nullable(),
  name: z
    .string()
    .min(1, "El nombre del equipo es obligatorio")
    .max(160, "El nombre del equipo no puede superar los 160 caracteres"),
  manufacturer: normalizedConstructorSchema,
});

/**
 * Piloto normalizado (preview del import de mercado).
 */
const normalizedRiderSchema = z.object({
  sourceId: z.string().min(1).nullable(),
  name: z
    .string()
    .min(1, "El nombre del piloto es obligatorio")
    .max(80, "El nombre del piloto no puede superar los 80 caracteres"),
  surname: z
    .string()
    .min(1, "El apellido del piloto es obligatorio")
    .max(80, "El apellido del piloto no puede superar los 80 caracteres"),
  number: z.number().int().min(1).max(999).nullable(),
  countryIso: z.string().max(2).nullable(),
});

/**
 * Afiliación normalizada (preview del import de mercado).
 */
const normalizedAffiliationSchema = z.object({
  riderSourceId: z.string().min(1),
  teamSourceId: z.string().min(1),
  seasonYear: z
    .number()
    .int()
    .min(1900)
    .max(2200),
});

/**
 * Mercado normalizado de temporada: lo devuelve `market.fetch` y lo
 * recibe `market.import` (revalidado server-side — AGENTS.md §8).
 */
export const normalizedMarketSchema = z.object({
  year: z
    .number()
    .int("El año debe ser un entero")
    .min(1900, "El año debe ser 1900 o posterior")
    .max(2200, "El año no puede superar 2200"),
  seasonRef: z.string().min(1, "La referencia de temporada de la fuente es obligatoria"),
  source: z.object({
    name: z.string().min(1, "El nombre de la fuente es obligatorio"),
    version: z.string().min(1, "La versión de la fuente es obligatoria"),
  }),
  constructors: z.array(normalizedConstructorSchema).min(1, "El mercado no tiene constructores"),
  teams: z.array(normalizedTeamSchema).min(1, "El mercado no tiene equipos"),
  riders: z.array(normalizedRiderSchema).min(1, "El mercado no tiene pilotos"),
  affiliations: z.array(normalizedAffiliationSchema).min(1, "El mercado no tiene afiliaciones"),
});

/** Obtención de mercado (US-06): año de la temporada en la fuente. */
export const fetchMarketInputSchema = z.object({
  year: z
    .number()
    .int("El año debe ser un entero")
    .min(1900, "El año debe ser 1900 o posterior")
    .max(2200, "El año no puede superar 2200"),
});

/**
 * Importación de mercado (US-06): el preview normalizado reenviado por
 * el cliente; el servidor lo revalida y exige `market.year === season.year`.
 */
export const importMarketInputSchema = z.object({
  seasonId: z.string().uuid("El identificador de temporada no es válido"),
  market: normalizedMarketSchema,
});

/**
 * P0 heurística desde la clasificación del campeonato (ADR-0014): el admin
 * dispara el cálculo de los precios de apertura (P0) de todos los activos a
 * partir de la clasificación de la temporada (posición → precio lineal 30→10,
 * equipos/constructores = media de sus riders). `seasonId` identifica la
 * temporada (de la que se toma el año para la clasificación).
 */
export const p0HeuristicInputSchema = z.object({
  seasonId: z.string().uuid("El identificador de temporada no es válido"),
});

export type NormalizedConstructorInput = z.infer<typeof normalizedConstructorSchema>;
export type NormalizedTeamInput = z.infer<typeof normalizedTeamSchema>;
export type NormalizedRiderInput = z.infer<typeof normalizedRiderSchema>;
export type NormalizedAffiliationInput = z.infer<typeof normalizedAffiliationSchema>;
export type NormalizedMarketInput = z.infer<typeof normalizedMarketSchema>;
export type FetchMarketInput = z.infer<typeof fetchMarketInputSchema>;
export type ImportMarketInput = z.infer<typeof importMarketInputSchema>;
export type P0HeuristicInput = z.infer<typeof p0HeuristicInputSchema>;
