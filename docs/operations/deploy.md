# Runbook de despliegue — TrueNAS Scale (T-02 / T-19)

Cómo desplegar y mantener **Fantasy MotoGP Independiente** en el TrueNAS
(`192.168.1.3`) con Docker, Portainer y Nginx Proxy Manager (NPM).

> **Modelo pull:** el TrueNAS no tiene IP pública, así que GitHub Actions solo
> valida el código (CI). El deploy siempre lo inicias tú con `./deploy.sh`.

## 0. Arquitectura (resumen)

| Contenedor        | Imagen                                           | Puerto                           | Datos                            |
| ----------------- | ------------------------------------------------ | -------------------------------- | -------------------------------- |
| `motogp-web`      | `motogp-web:<commit>` (la construye `deploy.sh`) | host `22020` → contenedor `3000` | —                                |
| `motogp-postgres` | `postgres:16`                                    | solo red interna                 | `/mnt/data-nas/motogp/pgdata`    |
| `motogp-redis`    | `redis:7`                                        | solo red interna                 | `/mnt/data-nas/motogp/redisdata` |

- Código: `/mnt/data-nas/www/motogp` (clon del repo).
- Acceso: local `http://motogp:81` · remoto `https://motogp.raulmorales.eu`
  (ambos proxy de NPM → `192.168.1.3:22020`).
- Solo la web expone puerto a la LAN; Postgres y Redis quedan en red interna.

## 1. Preparación (una sola vez)

### 1.1 Clave SSH de solo lectura en GitHub

1. En el TrueNAS, genera una clave dedicada:

   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/motogp_deploy -N ""
   ```

2. En GitHub: repo `motogp-fantasy` → **Settings → Deploy keys → Add deploy key**.
   Pega el contenido de `~/.ssh/motogp_deploy.pub`. **No** marques "Write access".

3. Para que `git pull` funcione sin contraseña, añade en `~/.ssh/config`
   (y `chmod 600 ~/.ssh/config`):

   ```
   Host github-motogp
     HostName github.com
     User git
     IdentityFile ~/.ssh/motogp_deploy
     IdentitiesOnly yes
   ```

4. Comprueba:

   ```bash
   git ls-remote git@github-motogp:raulmoralesruiz/motogp-fantasy.git
   ```

   Debe listar commits sin pedir contraseña.

### 1.2 Directorios en el pool

```bash
sudo mkdir -p /mnt/data-nas/www /mnt/data-nas/motogp/pgdata /mnt/data-nas/motogp/redisdata
# 999 = usuario interno de las imágenes oficiales de Postgres y Redis:
sudo chown -R 999:999 /mnt/data-nas/motogp/pgdata /mnt/data-nas/motogp/redisdata
```

### 1.3 Clonar el repo

```bash
cd /mnt/data-nas/www
git clone git@github-motogp:raulmoralesruiz/motogp-fantasy.git motogp
cd motogp
```

### 1.4 Variables de entorno (`.env`)

```bash
cp .env.prod.example .env
```

Edita `.env` y sustituye los dos `<openssl-rand-hex-32>` por valores reales
(ejecuta `openssl rand -hex 32` dos veces; uno para `POSTGRES_PASSWORD` y otro
para `SESSION_SECRET`, y copia el mismo valor de `POSTGRES_PASSWORD` dentro de
`DATABASE_URL`). Después:

```bash
chmod 600 .env
```

> El `.env` vive en el servidor, fuera del repo. CI lo protege con gitleaks
> por si alguien lo commitea por error (T-19).

## 2. Primer despliegue

```bash
./deploy.sh
```

Qué hace, en orden:

1. `git pull` (código al día).
2. Construye la imagen `motogp-web:<commit>` (y `motogp-web:latest`).
3. Arranca Postgres y Redis y espera a que estén sanos.
4. Ejecuta `prisma migrate deploy` (crea/actualiza el esquema de la BD).
5. Arranca la web y espera a que pase el health-check.
6. Verifica `http://localhost:22020/api/health` y termina con "OK".

Comprueba desde tu equipo: `http://192.168.1.3:22020/api/health` → `{"ok":true}`.

