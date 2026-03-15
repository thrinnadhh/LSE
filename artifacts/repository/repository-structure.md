# Monorepo Folder Structure (Generated)

Date: 15 March 2026

```text
repo/
  apps/
    customer-mobile/
    shop-mobile/
    driver-mobile/
    admin-web/
    shop-web/
    api-gateway/
  services/
    auth-service/
    user-service/
    shop-service/
    product-service/
    inventory-service/
    search-service/
    order-service/
    dispatch-service/
    delivery-service/
    payment-service/
    chat-service/
    notification-service/
    admin-service/
    realtime-gateway/
    worker-indexer/
    worker-notifications/
    worker-reconciliation/
  packages/
    shared-types/
    shared-auth/
    shared-config/
    shared-observability/
    shared-errors/
    contracts/
    ui-kit/
  infra/
    terraform/
      environments/
        dev/
        staging/
        prod/
      modules/
        network/
        eks/
        rds/
        redis/
        opensearch/
        kafka/
        object-storage/
    docker/
  data/
    migrations/
    seeds/
    schemas/
  ops/
    scripts/
    runbooks/
    load-tests/
    incident-playbooks/
  docs/
    architecture/
    api/
    adr/
```

## Ownership model
- apps: frontend and gateway teams
- services: backend domain squads
- packages: platform/shared libraries
- infra: platform/SRE
- ops: SRE + incident management
- docs: architecture and ADR governance

## Baseline conventions
- One service per folder with its own Dockerfile and tests
- Shared contracts versioned in packages/contracts
- Infra changes go through pull requests with plan output attached
- Every service must include health/readiness endpoints and OpenAPI/gRPC contracts
