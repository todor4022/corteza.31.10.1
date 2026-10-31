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

The one-shot `seed` service waits for PostgreSQL, initializes Corteza's database through its CLI, creates the administrator, and imports the namespace, module, and sample tickets below. The web server starts after seeding succeeds. The seed container exiting with code 0 is expected. Docker Compose builds the seed and server images on the first start. The seed image adds Python for the record seed's HTTP and JSON handling; the server image builds and includes the Vue tickets app.

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

## Tickets app

Open <http://localhost:18080/tickets> (or `<domain>/tickets`). The Vue 3 Composition API app uses shadcn-vue components to list Support Ticket records, create and edit tickets in a modal, and delete tickets after confirmation. The list uses cursor pagination, and field labels, required fields, and select options come from the Corteza module definition. Due dates are displayed and entered in your browser's local time zone and stored in UTC.

The source lives in [`tickets/`](tickets/). [`Dockerfile.server`](Dockerfile.server) builds it with Vite and copies the static output into Corteza's webapp directory. Compose registers `tickets` in `HTTP_WEBAPP_LIST`, so Corteza serves the app and its assets directly on the same domain and port.

Build and start it, or rebuild after editing the app:

```sh
docker compose up -d --build --wait --wait-timeout 180 server
```

For frontend development with Node.js 22.12 or newer:

```sh
cd tickets
npm ci
npm run dev
```

Open <http://localhost:5173/tickets/> for hot reload. The standalone development server is separate from the app served by Corteza; rebuild the server image to update `/tickets` there.

Vite proxies `/api`, `/auth`, and `/tickets/config.js` to Corteza at `localhost:18080`. For sign-in on the development port, add this explicit callback to `.env` and recreate the server before using Vite:

```dotenv
AUTH_DEFAULT_REDIRECT_URIS=http://localhost:5173/tickets/auth/callback
```

Adjust the proxy target in `tickets/vite.config.js` if you change Corteza's port. Remove the development callback when it is no longer needed. The normal app served by Corteza needs no extra redirect configuration.

Authentication lives in `tickets/src/lib/auth.js` and is exposed through the shared `useCortezaAuth()` composable. It uses Corteza's built-in `/auth/oauth2/default-client` authorization-code flow with `profile api` scopes and the `/tickets/auth/callback` route. An existing Corteza login session is reused; otherwise users see Corteza's normal login page. OAuth client credentials stay on the server. This is Corteza's existing default-client flow; its helper does not forward PKCE challenges.

Access tokens stay in memory. Refresh tokens and temporary OAuth state use only `tickets.auth.*` session-storage keys. State is cryptographically random, validated and consumed once; callback codes are removed from the URL. Concurrent requests share one refresh operation, refreshed tokens replace previous tokens, and duplicated tabs obtain separate grants. A temporary network failure preserves refresh credentials. Sign-out clears Tickets credentials, notifies other Tickets tabs, and opens Corteza's logout page. Other Corteza apps can retain their separately issued tokens.

API calls use the signed-in user's bearer token. Corteza remains responsible for all access checks and the `createdBy`, `updatedBy`, and `deletedBy` identities. The app does not send those identities, set an owner, use a service account, or store a client secret. Buttons and form fields follow the permission flags returned by Corteza. Edits PATCH only changed fields on the selected record, preserving other fields, record metadata, and ownership. Concurrent changes to different fields are preserved; simultaneous changes to the same field use Corteza's last-write behavior.

`ACTIONLOG_ENABLED=true` enables Corteza's action log for subsequent activity. On an older checkout, change this setting in `.env` before recreating the server. Record authorship is stored independently of the action log; a complete field-by-field revision history additionally requires Corteza's module revision configuration.

Run authentication, API-error, and record-payload tests with:

```sh
cd tickets
npm test
npm run build
```

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
