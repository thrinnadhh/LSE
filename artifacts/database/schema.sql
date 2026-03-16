-- Hyperlocal Marketplace - PostgreSQL Schema (Production Baseline)
-- Date: 2026-03-15

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS postgis;

-- =========================
-- ENUM TYPES
-- =========================

CREATE TYPE user_role AS ENUM ('CUSTOMER', 'SHOP_OWNER', 'DRIVER', 'ADMIN');
CREATE TYPE shop_status AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'REJECTED');
CREATE TYPE inventory_status AS ENUM ('IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK');
CREATE TYPE order_status AS ENUM (
  'CREATED',
  'CONFIRMED',
  'ASSIGNED',
  'PICKED_UP',
  'DELIVERING',
  'DELIVERED',
  'CANCELLED'
);
CREATE TYPE payment_method AS ENUM ('COD', 'UPI', 'CARD');
CREATE TYPE payment_status AS ENUM ('PENDING', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'REFUNDED');
CREATE TYPE delivery_task_status AS ENUM ('PENDING', 'ASSIGNED', 'ACCEPTED', 'PICKED_UP', 'COMPLETED', 'FAILED');
CREATE TYPE negotiation_status AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED');
CREATE TYPE message_type AS ENUM ('TEXT', 'SYSTEM', 'PRICE_OFFER', 'IMAGE');

-- =========================
-- IDENTITY + AUTH
-- =========================

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone VARCHAR(20) UNIQUE NOT NULL,
  email VARCHAR(255),
  full_name VARCHAR(120),
  role user_role NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE otp_codes (
  id BIGSERIAL PRIMARY KEY,
  phone VARCHAR(20) NOT NULL,
  otp_hash VARCHAR(128) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_otp_codes_phone_created ON otp_codes(phone, created_at DESC);

CREATE TABLE user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash VARCHAR(128) NOT NULL UNIQUE,
  device_id VARCHAR(255),
  ip_address VARCHAR(64),
  user_agent TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_sessions_user_active ON user_sessions(user_id, revoked_at, expires_at);

CREATE TABLE user_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform VARCHAR(20) NOT NULL,
  device_id VARCHAR(255) NOT NULL,
  push_token TEXT,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, device_id)
);

CREATE TABLE user_addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label VARCHAR(40) NOT NULL,
  line1 VARCHAR(255) NOT NULL,
  line2 VARCHAR(255),
  city VARCHAR(100) NOT NULL,
  state VARCHAR(100) NOT NULL,
  postal_code VARCHAR(20) NOT NULL,
  location GEOGRAPHY(POINT, 4326) NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_addresses_user_id ON user_addresses(user_id);
CREATE INDEX idx_user_addresses_location ON user_addresses USING GIST(location);

-- =========================
-- SHOPS + CATALOG + INVENTORY
-- =========================

CREATE TABLE shops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users(id),
  name VARCHAR(180) NOT NULL,
  description TEXT,
  category VARCHAR(80),
  phone VARCHAR(20),
  status shop_status NOT NULL DEFAULT 'PENDING',
  opening_hours JSONB NOT NULL DEFAULT '{}'::jsonb,
  rating_avg NUMERIC(3,2) NOT NULL DEFAULT 0,
  rating_count INTEGER NOT NULL DEFAULT 0,
  location GEOGRAPHY(POINT, 4326) NOT NULL,
  city VARCHAR(100) NOT NULL,
  zone_code VARCHAR(32),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_shops_owner ON shops(owner_user_id);
CREATE INDEX idx_shops_status ON shops(status);
CREATE INDEX idx_shops_city_zone ON shops(city, zone_code);
CREATE INDEX idx_shops_location ON shops USING GIST(location);

-- Phase-2 Shop Service compatibility fields
ALTER TABLE shops ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES users(id);
ALTER TABLE shops ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS is_open BOOLEAN DEFAULT TRUE;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS accepting_orders BOOLEAN DEFAULT TRUE;

-- Phase-2 geospatial shop tables
CREATE TABLE IF NOT EXISTS shop_locations (
  shop_id UUID PRIMARY KEY REFERENCES shops(id) ON DELETE CASCADE,
  location GEOGRAPHY(POINT, 4326)
);

CREATE INDEX IF NOT EXISTS idx_shop_locations_geo ON shop_locations USING GIST(location);

CREATE TABLE IF NOT EXISTS shop_hours (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID REFERENCES shops(id) ON DELETE CASCADE,
  day_of_week INT,
  open_time TIME,
  close_time TIME
);

CREATE INDEX IF NOT EXISTS idx_shop_hours_shop_id ON shop_hours(shop_id);

