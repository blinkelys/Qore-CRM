# Qore CRM implementation plan

## Goal and scope

Build a multi-organization CRM with configurable modules and an AI assistant that
can find records and perform authorized actions. Start with a useful, secure
foundation that can support different kinds of organizations rather than
trying to build every possible CRM feature at once.

Payments, Stripe integration, billing portals, and automatic subscription
enforcement are **out of scope for now**. Module availability will be
controlled by an internal entitlement mechanism so billing can be connected
later without rewriting module authorization. Do not collect payment details
or present a nonfunctional checkout.

## Technology choices

- **Frontend:** Vue 3, Vite, TypeScript, Tailwind CSS, Vue Router, and Axios.
- **Backend:** Node.js, Express, and TypeScript, with a documented REST API.
- **Database:** PostgreSQL, with migrations and a type-safe database access
  layer. Relational constraints and transactions fit organization membership,
  permissions, and CRM relationships.
- **Infrastructure:** Docker Compose for local development and deployment;
  Nginx serves the frontend and proxies API requests.
- **AI:** a server-side provider adapter and an explicit, allowlisted tool
  interface. The application must remain usable without an AI provider.
- **Later:** Stripe, behind a billing integration that updates entitlements.

## Core architecture and invariants

- Users can belong to multiple organizations. An organization is the
  isolation boundary for records, memberships, module settings, AI
  conversations, and audit events.
- Every organization-scoped request must verify active membership, required
  role or permission, and module entitlement on the server. An organization
  identifier supplied by a client or AI tool is never sufficient authorization.
- Scope every tenant-owned query and mutation by organization. Use database
  constraints, including tenant-aware relationships, to prevent linking
  records across organizations. Test isolation for reads, writes, searches,
  exports, and AI actions.
- Begin with owner, admin, and member roles and explicit permissions. Owners
  can manage the organization and its members; admins manage permitted
  settings and modules; members access permitted CRM functions. The last
  owner cannot be removed or demoted.
- Use a versioned module registry with clear dependencies, permissions,
  routes, navigation, configuration schema, and entitlement checks. Modules
  are application-defined capabilities, not arbitrary uploaded code.
- Track module entitlement separately from enabled state: an entitled module
  may be enabled or disabled for an organization. Disabling a module hides
  its UI and rejects its API and AI actions, but preserves its data.
- Shared API services enforce authorization and validation regardless of
  whether requests come from the UI or AI. Return consistent, actionable
  errors and never expose secrets to the frontend.

## Delivery phases

Each phase ends with its acceptance checks, relevant automated tests, and a
commit as described below. Further split a phase into independently working
features when appropriate.

### 1. Project foundation

- Set up frontend and backend workspaces, TypeScript, linting, formatting,
  environment examples, and test runners.
- Add PostgreSQL migrations, a health endpoint, Docker Compose, and Nginx
  routing. Provide local setup and development documentation.
- Establish API error conventions, structured logging without sensitive
  values, configuration validation, and a CI pipeline.

**Acceptance:** a new developer can start the stack from documented steps;
the frontend loads, the API and database are healthy, and checks run in CI.

### 2. Authentication and organizations

- Implement registration, login, logout, session expiry, and password reset
  using secure password hashing and secure, HTTP-only cookies. Protect
  cookie-authenticated mutations from CSRF, restrict CORS, and rate-limit
  authentication endpoints.
- Create organizations, memberships, invitations with expiring single-use
  tokens, organization switching, and role management. Use a configured
  email delivery adapter; document a local development delivery method.
- Enforce membership and permissions centrally; prevent losing the last owner.

**Acceptance:** a user can create an organization, invite another user, and
switch organizations; expired sessions and invitations are rejected, and
users cannot access another organization's data.

### 3. Module platform

- Implement the module registry, dependency validation, internal entitlements,
  enable/disable lifecycle, per-organization settings, and permission checks.
