# Corteza + PostgreSQL

Local Docker Compose setup based on the [Corteza 2026.9 DevOps guide](https://docs.cortezaproject.org/corteza-docs/2026.9/devops-guide/index.html), using Corteza 2026.9 and PostgreSQL 15.

## Start

Docker Engine and Docker Compose are required. Run these commands from this folder:

```sh
docker compose up -d --wait --wait-timeout 180
```

Open <http://localhost:18080> and create your account. The first account becomes the administrator. Email is not configured, so local sign-ups are automatically confirmed.

The local `.env` has generated database and JWT signing secrets. Keep it private. On a fresh checkout without `.env`, prepare it first:

```sh
cp .env.example .env
openssl rand -hex 24
openssl rand -hex 32
```

Use those two values for `POSTGRES_PASSWORD` and `AUTH_JWT_SECRET`, respectively, before starting. `DB_DSN` picks up the database credentials automatically.

Corteza listens only on `127.0.0.1`; PostgreSQL is reachable only within the Compose network. To change the local port, edit `HTTP_PORT` in `.env` and recreate the containers with `docker compose up -d --wait`.

## Manage

```sh
# Status and logs
docker compose ps
docker compose logs -f --tail=100

# Stop; start again with the command above
docker compose down

# PostgreSQL console
docker compose exec db psql -U corteza -d corteza

# Check Corteza
curl --fail http://localhost:18080/healthcheck
curl --fail http://localhost:18080/version
```

## Data

PostgreSQL stores its data in `./data/db`, and Corteza stores attachments in `./data/server`. Both survive container recreation and `docker compose down`. These directories and `.env` are excluded from Git. Preserve `.env` along with your data when moving this installation.

PostgreSQL credentials in `.env` initialize a new database only. Changing them later also requires updating the existing PostgreSQL role; editing `.env` alone does not change the stored password.

To make a database backup while PostgreSQL is running:

```sh
mkdir -p backups
docker compose exec -T db pg_dump -U corteza -d corteza -Fc > "backups/corteza-$(date +%Y%m%d-%H%M%S).dump"
```

Also back up `data/server` for uploaded files. Pause writes while taking both backups if you need a consistent database and attachments snapshot.
