/**
 * Resuelve el vínculo GP ↔ evento de la fuente para el adapter (US-17,
 * ADR-0019): el adapter no toca la BD; la capa de servidor lo implementa
 * (DI).
 *
 * Vive en `app/server/` (no en el router) para que el worker de background
 * (T-10, ADR-0034) lo importe sin arrastrar el módulo de router (tRPC,
 * notificaciones…). El router `results` lo re-exporta (tests existentes).
 *
 * `eventRef = null` → el GP no está vinculado (el adapter lanza
 * `SourceNotLinkedError` aguas abajo).
 */
import type { PrismaClient } from "@prisma/client";

import {
  PulseLiveSourceError,
  type EventRefResolution,
  type EventRefResolver,
} from "@/modules/results";

export function createEventRefResolver(db: PrismaClient): EventRefResolver {
  return async (gpId: string): Promise<EventRefResolution | null> => {
    const gp = await db.gp.findUnique({
      where: { id: gpId },
      select: {
        name: true,
        sourceRef: true,
        season: { select: { year: true } },
      },
    });
    if (!gp) {
      throw new PulseLiveSourceError("El GP no existe.");
    }
    return {
      seasonYear: gp.season.year,
      eventRef: gp.sourceRef,
      gpName: gp.name,
    };
  };
}
