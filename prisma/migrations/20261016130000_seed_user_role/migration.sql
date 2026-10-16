-- Seed: el rol `user` existe desde el deploy.
-- register() (auth-service.ts) lo asume vía upsert; con la tabla vacía, dos
-- registros concurrentes competían por el primer INSERT (el upsert es
-- UPDATE + INSERT y no es atómico bajo concurrencia) → 500 para uno de los dos.
-- ON CONFLICT DO NOTHING: idempotente para BDs que ya tengan la fila.
-- `id` sin default en BD (el client de Prisma genera el UUID): se genera aquí.
INSERT INTO "roles" ("id", "name", "description")
VALUES (gen_random_uuid(), 'user', 'Usuario registrado')
ON CONFLICT ("name") DO NOTHING;
