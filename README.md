# Qore CRM

Qore is in its foundation phase. The current application provides a Vue
frontend, an Express API, PostgreSQL migrations, and a containerized local
stack. Authentication, CRM modules, AI, and billing are not implemented yet;
see [plan.md](./plan.md) for the roadmap.

## Requirements

- Node.js 24 and npm for local development.
- Docker and Docker Compose for the database or the full stack.

## Run the full stack

1. Copy `.env.example` to `.env`. Its credentials are **only for local
   development**; do not use them in a deployment.
2. Run `docker compose up --build --wait`.
3. Open <http://localhost:8080>. The API health check is at
   <http://localhost:8080/api/health>.
4. Run `docker compose down` to stop the stack. The database volume is retained.

Compose starts PostgreSQL, runs migrations, and only starts the API and Nginx
after their dependencies are ready. The web and database ports bind to
localhost. Change `WEB_PORT` or `POSTGRES_PORT` in `.env` if needed.
Changing PostgreSQL credentials in `.env` does not change credentials already
stored in an existing database volume.

## Local frontend and API development

1. Create `.env` as above, and run `npm ci`.
2. Start the database: `docker compose up -d --wait db`.
3. The `.env` database URL targets the Docker network. For commands on the
   host, use a URL pointing to the published database port instead:

   ```sh
   export DATABASE_URL=postgresql://qore:qore_local_only@localhost:55432/qore
   npm run db:migrate -w @qore/api
   npm run dev:api
   ```

   Adjust the URL for any credentials or port changed in `.env`.

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

## Deployment note

The provided Compose setup is a local foundation, not a production-hardened
deployment. Before exposing it, supply unique credentials and secrets, arrange
HTTPS termination and trusted proxy settings, and establish backups, restore
tests, monitoring, and an appropriate access policy. Billing is not enabled.
