import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { GenericContainer, Wait } from "testcontainers";
import { DB_URL_FILE, REDIS_URL_FILE } from "./helpers";

const POSTGRES_IMAGE = "postgres:16";
const DB_USER = "motogp";
const DB_PASSWORD = "motogp"; // solo tests: contenedor efímero, no es un secret
const DB_NAME = "motogp_test";
const REDIS_IMAGE = "redis:7";

/**
 * Global setup de integración (T-07):
 * 1. Arranca UN contenedor postgres:16 por run (Testcontainers).
 * 2. Aplica las migraciones en orden (`prisma migrate deploy`).
 * 3. Arranca un contenedor redis:7 (T-10: lock por GP de los jobs).
 * 4. Publica las URLs en archivos temporales para los workers de test.
 * Devuelve el teardown: para los contenedores y limpia los archivos.
 */
export default async function setup() {
  const container = await new GenericContainer(POSTGRES_IMAGE)
    .withEnvironment({
      POSTGRES_USER: DB_USER,
      POSTGRES_PASSWORD: DB_PASSWORD,
      POSTGRES_DB: DB_NAME,
    })
    .withExposedPorts(5432)
    .withWaitStrategy(
      Wait.forLogMessage("database system is ready to accept connections"),
    )
    .start();

  const url = `postgresql://${DB_USER}:${DB_PASSWORD}@${container.getHost()}:${container.getMappedPort(
    5432,
  )}/${DB_NAME}?schema=public`;

  const redis = await new GenericContainer(REDIS_IMAGE)
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forListeningPorts())
    .start();
  const redisUrl = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}/0`;

  try {
    execFileSync(
      path.join(process.cwd(), "node_modules", ".bin", "prisma"),
      [
        "migrate",
        "deploy",
        "--schema",
        path.join(process.cwd(), "prisma", "schema.prisma"),
      ],
      { env: { ...process.env, DATABASE_URL: url }, stdio: "inherit" },
    );
  } catch (err) {
    await container.stop();
    await redis.stop();
    throw err;
  }

  writeFileSync(DB_URL_FILE, url, "utf8");
  writeFileSync(REDIS_URL_FILE, redisUrl, "utf8");

  return async () => {
    await container.stop();
    await redis.stop();
    rmSync(DB_URL_FILE, { force: true });
    rmSync(REDIS_URL_FILE, { force: true });
  };
}
