const { Pool } = require("pg");
const { config } = require("./config");

const pool = new Pool({
  connectionString: config.databaseUrl,
});

async function ensureAuthTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS otp_codes (
      id BIGSERIAL PRIMARY KEY,
      phone VARCHAR(20) NOT NULL,
      otp_hash VARCHAR(128) NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      consumed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_otp_codes_phone_created
    ON otp_codes(phone, created_at DESC);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_sessions (
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
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_user_sessions_user_active
    ON user_sessions(user_id, revoked_at, expires_at);
  `);
}

async function ensureTrackingTables() {
  // User events table for behavior tracking
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      event_type VARCHAR(50) NOT NULL,
      entity_id UUID,
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_user_events_user_id
    ON user_events(user_id, created_at DESC);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_user_events_type
    ON user_events(event_type, created_at DESC);
  `);

  // Notifications table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      body TEXT,
      is_read BOOLEAN DEFAULT FALSE,
      related_entity_id UUID,
      entity_type VARCHAR(50),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
    ON notifications(user_id, is_read, created_at DESC);
  `);
}

async function ensureBaseTables() {
  // 1. users table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      phone VARCHAR(20) NOT NULL UNIQUE,
      role VARCHAR(20) NOT NULL DEFAULT 'CUSTOMER',
      full_name TEXT,
      email TEXT,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // 2. shops table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS shops (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_user_id UUID NOT NULL REFERENCES users(id),
      owner_id UUID REFERENCES users(id),
      name TEXT NOT NULL,
      description TEXT,
      category TEXT,
      phone TEXT,
      status TEXT DEFAULT 'ACTIVE',
      opening_hours JSONB DEFAULT '{}',
      location GEOGRAPHY(Point, 4326),
      city TEXT,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

module.exports = { pool, ensureBaseTables, ensureAuthTables, ensureTrackingTables };
