-- 0002 · SQL raw (T-06) — invariantes y objetos derivados que Prisma no
-- expresa (docs/architecture/data-model.md §4 y §5).

-- 1. Composición del lineup: exactamente 2 oro + 2 plata + 1 constructor +
--    1 equipo por lineup (invariante 1). Un CHECK de tabla no puede contar
--    otras filas de la misma tabla, así que se implementa con un trigger
--    AFTER STATEMENT: valida el lineup afectado al terminar cada
--    INSERT/UPDATE/DELETE sobre lineup_slots.
--    Semántica: un lineup sin slots (borrador vacío) es válido; en cuanto
--    tiene slots, debe tener exactamente 2+2+1+1. La app inserta los 6 slots
--    en una sola sentencia (Prisma createMany) para que el check pase.
CREATE OR REPLACE FUNCTION check_lineup_composition() RETURNS trigger AS $$
DECLARE
  rec record;
BEGIN
  -- El trigger es AFTER STATEMENT: no hay NEW/OLD; se valida cada lineup
  -- que tenga slots tras la sentencia (tabla vacía → no hay nada que validar).
  FOR rec IN
    SELECT ls.lineup_id,
           COUNT(*) FILTER (WHERE ls.slot_type = 'gold') AS gold,
           COUNT(*) FILTER (WHERE ls.slot_type = 'silver') AS silver,
           COUNT(*) FILTER (WHERE ls.slot_type = 'constructor') AS constructor,
           COUNT(*) FILTER (WHERE ls.slot_type = 'team') AS team
    FROM lineup_slots ls
    GROUP BY ls.lineup_id
  LOOP
    IF rec.gold <> 2 OR rec.silver <> 2 OR rec.constructor <> 1 OR rec.team <> 1 THEN
      RAISE EXCEPTION 'Composición de lineup inválida: se esperan exactamente 2 oro + 2 plata + 1 constructor + 1 equipo (lineup %)', rec.lineup_id
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS lineup_slots_composition ON lineup_slots;
CREATE TRIGGER lineup_slots_composition
AFTER INSERT OR UPDATE OR DELETE ON lineup_slots
FOR EACH STATEMENT
EXECUTE FUNCTION check_lineup_composition();

-- 2. price_history: vista derivada de precios por GP (data-model.md §5:
--    lo derivado no se duplica; se consulta sobre la fuente de verdad).
DROP VIEW IF EXISTS price_history;
CREATE VIEW price_history AS
SELECT
  p.id,
  p.asset_type,
  p.asset_id,
  p.gp_id,
  g.round AS gp_round,
  g.name AS gp_name,
  p.price,
  p.reason,
  p.rules_version,
  p.created_by,
  p.created_at
FROM prices p
LEFT JOIN gps g ON g.id = p.gp_id
ORDER BY p.asset_type, p.asset_id, g.round;

-- 3. Precio de apertura (P0): a lo sumo una fila por activo con gp_id NULL.
--    El unique de Prisma (asset_type, asset_id, gp_id) no cubre NULLs
--    (PostgreSQL los trata como distintos); este índice parcial sí.
CREATE UNIQUE INDEX IF NOT EXISTS prices_asset_opening_unique
  ON prices (asset_type, asset_id)
  WHERE gp_id IS NULL;
