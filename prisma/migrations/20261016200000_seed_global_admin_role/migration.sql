-- Seed: el rol `global_admin` existe desde el deploy (junto con `user`).
-- register() (auth-service.ts) lo asume vía upsert al otorgar el bootstrap
-- (T-08, ADR-0010). Sin la fila, dos registros bootstrap concurrentes
-- (p. ej. los tests de integración que corren en paralelo) competirían por
-- el primer INSERT del upsert — la misma race que motivó
-- `20261016130000_seed_user_role`. Con la fila sembrada, el upsert es un
-- no-op atómico y la tabla de roles queda completa y determinista.
-- Semántica inalterada: sembrar la fila NO concede el rol a nadie; el
-- otorgamiento sigue ocurriendo solo en el registro con el email bootstrap.
-- `id` sin default en BD (el client de Prisma genera el UUID): se genera aquí.
INSERT INTO "roles" ("id", "name", "description")
VALUES (gen_random_uuid(), 'global_admin', 'Administrador global (panel de admin)')
ON CONFLICT ("name") DO NOTHING;