-- Phase-3 products and inventory tables
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID REFERENCES shops(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  price NUMERIC(10,2) NOT NULL,
  image_url TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_shop_id ON products(shop_id);
CREATE INDEX IF NOT EXISTS idx_products_shop_active ON products(shop_id, is_active);

CREATE TABLE IF NOT EXISTS inventory (
  product_id UUID PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  stock_quantity INT DEFAULT 0,
  reserved_quantity INT DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS product_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  image_url TEXT
);

CREATE INDEX IF NOT EXISTS idx_product_images_product_id ON product_images(product_id);

CREATE TABLE global_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL,
  normalized_name VARCHAR(200) NOT NULL,
  category VARCHAR(80),
  brand VARCHAR(120),
  unit VARCHAR(30),
  image_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_global_products_name ON global_products(normalized_name);
CREATE INDEX idx_global_products_category ON global_products(category);

CREATE TABLE shop_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  global_product_id UUID NOT NULL REFERENCES global_products(id),
  sku_code VARCHAR(80),
  display_name VARCHAR(200),
  price NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  discounted_price NUMERIC(10,2) CHECK (discounted_price >= 0),
  stock_qty INTEGER NOT NULL DEFAULT 0 CHECK (stock_qty >= 0),
  low_stock_threshold INTEGER NOT NULL DEFAULT 5 CHECK (low_stock_threshold >= 0),
  status inventory_status NOT NULL DEFAULT 'IN_STOCK',
  available_from TIMESTAMPTZ,
  available_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (shop_id, global_product_id)
);

CREATE INDEX idx_shop_inventory_shop ON shop_inventory(shop_id);
CREATE INDEX idx_shop_inventory_product ON shop_inventory(global_product_id);
CREATE INDEX idx_shop_inventory_status ON shop_inventory(status);

CREATE TABLE promotions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  inventory_id UUID REFERENCES shop_inventory(id) ON DELETE CASCADE,
  title VARCHAR(180) NOT NULL,
  promo_type VARCHAR(40) NOT NULL,
  discount_percent NUMERIC(5,2),
  discount_price NUMERIC(10,2),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_promotions_shop_active ON promotions(shop_id, is_active, starts_at, ends_at);

-- =========================
-- CART + ORDERS
-- =========================

CREATE TABLE carts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  currency VARCHAR(8) NOT NULL DEFAULT 'INR',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id)
);

CREATE TABLE cart_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id UUID NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  shop_id UUID NOT NULL REFERENCES shops(id),
  inventory_id UUID NOT NULL REFERENCES shop_inventory(id),
  qty INTEGER NOT NULL CHECK (qty > 0),
  unit_price NUMERIC(10,2) NOT NULL CHECK (unit_price >= 0),
  negotiated_price NUMERIC(10,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (cart_id, inventory_id)
);

CREATE INDEX idx_cart_items_cart ON cart_items(cart_id);

CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES users(id),
  shop_id UUID NOT NULL REFERENCES shops(id),
  driver_id UUID,
  delivery_address_id UUID NOT NULL REFERENCES user_addresses(id),
  status order_status NOT NULL DEFAULT 'CREATED',
  subtotal NUMERIC(12,2) NOT NULL CHECK (subtotal >= 0),
  delivery_fee NUMERIC(12,2) NOT NULL CHECK (delivery_fee >= 0),
  platform_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  grand_total NUMERIC(12,2) NOT NULL CHECK (grand_total >= 0),
  cancellation_reason TEXT,
  expected_delivery_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_orders_customer_created ON orders(customer_id, created_at DESC);
CREATE INDEX idx_orders_shop_status ON orders(shop_id, status, created_at DESC);
CREATE INDEX idx_orders_status_created ON orders(status, created_at DESC);
CREATE INDEX idx_orders_driver_id ON orders(driver_id);

CREATE TABLE order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  inventory_id UUID NOT NULL REFERENCES shop_inventory(id),
  product_name VARCHAR(200) NOT NULL,
  qty INTEGER NOT NULL CHECK (qty > 0),
  unit_price NUMERIC(10,2) NOT NULL,
  final_price NUMERIC(10,2) NOT NULL,
  line_total NUMERIC(12,2) NOT NULL
);

CREATE INDEX idx_order_items_order ON order_items(order_id);

