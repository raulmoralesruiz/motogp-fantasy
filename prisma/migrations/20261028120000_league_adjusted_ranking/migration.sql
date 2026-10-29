-- US-30 (leagues.md §7): ranking general ajustado desde la última entrada.
-- Desactivado por defecto en todas las ligas (D-10).
ALTER TABLE "leagues"
ADD COLUMN "adjusted_ranking_enabled" BOOLEAN NOT NULL DEFAULT false;