- Add a module management screen with available, enabled, and unavailable
  states. Seed explicit development entitlements; expose no public entitlement
  editing or payment flow.
- Define safe data retention on disable and a migration/versioning approach
  for module schema and configuration changes.

**Acceptance:** an entitled module can be enabled and configured; disabled or
unentitled modules are unavailable through the UI, API, and AI tools, and
re-enabling preserves their data.

### 4. Core CRM modules

- Build a contacts module with organization-scoped customers, search,
  filtering, pagination, validation, and create/read/update/archive actions.
- Build a companies module and tenant-safe contact-to-company relationships.
- Add notes and activities associated with CRM records, with authorship and
  timestamps. Add an opportunity pipeline with configurable stages and
  organization-scoped opportunities as a separate module.
- Provide accessible list, detail, and form views with loading, empty, and
  error states. Handle duplicate or conflicting updates clearly.

**Acceptance:** authorized members can manage and find CRM records; linked
records cannot cross organizations; archiving preserves related history and
does not unexpectedly remove data.

### 5. AI assistant

- Add an organization-scoped chat interface and server-side provider adapter,
  with explicit configuration and a clear disabled state when unavailable.
- Expose a small allowlist of typed tools initially: search/read customers,
  create a customer, list available modules, and propose module configuration
  changes. Reuse the same services, validation, permissions, and entitlement
  checks as the API.
- Require an explicit user confirmation before mutations, including enabling
  or configuring modules. Bind confirmations to the exact proposed action,
  organization, and user; reject stale or modified proposals. Never execute
  arbitrary code, SQL, shell commands, or unregistered tools.
- Treat user messages, CRM content, and provider responses as untrusted.
  Limit tool calls and context, minimize data sent to the provider, avoid
  logging sensitive prompts, and make provider failures visible.
- Persist conversation history with organization-scoped access and a
  documented retention/deletion policy.

**Acceptance:** the assistant can find a customer and propose a permitted
change; no mutation happens before confirmation, and unauthorized,
cross-organization, disabled-module, and malformed tool calls are rejected.

### 6. Operations and hardening

- Add organization-scoped audit events for membership, module, and
  AI-initiated changes, recording actor and action without secrets.
- Document production configuration, HTTPS termination, backups and restore
  verification, migrations, monitoring, and incident recovery. Keep credentials
  out of images and version control.
- Run end-to-end flows and security-focused checks for authentication,
  tenant isolation, permissions, module enforcement, and AI confirmation.
- Verify responsive and accessible UI behavior and document known limitations.

**Acceptance:** the documented deployment can be started and recovered from
a tested backup; audit events identify relevant changes; critical user flows
and isolation checks pass.

## Future billing integration

When a Stripe account is available, design subscriptions, checkout, customer
portal, webhook verification, idempotency, billing lifecycle, and reconciliation
as a separate phase. Stripe events should update the existing entitlement
model; server-side module enforcement must remain independent of the UI.
Define trials, grace periods, and downgrade/data-retention behavior before
implementing billing.

## Validation strategy

- Unit tests for permission decisions, module dependencies and lifecycle,
  validation, and AI tool/confirmation rules.
- Integration tests against PostgreSQL for migrations, tenant isolation,
  relationships, auth, invitations, and API module enforcement.
- End-to-end tests for registration, organization switching, module setup,
  CRM workflows, and AI confirmation using a deterministic provider stub.
- Run the smallest relevant test set for each change, plus lint, type checks,
  and build before completing a major feature. Exercise the Docker/Nginx
  setup and backup/restore procedure before release.

## Commit workflow

After each completed and verified major feature, inspect the working tree,
then run `git add .` and commit using the requested convention, for example
`git commit -m "feat(auth): add organization membership"`. Use `fix(section)`
or `chore(section)` where appropriate. Include the required co-author trailer
in the commit message. Do not stage unrelated changes or secrets; resolve any
unexpected shared working-tree changes before running `git add .`.
