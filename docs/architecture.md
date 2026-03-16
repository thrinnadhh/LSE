# System Architecture — Local Search Engine (LSE)

## Overview

LSE is a hyperlocal marketplace platform that connects customers with nearby shops and service providers. The platform supports shop discovery, product browsing, order placement, real-time delivery tracking, and in-app chat-based price negotiation.

All external client requests enter through a single **API Gateway**. The gateway performs authentication and routes requests to the appropriate domain service. Services communicate asynchronously through **Kafka** for event-driven workflows (e.g., order placed → inventory reserved → delivery assigned).

```
Clients (Mobile / Web)
         │
         ▼
   ┌─────────────┐
   │ API Gateway │  ← single entry point, auth middleware, route delegation
   └──────┬──────┘
          │ internal calls / shared DB pool
    ┌─────┴──────────────────────────────────────────────────┐
    │                  Domain Services                        │
    │  auth  ·  users  ·  shops  ·  products  ·  inventory   │
    │  orders  ·  delivery  ·  chat  ·  notifications         │
    └─────────────────────────────────────────────────────────┘
          │               │               │
    PostgreSQL          Redis           Kafka
    + PostGIS           cache /         event
    (primary DB)        OTP store       bus
                                         │
                                    OpenSearch
                                    (search index)
```

---

## Services

### auth-service
Handles OTP-based phone authentication. Issues short-lived JWT access tokens and long-lived refresh tokens stored in PostgreSQL. OTPs are stored in Redis with a 5-minute TTL.

**Key endpoints:** `POST /auth/send-otp`, `POST /auth/verify-otp`, `POST /auth/refresh-token`

### user-service
Manages user profiles. Provides identity information to other services. Enforces the `requireAuth` middleware that validates Bearer tokens on protected routes.

**Key endpoints:** `GET /users/me`

### shop-service
Shop owners register and manage their shops. Uses PostGIS `GEOGRAPHY(POINT)` columns and `ST_DWithin` / `ST_Distance` for geospatial proximity queries. Enforces `shop_owner` role for write operations.

**Key endpoints:** `POST /shops`, `GET /shops/:id`, `PUT /shops/:id`, `GET /shops/nearby`

### product-service *(Phase 3)*
Manages product catalogs owned by shops. Each product belongs to a shop and is indexed in OpenSearch for full-text and faceted search.

### inventory-service *(Phase 3)*
Tracks per-shop stock levels. Publishes `inventory.reserved` and `inventory.released` Kafka events to coordinate with the order lifecycle.

### order-service *(Phase 5)*
Manages the complete order lifecycle: placement, confirmation, preparation, and handoff to delivery. Emits Kafka events consumed by inventory, delivery, and notification services.

### delivery-service *(Phase 6)*
Assigns available drivers to orders using geospatial nearest-driver queries. Tracks real-time driver location updates. Emits delivery status events.

### chat-service *(Phase 7)*
Provides real-time WebSocket-based chat between customers and shop owners. Supports price negotiation threads attached to a product or order.

### notification-service *(Phase 8)*
Consumes Kafka events from all other services and dispatches push notifications, SMS, and in-app alerts to the relevant users.

---

## Infrastructure

| Component | Technology | Purpose |
|---|---|---|
| Primary database | PostgreSQL 15 via `postgis/postgis:15-3.4` | Persistent storage for all domain data |
| Geospatial extension | PostGIS 3.4 | `GEOGRAPHY` columns, `ST_DWithin`, `ST_Distance`, GIST indexes |
| Cache / OTP store | Redis 7 | Short-lived OTP codes, session caching |
| Event streaming | Apache Kafka 3 (Confluent 7.6) | Async inter-service events |
| Search engine | OpenSearch 2.13 | Full-text and geo-filtered product / shop search |
| Container runtime | Docker + Compose | Local development stack |

---

## Request Flow — Authenticated API Call

1. Client sends `Authorization: Bearer <access_token>` header.
2. API Gateway's `requireAuth` middleware decodes and validates the JWT.
3. `req.auth` is populated with `{ userId, phone, role }`.
4. The request is delegated to the appropriate service module.
5. The service reads from / writes to PostgreSQL via the shared `pg` connection pool.
6. If the operation triggers a lifecycle event (e.g., order placed), the service publishes a Kafka message.
7. Downstream consumers (delivery, notification) react asynchronously.

---

## Data Ownership

Each domain owns its tables. Cross-domain references use foreign keys only to the `users` table (shared identity). Services never query tables owned by another service directly — all cross-domain data access goes through the API Gateway's service modules.
