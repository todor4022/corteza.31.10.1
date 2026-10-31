# Corteza + PostgreSQL

Local Docker Compose setup based on the [Corteza 2026.9 DevOps guide](https://docs.cortezaproject.org/corteza-docs/2026.9/devops-guide/index.html), using Corteza 2026.9 and PostgreSQL 15.

## Start

Docker Engine and Docker Compose are required. Run these commands from this folder:

```sh
docker compose up -d --wait --wait-timeout 180
```

Open <http://localhost:18080> and sign in with the seeded administrator:

- Email: `demo@example.com`
- Password: `DemoPassword123!`

These are the local demo defaults. Set `SEED_USER_EMAIL` and `SEED_USER_PASSWORD` in `.env` before the first start to use different credentials.

The one-shot `seed` service waits for PostgreSQL, initializes Corteza's database through its CLI, creates the administrator, and imports the namespace, module, and sample tickets below. The web server starts after seeding succeeds. The seed container exiting with code 0 is expected. Docker Compose builds the seed image on the first start; it adds Python for the record seed's HTTP and JSON handling.

In **Low Code**, open the **Plexys Homework** namespace (`plexys-homework`). Its **Support Ticket** module (`support-ticket`) has these fields:

| Field label | Internal name | Type | Required | Options |
| --- | --- | --- | --- | --- |
| Subject | `Subject` | String | Yes | |
| Description | `Description` | String | No | Multi-line plain text |
| Status | `Status` | Select | Yes | New, In Progress, Resolved, Closed |
| Priority | `Priority` | Select | Yes | Low, Medium, High, Urgent |
| Due Date | `DueDate` | Date/Time | No | Both date and time |

The seeded administrator can manage this namespace and module. Their definitions live in [`seed/plexys-homework.yaml`](seed/plexys-homework.yaml).

Two sample tickets are created, with descriptions and due dates:

| Subject | Status | Priority |
| --- | --- | --- |
| Unable to sign in to the customer portal | New | High |
| Email notifications are delayed | In Progress | Medium |

Their initial values live in [`seed/support-tickets.json`](seed/support-tickets.json). The record seed briefly runs a Corteza API on the seed container's loopback interface and creates the tickets as the seeded administrator before the main server starts.

Email is not configured, so local sign-ups are automatically confirmed.

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

# Rerun all seeds (existing accounts, resources, and tickets are preserved)
docker compose run --rm seed
# Load any newly imported module definitions into the running server
docker compose restart server

# Check Corteza
curl --fail http://localhost:18080/healthcheck
curl --fail http://localhost:18080/version
```

## Data

PostgreSQL stores its data in `./data/db`, and Corteza stores attachments in `./data/server`. Both survive container recreation and `docker compose down`. These directories and `.env` are excluded from Git. Preserve `.env` along with your data when moving this installation.

PostgreSQL credentials in `.env` initialize a new database only. Changing them later also requires updating the existing PostgreSQL role; editing `.env` alone does not change the stored password.

The user seed checks for an exact email match, ignoring case, and skips existing accounts. It does not reset their passwords or change their roles. Changing `SEED_USER_EMAIL` to a new address creates another administrator on the next start; changing `SEED_USER_PASSWORD` does not reset an existing account. To reset a password explicitly, use the interactive CLI:

```sh
docker compose exec server corteza-server users password demo@example.com
```

Namespace and module seeding still runs when the user already exists. The importer uses `--skip-existing`, matching the namespace by slug, the module by handle, and fields by name, so repeat runs preserve edits and reuse the existing resources. The YAML provides initial configuration; change existing fields in Corteza's module editor.

Sample tickets carry a stable `plexysHomeworkSeedKey` in their record metadata. The seed checks these keys, including on soft-deleted records, and skips existing samples. Editing a subject or deleting a sample ticket does not recreate it on the next run. Keep each JSON `seedKey` unchanged to preserve that identity.

To make a database backup while PostgreSQL is running:

```sh
mkdir -p backups
docker compose exec -T db pg_dump -U corteza -d corteza -Fc > "backups/corteza-$(date +%Y%m%d-%H%M%S).dump"
```

Also back up `data/server` for uploaded files. Pause writes while taking both backups if you need a consistent database and attachments snapshot.
