# Hyperlocal Marketplace Production Architecture (1M+ Users)

Date: 15 March 2026

This document defines a complete production-ready architecture for a hyperlocal marketplace and delivery platform similar to Swiggy/Blinkit, with local shop discovery, price comparison, and negotiation.

Assumed scale and SLO targets:
- 1M+ registered users
- Thousands of shops and drivers
- Peak concurrent users: 8k-20k
- Target SLO: 99.95% for core order APIs, 99.9% for non-critical services

---

## 1) High Level Architecture

### Core architecture style
- Domain-oriented services behind an API Gateway
- Event-driven backbone for high-churn workflows (orders, inventory, dispatch, chat, notifications)
- Real-time channels for tracking and messaging
- Multi-AZ deployment for high availability

### Frontend applications
- Customer mobile app (iOS/Android)
- Shop owner app and web dashboard
- Driver app
- Admin web dashboard

### Edge and traffic layer
- DNS with health checks and latency-based routing
- CDN for static assets and cacheable API responses
- WAF + DDoS protection
- L7 load balancer in front of gateway/realtime

### Backend platform layer
- API Gateway / BFF
- Auth, User, Shop, Product, Inventory, Search, Order, Dispatch, Delivery, Payment, Chat, Notification, Admin services
- Realtime Gateway for WebSocket communication
- Async workers for indexing, notifications, reconciliation, moderation

### Data and infra layer
- PostgreSQL (primary transactional data)
- Redis (cache, sessions, geo short-term state, rate limiting)
- OpenSearch/Elasticsearch (search + geo filtering)
- Kafka/PubSub (event streaming)
- Object storage (images, files, exports)
- Data warehouse/lakehouse (analytics)

### Request flow (representative)
1. Client request goes through CDN/WAF/load balancer to API Gateway.
2. Gateway validates auth and routes to target service.
3. Service checks Redis cache first, falls back to DB/search.
4. Mutations write to PostgreSQL and publish domain events via outbox.
5. Downstream consumers handle indexing, notifications, analytics asynchronously.
6. Real-time updates flow through WebSocket gateway and push/SMS fallbacks.

---

## 2) Backend Architecture

### Service breakdown
- API Gateway: auth checks, routing, rate limiting, request shaping, API versioning
- Auth Service: OTP login, token issuance/refresh, device sessions
- User Service: profile, addresses, preferences
- Shop Service: shop onboarding, verification state, timings, metadata
- Product Service: global catalog, categories, brand normalization
- Inventory Service: shop-specific price/stock/availability, reservation and release
- Search Service: query APIs, ranking, autocomplete, indexing orchestration
- Order Service: cart checkout orchestration, order state machine, cancellation rules
- Delivery Service: task states, ETA updates, delivery lifecycle
- Dispatch Service: nearest-driver selection, assignment rounds, zone balancing
- Payment Service: payment initiation/capture/refund, webhook validation, reconciliation
- Chat Service: conversations, messages, negotiation offers, moderation hooks
- Notification Service: push/SMS/email fan-out, template rendering, retry policy
- Admin Service: approval flows, dispute handling, moderation tools, analytics views

### Synchronous vs event-driven
Synchronous (user-facing, low-latency):
- OTP validation and login
- Search query
- Cart operations
- Checkout initiation
- Driver accept/reject
- Chat send/receive ACK

Event-driven (fan-out, resilience, eventual consistency):
- Order transitions and history
- Inventory reserve/release updates
- Driver assignment attempts and retries
- Notification sends and retries
- Analytics ingestion
- Search reindexing after catalog/inventory changes
- Fraud and moderation pipelines

### Reliability patterns
- Outbox pattern on write services
- Idempotency keys for order/payment APIs
- Saga orchestration for checkout (reserve inventory, create order, payment confirmation, compensation)
- DLQs and replay tooling for failed event consumption

---

## 3) Infrastructure Design

Reference deployment on managed cloud:
- Kubernetes for service orchestration
- Managed PostgreSQL (Multi-AZ)
- Managed Redis cluster
- Managed OpenSearch cluster
- Managed Kafka/PubSub
- Object storage with lifecycle policies

