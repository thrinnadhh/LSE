# Development Roadmap — Local Search Engine (LSE)

Each phase produces a working, tested vertical slice that is committed and tagged before the next phase begins. No phase may depend on code from a future phase.

---

## Phase 0 — Infrastructure ✅ COMPLETE

Set up the local development environment and CI foundation.

- Docker Compose stack: PostgreSQL + PostGIS, Redis, Kafka + Zookeeper, OpenSearch, API Gateway
- `schema.sql` auto-loaded on first Postgres container initialization
- `Makefile` targets: `dev-up`, `dev-down`, `dev-reset`, `dev-logs`
- Health check endpoint: `GET /health`
- PostGIS 3.4 extension enabled; GIST index scaffold ready for geospatial queries

**Checkpoint tag:** `checkpoint-phase-0`

---

## Phase 1 — Authentication ✅ COMPLETE

Implement OTP-based phone authentication with JWT session management.

- `POST /auth/send-otp` — generate and store 6-digit OTP in Redis (300 s TTL)
- `POST /auth/verify-otp` — validate OTP, upsert user, issue access + refresh tokens
- `POST /auth/refresh-token` — rotate refresh token, revoke previous session
- `GET /users/me` — return authenticated user profile
- Tables: `users`, `otp_codes`, `user_sessions`
- `requireAuth` middleware validates Bearer JWT on protected routes

**Checkpoint tag:** `checkpoint-phase-1`

---

## Phase 2 — Shop Service ✅ COMPLETE

Allow shop owners to register and manage shops; allow customers to discover nearby shops.

- `POST /shops` — create shop (requires `role=shop_owner`)
- `GET /shops/:id` — retrieve shop details including coordinates
- `PUT /shops/:id` — update shop info (owner only)
- `GET /shops/nearby?lat=&lng=&radius=` — PostGIS `ST_DWithin` proximity search, sorted by distance
- Tables: `shop_locations` (`GEOGRAPHY(POINT, 4326)`), `shop_hours`
- GIST index on `shop_locations.location` for performant spatial queries

**Checkpoint tag:** `checkpoint-phase-2`

---

## Phase 3 — Product & Inventory

Enable shop owners to add products and manage per-shop stock levels.

- Product CRUD: `POST /products`, `GET /products/:id`, `PUT /products/:id`, `DELETE /products/:id`
- List products by shop: `GET /shops/:id/products`
- Inventory endpoints: `GET /products/:id/inventory`, `PUT /products/:id/inventory`
- Index products in OpenSearch on create/update
- Tables: `products`, `inventory`
- Kafka event: `product.created`, `inventory.updated`

**Checkpoint tag:** `checkpoint-phase-3`

---

## Phase 4 — Search

Full-text and geo-filtered product and shop discovery via OpenSearch.

- `GET /search/products?q=&lat=&lng=&radius=&category=`
- `GET /search/shops?q=&lat=&lng=&radius=`
- OpenSearch index mappings for products and shops (geo_point field type)
- Sync Kafka consumer: listens to `product.created`, `shop.updated` events and updates the index
- Result ranking by relevance score × proximity

**Checkpoint tag:** `checkpoint-phase-4`

---

## Phase 5 — Order System

Allow customers to place orders and track their lifecycle.

- `POST /orders` — place order (validates inventory)
- `GET /orders/:id` — get order details
- `GET /orders/my` — list customer orders
- `PUT /orders/:id/status` — shop owner updates status (accepted, ready, cancelled)
- Tables: `orders`, `order_items`
- Kafka events: `order.placed`, `order.accepted`, `order.ready`, `order.cancelled`
- Inventory reservation on `order.placed`; release on `order.cancelled`

**Checkpoint tag:** `checkpoint-phase-5`

---

## Phase 6 — Delivery System

Assign drivers, track real-time location, and manage delivery status.

- Driver registration and availability toggle
- `POST /delivery/assign` — nearest available driver assigned via PostGIS query
- `PUT /delivery/:id/location` — driver pushes GPS coordinate
- `GET /delivery/:id/status` — customer polls delivery status
- Tables: `drivers`, `deliveries`, `driver_locations` (`GEOGRAPHY(POINT)`)
- Kafka events: `delivery.assigned`, `delivery.picked_up`, `delivery.completed`

**Checkpoint tag:** `checkpoint-phase-6`

---

## Phase 7 — Chat / Bargaining

Real-time WebSocket messaging between customers and shop owners.

- WebSocket connection authenticated by JWT
- Chat threads scoped to a product or order
- `POST /chat/threads` — open a negotiation thread
- `GET /chat/threads/:id/messages` — message history
- Price offer / counter-offer message types
- Tables: `chat_threads`, `chat_messages`

**Checkpoint tag:** `checkpoint-phase-7`

---

## Phase 8 — Notifications

Push and in-app notifications driven by Kafka events.

- Kafka consumer listening to events from orders, delivery, and chat services
- FCM / APNs push notification dispatch
- In-app notification inbox: `GET /notifications`, `PUT /notifications/:id/read`
- Tables: `notifications`

**Checkpoint tag:** `checkpoint-phase-8`

---

## Phase 9 — Payments

Integrate payment gateway for order checkout.

- `POST /payments/initiate` — create payment intent
- `POST /payments/webhook` — handle payment gateway callback (signature-verified)
- Update order status on payment success
- Refund flow for cancelled orders
- Tables: `payments`
- Kafka event: `payment.completed`, `payment.failed`

**Checkpoint tag:** `checkpoint-phase-9`

---

## Phase 10 — Production Hardening

Prepare the platform for production deployment.

- Rate limiting on all public endpoints (OTP send, search)
- Structured JSON logging (correlation IDs, request durations)
- Prometheus metrics endpoint
- Database connection pool tuning and query timeouts
- Terraform infrastructure-as-code for cloud deployment
- Load testing (k6) and performance baselines
- Security review: OWASP Top 10 audit, dependency vulnerability scan

**Checkpoint tag:** `checkpoint-phase-10`