### Portainer (opcional, solo para consultar)

El deploy no lo hace Portainer (Portainer no puede construir la imagen: no
tiene el contexto del repo). Portainer sirve para **ver y gestionar** lo que
`deploy.sh` arranca: contenedores, logs, reinicios, consola
(Portainer → Containers → `motogp-web` / `motogp-postgres` / `motogp-redis`).

> **No importes `docker-compose.prod.yml` como Stack de Portainer.**
> El compose fija `container_name` y `deploy.sh` gestiona el proyecto
> compose `motogp` (el nombre del directorio); un stack importado crearía
> contenedores con los mismos nombres y dividiría la propiedad, y el
> siguiente `./deploy.sh` fallaría por conflicto de nombres.
>
> Si ya importaste el stack: Portainer → Stacks → `motogp` → **Delete**
> (borra los contenedores; los datos no se pierden, están en los
> bind-mounts de `/mnt/data-nas/motogp/`) y vuelve a ejecutar `./deploy.sh`.

## 3. Nginx Proxy Manager

**Proxy Hosts → Add Proxy Host** (dos entradas, ambas hacia `192.168.1.3:22020`):

| Entrada | Domain                  | Puerto | SSL                           |
| ------- | ----------------------- | ------ | ----------------------------- |
| Local   | `motogp`                | `81`   | no                            |
| Remoto  | `motogp.raulmorales.eu` | `443`  | sí (Let's Encrypt + tu email) |

Para el acceso remoto, el DNS público debe apuntar `motogp.raulmorales.eu` a la
IP pública de tu router (y el router debe reenviar el 443 al NPM, si no lo hace
ya para otros dominios).

## 4. Actualizaciones

Cuando haya código nuevo en `main`:

```bash
./deploy.sh
```

Cada deploy etiqueta la imagen con el commit (`motogp-web:<sha>`), así que las
versiones anteriores siguen en el NAS hasta que las borres.

## 5. Rollback

```bash
docker images motogp-web                    # lista versiones (sha)
docker tag motogp-web:<sha-antiguo> motogp-web:latest
docker compose -f docker-compose.prod.yml up -d web
```

Si el rollback es por un problema de código, también puedes
`git checkout <sha-antiguo>` y volver a `./deploy.sh`.

## 6. Backups y mantenimiento

- **La BD vive en `/mnt/data-nas/motogp/pgdata`.** Haz snapshots periódicos del
  dataset en TrueNAS (o una copia del directorio). La prueba de restore es la
  tarea T-13 del backlog.
- Logs: `docker compose -f docker-compose.prod.yml logs -f web`
  (o Portainer → Containers → motogp-web → Logs).
- Imágenes huérfanas: `docker image prune` de vez en cuando (con cuidado:
  borra las versiones que no uses).
- **Rotación de secrets (T-19):**
  - `SESSION_SECRET`: cámbialo en `.env` y `docker compose -f docker-compose.prod.yml up -d web`
    (invalida las sesiones activas).
  - `POSTGRES_PASSWORD`: cámbialo en `.env` **y** en la BD
    (`ALTER USER motogp WITH PASSWORD '...';`), y luego `up -d`.

## 7. Solución de problemas

| Síntoma                              | Causa probable             | Solución                                                            |
| ------------------------------------ | -------------------------- | ------------------------------------------------------------------- |
| `deploy.sh` falla en el health-check | la web no arrancó          | `docker compose -f docker-compose.prod.yml logs web`                |
| Postgres no arranca (permisos)       | `pgdata` sin ownership     | `sudo chown -R 999:999 /mnt/data-nas/motogp/pgdata` y reintentar    |
| `git pull` pide contraseña           | falta la config SSH        | revisa `~/.ssh/config` (bloque `Host github-motogp`)                |
| La web no carga por NPM              | proxy mal apuntado         | que apunte a `192.168.1.3:22020` (no a `:3000`)                     |
| `migrate deploy` falla               | imagen sin `prisma/`       | reconstruir: `./deploy.sh`                                          |
| CI en rojo por gitleaks              | alguien commiteó un secret | rota el secret, quítalo del repo (BFG/filter-repo) y vuelve a subir |
