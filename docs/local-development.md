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

## Troubleshooting
- If startup fails with "bind: address already in use", change host ports in .env:
  - POSTGRES_PORT=55432
  - REDIS_PORT=56379
  - OPENSEARCH_PORT=59200
  - API_GATEWAY_PORT=58080
- Then run make dev-up again.
