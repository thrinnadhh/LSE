# Repository Map — Local Search Engine (LSE)

This file is the authoritative guide to where code belongs. AI agents must read this file before creating or modifying any file to ensure new code is placed in the correct location.

---

## Top-level Layout

```
LocalSearchEngine/
├── repo/                        ← all application source code
├── artifacts/                   ← build, infra, and database artifacts
├── docs/                        ← project documentation (this directory)
├── Makefile                     ← developer workflow commands (DO NOT MODIFY)
├── package.json                 ← root Node.js manifest (workspaces)
├── .env.example                 ← environment variable template (DO NOT COMMIT secrets)
└── README.md
```

---

## `repo/` — Application Source Code

All production and development application code lives here.

```
repo/
├── apps/                        ← deployable applications (servers, clients)
│   ├── api-gateway/             ← Express.js HTTP server — single entry point for all API traffic
│   │   └── src/
│   │       ├── server.js        ← app bootstrap: mounts all routers, starts HTTP listener
│   │       └── lib/             ← shared utilities used across all service modules
│   │           ├── config.js    ← centralised env-var config with dev defaults
│   │           ├── db.js        ← pg connection pool singleton + schema bootstrap helpers
│   │           ├── redis.js     ← ioredis client singleton
│   │           └── errors.js    ← ApiError, asyncHandler, errorHandler middleware
│   ├── customer-mobile/         ← React Native customer app (future)
│   ├── shop-mobile/             ← React Native shop-owner app (future)
│   ├── driver-mobile/           ← React Native driver app (future)
│   ├── shop-web/                ← Next.js shop dashboard web app (future)
│   └── admin-web/               ← Next.js admin panel (future)
│
├── services/                    ← domain service modules (business logic)
│   ├── auth-service/
│   │   └── src/
│   │       ├── auth-service.js  ← sendOtp, verifyOtp, refreshToken
│   │       └── routes.js        ← Express router mounted at /auth
│   ├── user-service/
│   │   └── src/
│   │       ├── user-service.js  ← getMe
│   │       └── routes.js        ← Express router mounted at /users
│   ├── shop-service/
│   │   └── src/
│   │       ├── shop-service.js  ← createShop, getShopById, updateShop,
│   │       │                       findNearbyShops, ensureShopTables
│   │       └── routes.js        ← Express router mounted at /shops
│   ├── product-service/         ← Phase 3: product CRUD + OpenSearch indexing
│   ├── order-service/           ← Phase 5: order lifecycle
│   ├── delivery-service/        ← Phase 6: driver assignment + tracking
│   ├── search-service/          ← Phase 4: OpenSearch query layer
│   ├── chat-service/            ← Phase 7: WebSocket chat / bargaining
│   ├── notification-service/    ← Phase 8: Kafka consumer → push dispatching
│   ├── dispatch-service/        ← Phase 6: driver dispatch optimisation
│   └── payment-service/         ← Phase 9: payment gateway integration
│
├── packages/                    ← shared internal packages (imported by multiple services)
│   └── contracts/               ← TypeScript/JS type definitions and Zod schemas shared between services
│
├── data/                        ← seed data, test fixtures, migration helpers
└── docs/                        ← service-level documentation (supplements root docs/)
```

### Rule: Where does new service code go?

| What you're adding | Where it goes |
|---|---|
| New domain service (e.g., product-service) | `repo/services/product-service/src/` |
| Route handler for a new service | `repo/services/<name>/src/routes.js` |
| Business logic for a new service | `repo/services/<name>/src/<name>-service.js` |
| Shared utility (used by 2+ services) | `repo/apps/api-gateway/src/lib/` |
| New API route mounted on the gateway | `repo/apps/api-gateway/src/server.js` |
| Shared type/schema contract | `repo/packages/contracts/` |

---

## `artifacts/` — Infrastructure and Build Artifacts

```
artifacts/
├── database/
│   └── schema.sql               ← authoritative DB schema; auto-loaded by Postgres on first init
│                                  Add new tables here as ALTER TABLE … IF NOT EXISTS or CREATE TABLE … IF NOT EXISTS
├── infra/
│   ├── docker/
│   │   ├── docker-compose.dev.yml  ← local dev stack (DO NOT MODIFY without explicit instruction)
│   │   ├── Dockerfile.backend      ← api-gateway container image
│   │   └── .env.example            ← compose env template
│   └── terraform/               ← cloud infrastructure-as-code (Phase 10)
├── api/                         ← OpenAPI specs / API contract documentation
├── repository/                  ← data access layer patterns and examples
└── services/                    ← generated service stubs or shared service configs
```

---

## `docs/` — Project Documentation

```
docs/
├── architecture.md              ← system overview, service descriptions, infrastructure
├── development-roadmap.md       ← phased plan with checkpoint tags
├── repo-map.md                  ← this file; canonical guide to where code belongs
├── ai-guidelines.md             ← rules AI agents must follow when modifying the repo
└── local-development.md         ← how to run the local stack
```

---

## Naming Conventions

| Artifact | Convention | Example |
|---|---|---|
| Service directory | `kebab-case` | `shop-service/` |
| Service module file | `<name>-service.js` | `shop-service.js` |
| Route file | `routes.js` | `routes.js` |
| DB table | `snake_case`, plural | `shop_locations` |
| Kafka topic | `<domain>.<event>` | `order.placed` |
| Git branch | `phase-N/<short-description>` | `phase-3/product-crud` |
| Git tag (checkpoint) | `checkpoint-phase-N` | `checkpoint-phase-2` |