### Core infra components
- Load balancers: public for API and realtime ingress; internal for service mesh traffic
- Container orchestration: Kubernetes (node pools for APIs, workers, realtime)
- Autoscaling: HPA/KEDA based on CPU, memory, RPS, queue lag, websocket connections
- Database clusters: primary + read replicas + failover automation
- CDN: edge caching for static assets and selective API cache
- Object storage: media and bulk upload files

### Handling spikes
- Cache hot feeds (nearby shops, deals)
- Queue non-critical work (emails/indexing/analytics)
- Burst autoscaling for API and workers
- Graceful degradation (disable non-critical widgets under pressure)

### Handling failures
- Circuit breakers, retries with jitter, timeouts
- Multi-AZ spread and anti-affinity for pods
- Read replica fallback for heavy reads
- Store-and-forward for notifications and tracking events

### Handling scale events
- Horizontal scale stateless services
- Partition event topics by city/zone
- Split noisy workloads into dedicated worker pools

---

## 4) Database Design

### Primary transactional database
PostgreSQL schema groups:
- Identity: users, sessions, roles
- Commerce: shops, products_global, shop_inventory
- Cart/Orders: carts, cart_items, orders, order_items, order_status_history
- Delivery: drivers, driver_tasks, deliveries
- Payments: payment_intents, transactions, refunds, reconciliation
- Chat: conversations, messages, offers, reports

### Search index
OpenSearch indexes:
- shops_index
- products_index
- inventory_index
- offers_index

Each document includes geo fields, availability signals, and ranking features.

### Caching
Redis use cases:
- sessions/token metadata
- rate limit counters
- hot search and nearby results
- live order and driver snapshots
- ephemeral presence states

### Geospatial indexing
- Redis GEO for nearest driver lookup
- OpenSearch geo_point for search/discovery
- Optional PostGIS for advanced geospatial analytics

### Analytics storage
- CDC from PostgreSQL to event stream
- Stream to warehouse for BI, cohort analysis, and forecasting

### Supporting 1M users and high read load
- Read replicas
- Table partitioning by city/date for large tables
- Query optimization and selective denormalization
- Aggressive cache strategy for high-read APIs

### Real-time driver updates
- Latest location in Redis GEO + timestamp
- Historical sampled track in warehouse/object storage for audit and model training

---

## 5) Geospatial System

### Nearby shop discovery
1. Obtain user coordinates.
2. Compute candidate cells using H3/Geohash.
3. Query OpenSearch with geo radius and filters (open now, in stock).
4. Rank by distance, price, rating, and reliability.

### Nearest driver assignment
1. Query Redis GEO for available drivers within initial radius.
2. Filter by status, zone, vehicle type.
3. Score by ETA + acceptance probability + fairness.
4. Expand radius progressively if not accepted.

### Distance and ETA calculations
- Fast estimate: Haversine for filtering/ranking
- Accurate routing/ETA: map provider distance matrix and traffic-aware routes

### Storage of geospatial index
- Redis for rapidly changing entities (drivers)
- OpenSearch for discovery queries on shops/products
- PostgreSQL source-of-truth for persistent location fields

---

## 6) Real-Time Systems

### Live order tracking
- Driver app sends location every 5-10 seconds
- Ingestion service publishes to stream and updates Redis
- Tracking gateway pushes updates to customer app over WebSocket

### Driver location updates
- gRPC or HTTP/2 ingestion endpoint with auth + device checks
- Drop stale/out-of-order points using timestamp checks

### Customer-shop chat and negotiation
- WebSocket channel for low-latency messaging
- Durable message persistence in PostgreSQL
- Offer messages modeled with explicit state transitions (pending, accepted, rejected, expired)

### Delivery notifications
- In-app realtime notification first
- Push notification fallback
- SMS fallback for critical transitions

### Recommended technologies
- WebSocket gateway (Socket.IO or native ws)
- Redis pub/sub or Kafka for fan-out backbone
- Push provider (FCM/APNs)

