-- US-42 (ADR-0042): colores reales de equipo desde la fuente (PulseLive).
-- Solo en `teams`; el color de rider/constructor es DERIVADO (afiliación del
-- GP / heurística sobre equipos) y no se persiste. NULL-ables: los datos
-- anteriores (y las fuentes sin color) caen al fallback estético del picker.
ALTER TABLE "teams" ADD COLUMN "color" TEXT;
ALTER TABLE "teams" ADD COLUMN "text_color" TEXT;