CREATE TABLE order_status_history (
  id BIGSERIAL PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status order_status,
  to_status order_status NOT NULL,
  changed_by UUID REFERENCES users(id),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_order_history_order_time ON order_status_history(order_id, changed_at DESC);

-- =========================
-- DELIVERY + DRIVER
-- =========================

CREATE TABLE drivers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(120),
  phone VARCHAR(20),
  vehicle_type VARCHAR(20) NOT NULL,
  vehicle_number VARCHAR(30),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_online BOOLEAN NOT NULL DEFAULT FALSE,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  is_available BOOLEAN NOT NULL DEFAULT FALSE,
  zone_code VARCHAR(32),
  rating_avg NUMERIC(3,2) NOT NULL DEFAULT 0,
  rating_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_drivers_zone_online ON drivers(zone_code, is_online, is_available);
CREATE INDEX idx_drivers_is_online ON drivers(is_online);

ALTER TABLE orders
  ADD CONSTRAINT orders_driver_id_fkey
  FOREIGN KEY (driver_id)
  REFERENCES drivers(id);

CREATE TABLE driver_locations (
  id BIGSERIAL PRIMARY KEY,
  driver_id UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  location GEOGRAPHY(POINT, 4326) NOT NULL,
  speed_kmph NUMERIC(6,2),
  heading NUMERIC(6,2),
  recorded_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_driver_locations_driver_time ON driver_locations(driver_id, recorded_at DESC);
CREATE INDEX idx_driver_locations_geo ON driver_locations USING GIST(location);

CREATE TABLE delivery_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  driver_id UUID REFERENCES drivers(id),
  status delivery_task_status NOT NULL DEFAULT 'PENDING',
  assignment_round INTEGER NOT NULL DEFAULT 0,
  pickup_eta_seconds INTEGER,
  drop_eta_seconds INTEGER,
  accepted_at TIMESTAMPTZ,
  picked_up_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_delivery_tasks_status_created ON delivery_tasks(status, created_at DESC);
CREATE INDEX idx_delivery_tasks_driver_status ON delivery_tasks(driver_id, status);

-- =========================
-- PAYMENTS
-- =========================

CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  method payment_method NOT NULL,
  status payment_status NOT NULL DEFAULT 'PENDING',
  amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  gateway VARCHAR(50),
  gateway_order_id VARCHAR(120),
  gateway_payment_id VARCHAR(120),
  gateway_signature VARCHAR(255),
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payments_status_created ON payments(status, created_at DESC);

CREATE TABLE payment_webhook_events (
  id BIGSERIAL PRIMARY KEY,
  payment_id UUID REFERENCES payments(id) ON DELETE CASCADE,
  provider_event_id VARCHAR(120) NOT NULL,
  event_type VARCHAR(80) NOT NULL,
  payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider_event_id)
);

-- =========================
-- CHAT + NEGOTIATION
-- =========================

CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES users(id),
  shop_id UUID NOT NULL REFERENCES shops(id),
  order_id UUID REFERENCES orders(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_at TIMESTAMPTZ,
  UNIQUE (customer_id, shop_id, order_id)
);

CREATE INDEX idx_conversations_customer_time ON conversations(customer_id, last_message_at DESC);
CREATE INDEX idx_conversations_shop_time ON conversations(shop_id, last_message_at DESC);

CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_user_id UUID NOT NULL REFERENCES users(id),
  type message_type NOT NULL DEFAULT 'TEXT',
  body TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  edited_at TIMESTAMPTZ
);

CREATE INDEX idx_messages_conversation_time ON messages(conversation_id, sent_at DESC);

CREATE TABLE negotiation_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  inventory_id UUID NOT NULL REFERENCES shop_inventory(id),
  offered_by UUID NOT NULL REFERENCES users(id),
  amount NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
  status negotiation_status NOT NULL DEFAULT 'PENDING',
  expires_at TIMESTAMPTZ,
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_negotiation_conversation_status ON negotiation_offers(conversation_id, status, created_at DESC);

-- =========================
-- NOTIFICATIONS + ADMIN
-- =========================

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel VARCHAR(20) NOT NULL,
  template_key VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL,
  status VARCHAR(20) NOT NULL,
  provider_message_id VARCHAR(120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ
);

CREATE INDEX idx_notifications_user_time ON notifications(user_id, created_at DESC);

CREATE TABLE moderation_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_user_id UUID REFERENCES users(id),
  conversation_id UUID REFERENCES conversations(id),
  message_id UUID REFERENCES messages(id),
  reason TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
  assigned_admin_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX idx_reports_status_created ON moderation_reports(status, created_at DESC);

-- =========================
-- EVENTS OUTBOX
-- =========================

CREATE TABLE outbox_events (
  id BIGSERIAL PRIMARY KEY,
  aggregate_type VARCHAR(80) NOT NULL,
  aggregate_id UUID NOT NULL,
  event_type VARCHAR(120) NOT NULL,
  payload JSONB NOT NULL,
  dedupe_key VARCHAR(120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ,
  UNIQUE (event_type, dedupe_key)
);

CREATE INDEX idx_outbox_unpublished ON outbox_events(published_at) WHERE published_at IS NULL;

-- =========================
-- PARTITIONING GUIDANCE (OPTIONAL)
-- =========================
-- For high scale, partition these by month and city/zone:
-- 1) orders
-- 2) order_status_history
-- 3) driver_locations
-- 4) notifications
