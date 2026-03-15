COMPOSE_FILE=artifacts/infra/docker/docker-compose.dev.yml

.PHONY: dev-up dev-down dev-logs dev-reset

dev-up:
	docker compose -f $(COMPOSE_FILE) up -d

dev-down:
	docker compose -f $(COMPOSE_FILE) down

dev-logs:
	docker compose -f $(COMPOSE_FILE) logs -f

dev-reset:
	docker compose -f $(COMPOSE_FILE) down -v
