# AI Development Guidelines — Local Search Engine (LSE)

This file defines the rules that AI agents **must** follow when reading, writing, or modifying any part of this repository. These rules exist to prevent context drift, unintended regressions, and out-of-phase implementation.

---

## 1. Mandatory Pre-Read Checklist

Before modifying any file, an AI agent must read and understand the following documents:

| File | Why it must be read |
|---|---|
| `docs/architecture.md` | Understand the service boundaries, data ownership, and infrastructure components |
| `docs/development-roadmap.md` | Identify the current phase and confirm the task falls within that phase |
| `docs/repo-map.md` | Determine the correct file and directory for any new code |
| `docs/ai-guidelines.md` | This file — confirm all rules before proceeding |

Skipping any of these reads is a violation of these guidelines.

---

## 2. Files and Directories AI Must NOT Modify

The following files are considered infrastructure anchors. Modifying them without explicit written instruction from the project owner will break the local development environment or CI pipeline.

```
artifacts/infra/docker/docker-compose.dev.yml
artifacts/infra/docker/Dockerfile.backend
artifacts/infra/docker/.env.example
Makefile
.env
.env.example
package.json           ← only modify dependencies if the phase explicitly requires a new package
package-lock.json      ← never manually edit; only updated by npm install
```

**Hard rule:** If a task can be completed without touching these files, do not touch them.

---

## 3. Files AI May Modify

Within the scope of the current phase, AI may create or modify:

```
repo/services/<service-name>/src/          ← service business logic and routes
repo/apps/api-gateway/src/server.js        ← only to mount a new router for the current phase
repo/apps/api-gateway/src/lib/             ← only to add shared utilities clearly needed by the phase
artifacts/database/schema.sql             ← append new tables/columns using IF NOT EXISTS guards
docs/                                     ← documentation updates
```

When in doubt about whether a file is safe to modify, stop and ask for confirmation.

---

## 4. Phase Discipline

### 4.1 Work One Phase at a Time

AI must implement exactly the phase it is instructed to implement. The `docs/development-roadmap.md` file defines what belongs to each phase.

- ✅ Implement only endpoints and tables listed for the current phase.
- ❌ Do not implement features from future phases even if they seem logically related.
- ❌ Do not refactor code from previous phases unless the current phase explicitly requires it.

### 4.2 Do Not Rewrite Working Code

If a previous phase's code is working (verified by checkpoint tags and tests), do not rewrite it. Extend it only if strictly required by the current phase.

### 4.3 Verify the Phase Before Starting

Before writing any code, confirm the current active phase by:

1. Checking the most recent `checkpoint-phase-N` git tag.
2. Reading `docs/development-roadmap.md` to understand what the next phase requires.
3. Confirming with the user if there is ambiguity.

---

## 5. Database Schema Rules

- All new tables must use `CREATE TABLE IF NOT EXISTS`.
- All new columns must use `ALTER TABLE … ADD COLUMN IF NOT EXISTS`.
- Every table must have a UUID primary key: `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`.
- Every table must include `created_at TIMESTAMPTZ DEFAULT NOW()`.
- Foreign keys to the `users` table are allowed. Foreign keys to tables owned by other services must be avoided — use the `user_id` reference pattern instead.
- Geospatial columns must use `GEOGRAPHY(POINT, 4326)` and must have a GIST index.
- New indexes must use `CREATE INDEX IF NOT EXISTS`.

---

## 6. Code Style and Patterns

### 6.1 Follow Existing Patterns

Each new service must follow the structure already established by `auth-service` and `shop-service`:

```
repo/services/<name>/src/
├── <name>-service.js    ← pure functions: business logic, DB queries, validation
└── routes.js            ← Express router: minimal glue, delegates to service module
```

### 6.2 Validation

All request inputs must be validated using `zod` schemas defined at the top of the service module file. Never trust raw `req.body` or `req.query` values without parsing through a zod schema first.

### 6.3 Error Handling

All async route handlers must be wrapped with the `asyncHandler` utility from `repo/apps/api-gateway/src/lib/errors.js`. Throw `ApiError(statusCode, message)` for domain-level errors. Never use `res.send()` or `res.json()` directly for error responses.

### 6.4 Authentication

Protected routes must use the `requireAuth` middleware exported by `repo/services/user-service/src/routes.js`. Do not re-implement JWT verification logic.

### 6.5 Database Access

Always use the `db` pool provided via dependency injection from `server.js`. Never create a new `pg.Pool` inside a service module.

---

## 7. Security Requirements

- Never log JWT tokens, OTP codes, or raw passwords.
- Never expose internal error stack traces in API responses (`NODE_ENV=production` must return only `{"error":"message"}`).
- Parameterize all SQL queries. String interpolation into SQL is strictly forbidden.
- Validate all user-controlled inputs before using them in queries, file paths, or external calls.
- Webhook endpoints (Phase 9) must verify cryptographic signatures before processing payloads.
- Rate limiting must be applied to `POST /auth/send-otp` before Phase 10 ships to production.

---

## 8. Testing Requirements

Every phase must include at minimum a smoke test that:

1. Exercises every new endpoint introduced in the phase (happy path + at least one error path).
2. Can be run as a single Node.js script against the live local stack.
3. Exits with code `0` on success and code `1` on failure.

Place smoke tests at: `repo/services/<name>/src/<name>-smoke-test.js`

---

## 9. Kafka Event Contracts

When a service publishes a Kafka event:

- The topic name must follow the `<domain>.<event>` pattern (e.g., `order.placed`).
- The payload must be JSON-serializable.
- The schema for the event payload must be documented in `repo/packages/contracts/`.
- Never change an existing event's payload shape without versioning the topic.

---

## 10. Commit and Tagging Protocol

At the end of each phase:

```bash
# Commit all phase work
git add .
git commit -m "feat: complete phase N — <short summary>"

# Tag the stable checkpoint
git tag checkpoint-phase-N

# Push both commit and tag
git push origin main
git push origin checkpoint-phase-N
```

These tags are the restore points. If a future phase breaks the system, the team can reset to the last checkpoint tag and restart from a known-good state.
