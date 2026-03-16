# Local Development Setup

This guide starts the full local infrastructure stack for development.

## Prerequisites
- Docker Desktop (or Docker Engine + Compose v2)
- GNU Make

## 1. Prepare environment
1. Copy root environment template:
   cp .env.example .env
2. Edit .env only if you need custom local values.

If .env is not present, compose falls back to safe defaults in docker-compose.dev.yml.

## 2. Start local stack
Run one command:

```bash
make dev-up
```

Equivalent direct command:

```bash
docker compose -f artifacts/infra/docker/docker-compose.dev.yml up -d
```

## 3. Verify services
Expected endpoints:
- Postgres: localhost:5432
- Redis: localhost:6379
- OpenSearch: http://localhost:9200
- API Gateway health: http://localhost:8080/health

Verify PostGIS extension is available:

```bash
docker exec -it hyperlocal-postgres psql -U postgres -d hyperlocal -c "SELECT PostGIS_Version();"
```

Expected output includes a PostGIS version string.

Check health endpoint:

```bash
curl http://localhost:8080/health
```

Expected response:

```json
{
  "status": "ok",
  "service": "api-gateway"
}
```

## 4. Logs and shutdown
Follow logs:

```bash
make dev-logs
```

Stop stack:

```bash
make dev-down
```

Reset stack and volumes:

```bash
make dev-reset
```

## Notes
- Database schema auto-loads from artifacts/database/schema.sql on first Postgres initialization.
- If you change schema and need re-init, run make dev-reset and then make dev-up.
- The platform uses PostGIS for geospatial queries: nearby shop search, nearest driver assignment, and distance calculations.
- PostGIS is required because the schema stores geospatial coordinates with geography columns and uses spatial indexes for performant location queries.

## AI Development Workflow

When AI tools assist with implementing a new phase, every phase must end with a stable checkpoint commit and a git tag. This allows the team (and any AI agent) to restore a known-good state if a later phase introduces regressions.

### Checkpoint Protocol

At the end of each phase, run:

```bash
# Stage and commit all phase work
git add .
git commit -m "feat: complete phase N — <short summary>"

# Tag the stable checkpoint
git tag checkpoint-phase-N

# Push both the commit and the tag
git push origin main
git push origin checkpoint-phase-N
```

### Restoring a Checkpoint

If a phase breaks the system, reset to the last good checkpoint:

```bash
# List available checkpoint tags
git tag -l "checkpoint-phase-*"

# Reset to a specific checkpoint (local only — confirm before force-pushing)
git checkout checkpoint-phase-N
```

### AI Context Entry Point

Before starting any AI-assisted development session, point the AI tool to the following files as the mandatory context entry point:

1. `docs/architecture.md` — system overview and service descriptions
2. `docs/development-roadmap.md` — current phase and what it requires
3. `docs/repo-map.md` — where new code must be placed
4. `docs/ai-guidelines.md` — strict rules the AI must follow

These four files together prevent context-window drift and ensure the AI agent works within the correct phase and file boundaries.

---

## Troubleshooting
- If startup fails with "bind: address already in use", change host ports in .env:
  - POSTGRES_PORT=55432
  - REDIS_PORT=56379
  - OPENSEARCH_PORT=59200
  - API_GATEWAY_PORT=58080
- Then run make dev-up again.
