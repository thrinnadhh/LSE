# Docker Development Setup

## Files
- docker-compose.dev.yml: Local stack for PostgreSQL, Redis, Kafka, OpenSearch, API
- ../../../.env.example: Root environment variables template
- Dockerfile.backend: Backend API service image

## Quick start
1. From repository root, copy .env.example to .env and adjust values if needed.
2. From repository root, run:
   docker compose -f artifacts/infra/docker/docker-compose.dev.yml up -d
3. Validate dependencies:
   - PostgreSQL: localhost:5432
   - Redis: localhost:6379
   - Kafka: localhost:9092
   - OpenSearch: localhost:9200
   - API Gateway: localhost:8080

## Notes
- This compose setup is optimized for local development, not production.
- In production, use managed services and infrastructure as code in terraform.
- If any local port is already occupied, override host ports in .env (for example POSTGRES_PORT=55432).
