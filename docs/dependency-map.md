# Dependency Map

This document tracks the explicit dependencies and communication methods between the various microservices in the system.

## Ingress / Gateway Layer

api-gateway → auth-service (API/gRPC)
api-gateway → chat-service (API/WS)
api-gateway → dispatch-service (API)
api-gateway → driver-service (API)
api-gateway → home-service (API)
api-gateway → order-service (API)
api-gateway → product-service (API)
api-gateway → search-service (API)
api-gateway → shop-service (API)
api-gateway → tracking-service (API/WS)
api-gateway → user-service (API)

## Core Microservices Interactions

### Order Service
order-service → shop-service (API)
order-service → product-service (API)
order-service → dispatch-service (Kafka - `order.created`, `order.ready`)

### Dispatch Service
dispatch-service → order-service (Kafka - `order.status_changed`)
dispatch-service → driver-service (API / Kafka - `driver.assigned`)

### Driver Service
driver-service → tracking-service (Kafka - `driver.location.updated`, `driver.online`)

### Home Service
home-service → search-service (API)
home-service → shop-service (API)
home-service → product-service (API)

### Tracking Service
tracking-service → order-service (Kafka - listen to order updates)
tracking-service → driver-service (Kafka - listen to loc updates)

### Chat Service
chat-service → user-service (API - verify identities)
chat-service → order-service (API - link chat to order context)

### Search Service
search-service → shop-service (Kafka/CDC - ingest catalog)
search-service → product-service (Kafka/CDC - ingest products)

## Third-Party / Database (Logical)

*All services -> their respective isolated databases (No shared DB).*
*All services -> OpenTelemetry/Jaeger (gRPC/HTTP)*