---

## 7) Delivery Dispatch System

### Assignment flow
1. Order reaches ready-for-pickup state.
2. Dispatch service retrieves nearest eligible drivers.
3. Send offer to top candidates in rounds with short TTL.
4. On acceptance, lock assignment and update order state.

### Dispatch scoring
Candidate score can use:
- ETA to shop
- Driver acceptance rate
- Current workload
- Zone balancing/fairness
- Batching potential

### Delivery batching
- Batch only when route overlap is significant and SLA risk is acceptable
- Use constraints (max detour, max extra delay)

### Delivery zones
- City partitioned into zones (H3 clusters)
- Drivers can have home/preferred zones
- Spillover rules during shortages

### Scalability
- Partition dispatch workers by city/zone
- Stateless workers; state in Redis/Kafka
- Autoscale using queue lag and assignment latency

---

## 8) Search Architecture

### Product and shop search
- Unified query endpoint returns blended results: products, shops, offers
- Autocomplete/suggestions for frequent terms and local synonyms

### Location filtering
- Geo-radius filters (e.g., 5-10 km)
- Optional time filters (open now, delivery window)

### Ranking logic
Weighted score includes:
- text relevance
- distance
- price competitiveness
- availability confidence
- rating/reliability
- promotion boost with caps

### Index update pipeline
- Catalog/inventory events -> stream -> indexing workers -> OpenSearch
- Near-real-time update target: under 5 seconds

### Scaling to millions of products
- Shard by geography/category
- Keep mappings strict and compact
- Reindex strategy with aliases for zero-downtime schema changes

---

## 9) Security Architecture

### Authentication
- OTP-based auth with anti-abuse checks
- Short-lived access token + rotating refresh token
- Device/session management and revocation

### Authorization
- RBAC by role (customer, shop, driver, admin)
- Fine-grained permissions for admin and moderation actions

### API security
- WAF, mTLS internally where feasible
- Endpoint-level rate limiting and quotas
- Payload validation and schema enforcement
- Idempotency for critical write APIs

### Data protection
- TLS in transit
- Encryption at rest for DB and object storage
- PII masking in logs and analytics exports
- Audit logging for sensitive actions

### Payment security
- Use PCI-compliant payment provider tokenization
- Verify webhook signatures
- Reconciliation and fraud anomaly checks

---

## 10) External Integrations

1. Maps Provider (Google Maps / Mapbox)
- Purpose: geocoding, routing, distance matrix, map rendering
- API keys: MAP_API_KEY, MAP_API_SECRET
- Manual setup: billing account, API restrictions, domain/app signature allowlists

2. Payment Gateway (Razorpay / Stripe / PayU)
- Purpose: UPI/card payments, refunds, settlements
- API keys: PAYMENT_KEY_ID, PAYMENT_KEY_SECRET, PAYMENT_WEBHOOK_SECRET
- Manual setup: merchant onboarding, KYC, webhook registration

3. SMS Provider (Twilio / MSG91)
- Purpose: OTP and fallback order/chat alerts
- API keys: SMS_API_KEY, SMS_SENDER_ID
- Manual setup: approved templates and regional compliance setup

4. Push Notification Providers (FCM/APNs)
- Purpose: real-time push notifications
- API keys: FCM_SERVER_KEY, APNS credentials
- Manual setup: app registration, key/certificate upload

5. Email Provider (SES / SendGrid)
- Purpose: transactional mail and reports
- API keys: EMAIL_API_KEY
- Manual setup: domain verification, SPF/DKIM

6. KYC/Verification Provider (optional)
- Purpose: shop/driver verification and fraud reduction
- API keys: KYC_API_KEY
- Manual setup: legal agreements, callback endpoint setup

---

## 11) Secrets and Environment Variables

