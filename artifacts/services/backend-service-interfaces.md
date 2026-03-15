# Backend Service Interfaces

Date: 15 March 2026

This file defines service interfaces for modular backend implementation. Interfaces are grouped by domain and include sync APIs plus async events.

## Conventions
- Transport: HTTP/JSON for public APIs, gRPC for internal low-latency calls
- Async messaging: Kafka topics with schema versioning
- Idempotency required for payment and order creation methods

## 1. Auth Service

Synchronous methods:
- SendOtp(phone, channel) -> OtpSession
- VerifyOtp(phone, otp, deviceId) -> AuthTokenBundle
- RefreshToken(refreshToken) -> AuthTokenBundle
- RevokeSession(sessionId) -> Ack

Events published:
- auth.user.logged_in.v1
- auth.user.logged_out.v1

## 2. User Service

Synchronous methods:
- GetUser(userId) -> UserProfile
- UpdateUser(userId, patch) -> UserProfile
- ListAddresses(userId) -> Address[]
- UpsertAddress(userId, address) -> Address

Events published:
- user.profile.updated.v1
- user.address.updated.v1

## 3. Shop Service

Synchronous methods:
- RegisterShop(ownerId, payload) -> Shop
- UpdateShop(shopId, patch) -> Shop
- GetShop(shopId) -> Shop
- ListNearbyShops(lat, lng, radiusKm, filters) -> Shop[]

Events published:
- shop.created.v1
- shop.verified.v1
- shop.status.changed.v1

## 4. Product Service

Synchronous methods:
- CreateGlobalProduct(payload) -> Product
- UpdateGlobalProduct(productId, patch) -> Product
- ListProducts(filter, page) -> Product[]

Events published:
- product.global.created.v1
- product.global.updated.v1

## 5. Inventory Service

Synchronous methods:
- UpsertInventory(shopId, productId, payload) -> InventoryItem
- GetInventory(shopId, filter) -> InventoryItem[]
- ReserveInventory(orderDraftId, items, ttlSeconds) -> Reservation
- ReleaseReservation(reservationId) -> Ack

Events published:
- inventory.changed.v1
- inventory.low_stock.v1
- inventory.reservation.expired.v1

## 6. Search Service

Synchronous methods:
- Search(query, location, filters, page) -> SearchResult
- Suggest(prefix, location) -> Suggestion[]

Async consumers:
- Consumes product/global and inventory updates for indexing

Events published:
- search.indexed.v1

## 7. Order Service

Synchronous methods:
- CreateOrderFromCart(userId, checkoutRequest, idempotencyKey) -> Order
- GetOrder(orderId) -> Order
- CancelOrder(orderId, reason) -> Order
- TransitionOrderStatus(orderId, nextStatus, actor) -> Order

Events published:
- order.created.v1
- order.status.changed.v1
- order.cancelled.v1

## 8. Dispatch Service

Synchronous methods:
- TriggerDispatch(orderId) -> DispatchAttempt
- AcceptTask(taskId, driverId) -> DeliveryTask
- RejectTask(taskId, driverId) -> DeliveryTask

Async consumers:
- Consumes order.ready_for_pickup.v1
- Consumes driver.location.updated.v1

Events published:
- dispatch.attempted.v1
- dispatch.assigned.v1
- dispatch.failed.v1

## 9. Delivery Service

Synchronous methods:
- UpdateDriverAvailability(driverId, status) -> DriverStatus
- UpdateDriverLocation(driverId, location) -> Ack
- MarkPickedUp(taskId) -> DeliveryTask
- MarkDelivered(taskId, proof) -> DeliveryTask
- GetTracking(orderId) -> TrackingSnapshot

Events published:
- driver.location.updated.v1
- delivery.picked_up.v1
- delivery.completed.v1

## 10. Payment Service

Synchronous methods:
- CreatePaymentIntent(orderId, method, idempotencyKey) -> PaymentIntent
- ConfirmPayment(paymentIntentId, payload) -> Payment
- RefundPayment(orderId, reason) -> Refund
- HandleGatewayWebhook(provider, payload, signature) -> Ack

Events published:
- payment.authorized.v1
- payment.captured.v1
- payment.failed.v1
- payment.refunded.v1

## 11. Chat Service

Synchronous methods:
- CreateConversation(customerId, shopId, orderId?) -> Conversation
- SendMessage(conversationId, senderId, message) -> Message
- ListMessages(conversationId, cursor) -> Message[]
- CreateOffer(conversationId, inventoryId, amount, expiresAt) -> Offer
- RespondOffer(offerId, responderId, status) -> Offer

Events published:
- chat.message.created.v1
- chat.offer.created.v1
- chat.offer.responded.v1
- chat.report.created.v1

## 12. Notification Service

Synchronous methods:
- SendNotification(userId, templateKey, payload, channelPreference) -> NotificationAck

Async consumers:
- Consumes order/chat/payment/dispatch events

Events published:
- notification.sent.v1
- notification.failed.v1

## 13. Admin Service

Synchronous methods:
- ApproveShop(shopId, adminId) -> Shop
- SuspendUser(userId, reason) -> User
- ListReports(filter) -> ModerationReport[]
- ResolveReport(reportId, action) -> ModerationReport
- GetOperationalMetrics(range) -> DashboardMetrics

Events published:
- admin.shop.approved.v1
- admin.user.suspended.v1
- admin.report.resolved.v1

## Shared Event Envelope

All events should follow:
- eventId: UUID
- eventType: string
- eventVersion: integer
- emittedAt: RFC3339 timestamp
- producer: service name
- correlationId: request/order correlation key
- payload: typed event body

## Critical Interface SLAs
- Search p95: <= 250 ms
- Cart APIs p95: <= 150 ms
- Checkout API p95: <= 400 ms (excluding external payment authorization)
- Chat message ACK p95: <= 120 ms
- Tracking update fanout: <= 2 seconds end-to-end
