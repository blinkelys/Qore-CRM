# Qore CRM

Qore is in its foundation phase. The current application provides a Vue
frontend, an Express API, PostgreSQL migrations, a containerized local stack,
and authentication and organization management. CRM modules, AI, and billing are not
implemented yet; see [plan.md](./plan.md) for the roadmap.

## Requirements

- Node.js 24 and npm for local development.
- Docker and Docker Compose for the database or the full stack.

## Run the full stack

1. Copy `.env.example` to `.env`. Its credentials are **only for local
   development**; do not use them in a deployment.
2. Run `docker compose up --build --wait`.
3. Open <http://localhost:8080>. The API health check is at
   <http://localhost:8080/api/health>.
   Development email is available in Mailpit at <http://localhost:8025>.
4. Run `docker compose down` to stop the stack. The database volume is retained.

Compose starts PostgreSQL, runs migrations, and only starts the API and Nginx
after their dependencies are ready. The web and database ports bind to
localhost. Change `WEB_PORT` or `POSTGRES_PORT` in `.env` if needed.
If you change `WEB_PORT`, update `APP_ORIGIN` to match the browser URL.
Changing PostgreSQL credentials in `.env` does not change credentials already
stored in an existing database volume.

Create an account from the home page, then create an organization in the
workspace. Owners can invite people and manage roles there; invitees can
open the emailed link, sign in or register with the invited address, and
accept it. Use the organization selector to switch between organizations.
Password recovery links are also delivered to Mailpit locally.

## Local frontend and API development

1. Create `.env` as above, and run `npm ci`.
2. Start the database: `docker compose up -d --wait db`.
3. Start the development mail server with `docker compose up -d mailpit`.
   The `.env` database and mail hostnames target the Docker network. For
   commands on the host, use the published ports instead:

   ```sh
   export DATABASE_URL=postgresql://qore:qore_local_only@localhost:55432/qore
   export SMTP_HOST=localhost
   export APP_ORIGIN=http://localhost:5173
   npm run db:migrate -w @qore/api
   npm run dev:api
   ```

   Adjust the URL and host settings for any credentials or ports changed in
   `.env`. Set `APP_ORIGIN` to the exact URL used to access the frontend.

4. In another terminal, run `npm run dev:web` and open the Vite URL it prints.
   Vite proxies `/api` to the API on port 3000. Host environment variables
   override values loaded from `.env`.

The migration command is safe to repeat and applies pending migrations in
order. Add new migrations under `apps/api/migrations` and keep the Drizzle
schema in `apps/api/src/db/schema.ts` consistent with them.

## Checks

Run `npm run lint`, `npm run format:check`, `npm run build`, and `npm test`.
Use `npm run format` to format files. CI also starts the full container stack
and checks the frontend and API through Nginx.

## API conventions

`GET /api/health` returns `{"status":"ok"}` only when the database is
reachable and initialized. It returns HTTP 503 with a `DATABASE_UNAVAILABLE`
error otherwise. API errors use
`{"error":{"code":"ERROR_CODE","message":"Human-readable message."}}`.
The server validates configuration at startup and logs request method, status,
and duration, not request bodies, query strings, or database credentials.

Authentication endpoints are `POST /api/auth/register`, `/login`, `/logout`,
`/forgot-password`, and `/reset-password`, plus `GET /api/auth/session`.
Passwords must be 12–128 characters. Sessions expire after seven days;
password reset links expire after one hour, are single-use, and revoke all
existing sessions. All API mutations require an `Origin` header matching
`APP_ORIGIN`; cross-origin access is not enabled. Authentication requests
are rate-limited per IP in memory, so a multi-instance deployment needs a
shared rate-limit store. Account recovery and invitation links are sent by
SMTP; the included Mailpit service is for local development only.

Authenticated users can create and list organizations with `/api/organizations`,
and list, change, or remove members via
`/api/organizations/:organizationId/members`. Owners can assign roles and
invite any role. Admins can invite or remove members but cannot manage owners
or admins; members can leave an organization. The last owner cannot leave or
be demoted. Invitations expire after seven days, are single-use, and can only
be accepted by an account with the invited email address. An invitation also
becomes invalid if its sender no longer has permission to issue it.
Organization APIs check active membership for each request.

To run database-backed integration tests, apply the migrations to a dedicated
test database and set `TEST_DATABASE_URL` when running
`npm run test:integration -w @qore/api`. Tests create and remove their own
records; never point them at a production database.

## Deployment note

The provided Compose setup is a local foundation, not a production-hardened
deployment. Before exposing it, supply unique credentials and secrets, arrange
HTTPS termination and trusted proxy settings, and establish backups, restore
tests, monitoring, and an appropriate access policy. Billing is not enabled.
Set `NODE_ENV=production`, `APP_ORIGIN` to the HTTPS origin, and configure
an authenticated SMTP server with `SMTP_SECURE=true` or
`SMTP_REQUIRE_TLS=true`. Set `SMTP_USER` and `SMTP_PASSWORD` together.
Only enable `TRUST_PROXY=1` when the API is accessible exclusively through
one trusted reverse proxy. Do not expose Mailpit in production.
