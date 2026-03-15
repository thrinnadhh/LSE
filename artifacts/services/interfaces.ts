export type UUID = string;

export type OrderStatus =
  | "CREATED"
  | "SHOP_ACCEPTED"
  | "PREPARING"
  | "READY_FOR_PICKUP"
  | "DRIVER_ASSIGNED"
  | "OUT_FOR_DELIVERY"
  | "DELIVERED"
  | "CANCELLED";

export interface Location {
  lat: number;
  lng: number;
  timestamp: string;
}

export interface AuthService {
  sendOtp(phone: string): Promise<{ sessionId: UUID }>;
  verifyOtp(input: { phone: string; otp: string; deviceId: string }): Promise<{ accessToken: string; refreshToken: string }>;
  refresh(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }>;
}

export interface SearchService {
  search(input: { q: string; lat: number; lng: number; radiusKm?: number }): Promise<SearchResult>;
  suggest(input: { q: string; lat: number; lng: number }): Promise<string[]>;
}

export interface SearchResult {
  products: Array<{ productId: UUID; shopId: UUID; name: string; price: number; distanceKm: number }>;
  shops: Array<{ shopId: UUID; name: string; rating: number; distanceKm: number }>;
}

export interface InventoryService {
  reserve(input: { orderDraftId: UUID; items: Array<{ inventoryId: UUID; qty: number }>; ttlSeconds: number }): Promise<{ reservationId: UUID }>;
  release(reservationId: UUID): Promise<void>;
  upsertStock(input: { shopId: UUID; productId: UUID; price: number; stockQty: number }): Promise<void>;
}

export interface OrderService {
  checkout(input: {
    userId: UUID;
    addressId: UUID;
    paymentMethod: "COD" | "UPI" | "CARD";
    idempotencyKey: string;
  }): Promise<{ orderId: UUID; status: OrderStatus }>;
  getOrder(orderId: UUID): Promise<{ orderId: UUID; status: OrderStatus }>;
  cancel(orderId: UUID, reason: string): Promise<{ orderId: UUID; status: OrderStatus }>;
}

export interface DispatchService {
  trigger(orderId: UUID): Promise<{ taskId: UUID; assignedDriverId?: UUID }>;
  acceptTask(input: { taskId: UUID; driverId: UUID }): Promise<{ taskId: UUID; status: "ACCEPTED" }>;
}

export interface DeliveryService {
  updateLocation(input: { driverId: UUID; location: Location; speedKmph?: number; heading?: number }): Promise<void>;
  markPickedUp(taskId: UUID): Promise<void>;
  markDelivered(taskId: UUID, proofCode?: string): Promise<void>;
  getTracking(orderId: UUID): Promise<{ orderId: UUID; status: OrderStatus; driverLocation?: Location; etaSeconds?: number }>;
}

export interface ChatService {
  createConversation(input: { customerId: UUID; shopId: UUID; orderId?: UUID }): Promise<{ conversationId: UUID }>;
  sendMessage(input: { conversationId: UUID; senderId: UUID; type: "TEXT" | "SYSTEM" | "PRICE_OFFER" | "IMAGE"; body?: string; metadata?: Record<string, unknown> }): Promise<{ messageId: UUID }>;
  createOffer(input: { conversationId: UUID; inventoryId: UUID; amount: number; expiresAt?: string }): Promise<{ offerId: UUID; status: "PENDING" }>;
  respondOffer(input: { offerId: UUID; responderId: UUID; status: "ACCEPTED" | "REJECTED" }): Promise<{ offerId: UUID; status: "ACCEPTED" | "REJECTED" }>;
}

export interface PaymentService {
  createIntent(input: { orderId: UUID; method: "COD" | "UPI" | "CARD"; idempotencyKey: string }): Promise<{ paymentId: UUID; status: string }>;
  confirm(input: { paymentId: UUID; providerPayload: Record<string, unknown> }): Promise<{ paymentId: UUID; status: string }>;
  refund(input: { orderId: UUID; reason: string }): Promise<{ refundId: UUID; status: string }>;
}

export interface NotificationService {
  send(input: { userId: UUID; templateKey: string; payload: Record<string, unknown>; channels?: Array<"PUSH" | "SMS" | "EMAIL"> }): Promise<{ notificationId: UUID }>;
}