### Core environment variables
- APP_ENV
- API_BASE_URL
- JWT_SECRET
- JWT_REFRESH_SECRET
- OTP_SIGNING_SECRET
- DATABASE_URL
- DATABASE_REPLICA_URL
- REDIS_URL
- SEARCH_CLUSTER_URL
- KAFKA_BROKERS
- KAFKA_USERNAME
- KAFKA_PASSWORD
- OBJECT_STORAGE_BUCKET
- OBJECT_STORAGE_REGION
- CDN_BASE_URL
- MAP_API_KEY
- PAYMENT_KEY_ID
- PAYMENT_KEY_SECRET
- PAYMENT_WEBHOOK_SECRET
- SMS_API_KEY
- PUSH_FCM_KEY
- APNS_KEY_ID
- APNS_TEAM_ID
- APNS_PRIVATE_KEY
- EMAIL_API_KEY
- SENTRY_DSN
- OTEL_EXPORTER_OTLP_ENDPOINT
- FEATURE_FLAG_SDK_KEY

### Secure storage strategy
- Store secrets in cloud secret manager or HashiCorp Vault
- Encrypt using KMS-managed keys
- Inject secrets at runtime; never commit to repository
- Rotate secrets regularly and after incidents

---

## 12) Manual Setup Steps

1. Create cloud accounts and separate environments (dev/staging/prod).
2. Configure VPC/networking with private subnets for data services.
3. Provision Kubernetes cluster and node pools.
4. Provision PostgreSQL, Redis, OpenSearch, and stream platform.
5. Configure object storage buckets and lifecycle retention.
6. Set up DNS, TLS certificates, CDN, and WAF.
7. Configure mobile push providers (FCM/APNs).
8. Configure SMS provider templates and sender IDs.
9. Complete payment gateway onboarding and webhook setup.
10. Configure map APIs with quotas and restrictions.
11. Configure observability stack (logs, metrics, traces, alerts).
12. Configure CI/CD with secure workload identity and no static cloud keys.
13. Seed initial categories, city zones, and admin accounts.
14. Run load tests and failover drills before launch.

---

## 13) MCP (Model Context Protocol) Integrations

Recommended MCP integrations:

1. Database MCP
- Helps inspect schema, generate migrations safely, and analyze query plans.

2. Cloud MCP
- Helps inspect infrastructure states, IAM, and environment drift.

3. Search MCP
- Helps validate index mappings, analyzers, and relevance tuning.

4. Queue/Stream MCP
- Helps inspect topic lag, consumer errors, and replay status.

5. Monitoring MCP
- Helps query metrics/traces quickly during incidents and deployments.

6. Security MCP
- Helps detect leaked secrets, insecure IAM policies, and compliance gaps.

7. CI/CD MCP
- Helps diagnose pipeline failures and release metadata quickly.

---

## 14) Monitoring and Observability

### Logging
- Structured JSON logs with correlation IDs
- Centralized log aggregation with retention policies

### Metrics
- Service RED metrics (Rate, Errors, Duration)
- Infrastructure metrics (CPU, memory, network, disk)
- Business metrics (order conversion, cancellation, ETA SLA)

### Tracing
- End-to-end distributed tracing with OpenTelemetry
- Trace critical paths: auth -> search -> checkout -> payment -> dispatch

### Alerts and incident response
- SLO burn-rate alerts
- Queue lag and consumer health alerts
- Payment webhook failure alerts
- Dispatch latency and tracking ingestion alerts

### Error tracking and APM
- Client and server error tracking
- Release correlation and regression detection

---

## 15) CI/CD Pipeline

### Build and test
1. Lint, unit tests, static checks
2. Contract tests for service APIs/events
3. Integration tests in ephemeral environment
4. Security scans and SBOM generation

### Containerization
- Build immutable images
- Tag by commit SHA + semantic version

### Deployment strategy
- GitOps-based deployments
- Canary rollout with automated health checks
- Progressive traffic increase if SLOs remain healthy

### Rollback strategy
- Automatic rollback on SLO threshold breach
- Manual rollback option to previous stable version
- Feature flags for instant kill-switches

---

## 16) Repository Structure

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
  data/
    migrations/
    seeds/
    schemas/
  infra/
    terraform/
      envs/dev/
      envs/staging/
      envs/prod/
    kubernetes/
      base/
      overlays/
    helm/
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

---

## 17) Scaling Strategy (MVP -> 100k -> 1M)

### MVP (single city)
- Modular backend with clear domain boundaries
- PostgreSQL + Redis + OpenSearch
- Basic event queue and simple dispatch rounds

### At 100k users
- Split high-load components (search/chat/dispatch/notifications)
- Introduce robust event backbone and outbox pattern
- Add read replicas and stronger caching

### At 1M users
- Partition data and services by city/zone
- Multi-region readiness (active-passive initially)
- Dedicated realtime cluster and advanced dispatch optimization
- Strong SRE practices: game days, capacity planning, chaos drills

---

## 18) Cost Optimization

### Map API cost
- Cache geocoding and route responses
- Use Haversine for coarse filtering before paid distance matrix calls
- Limit expensive calls to checkout/dispatch critical paths

### Database cost
- Right-size DB and replicas
- Partition/archive cold data
- Continuous query tuning and index governance

### Compute cost
- Autoscaling with proper requests/limits
- Spot/preemptible workers for non-critical async jobs
- Bin-pack workloads by profile (API vs worker vs realtime)

### Storage cost
- Lifecycle policies (hot -> warm -> cold)
- Compress logs and prune low-value telemetry

### Search and queue cost
- Tier old indexes and reduce retention for stale offer indexes
- Tune topic retention and compaction based on business need

---

## 19) Additional Important Features and Workflows (Missed/Recommended)

### Reliability and correctness
- Inventory reservation with TTL during checkout
- Exactly-once style payment reconciliation pipeline
- Idempotent order creation and webhook handling

### Customer trust and quality
- Proof of delivery (OTP or photo)
- Returns/refund workflow with SLA tracking
- Service recovery credits for delayed deliveries

### Fraud and abuse prevention
- Promo abuse checks (device/payment/address graph)
- Fake order and collusion detection
- Chat spam filtering and escalation queues

### Operational workflows
- Driver no-show automatic reassignment
- Partial fulfillment and substitution flow
- Incident runbooks with defined RTO/RPO

### Compliance and governance
- Consent management and data deletion workflows
- Tax invoicing and settlement reconciliation
- Admin audit trails and role-based approvals

### Growth and retention
- Referral/loyalty system
- Membership plans for delivery fee savings
- Personalized recommendations and smart deal targeting

---

## Suggested Next Artifacts for Implementation

1. Capacity plan spreadsheet (QPS, pods, partitions, memory sizing by city)
2. Event contract catalog (topic names, schemas, retry/DLQ rules)
3. API and state machine specs for orders, dispatch, and negotiation flows
4. 6-month execution roadmap with team topology and milestone gates

---

## Generated Implementation Artifacts

The following implementation artifacts were generated in this workspace:

1. Database schema
- artifacts/database/schema.sql

2. API contracts
- artifacts/api/openapi.yaml

3. Backend service interfaces
- artifacts/services/backend-service-interfaces.md
- artifacts/services/interfaces.ts

4. Repository folder structure
- artifacts/repository/repository-structure.md
- repo/ (scaffolded directories)

5. Infrastructure Terraform and Docker setup
- artifacts/infra/terraform/providers.tf
- artifacts/infra/terraform/variables.tf
- artifacts/infra/terraform/main.tf
- artifacts/infra/terraform/outputs.tf
- artifacts/infra/terraform/modules/network/main.tf
- artifacts/infra/terraform/modules/eks/main.tf
- artifacts/infra/terraform/modules/rds/main.tf
- artifacts/infra/terraform/modules/redis/main.tf
- artifacts/infra/terraform/modules/opensearch/main.tf
- artifacts/infra/terraform/modules/kafka/main.tf
- artifacts/infra/terraform/modules/object-storage/main.tf
- artifacts/infra/docker/docker-compose.dev.yml
- artifacts/infra/docker/Dockerfile.backend
- artifacts/infra/docker/.env.example
- artifacts/infra/docker/README.md
