const { z } = require("zod");
const { ApiError } = require("../../../apps/api-gateway/src/lib/errors");
const { setDriverBusy, setDriverOnline } = require("../../dispatch-service/src/availability-store");

const createDriverSchema = z.object({
  name: z.string().trim().min(1),
  phone: z.string().trim().min(6),
  vehicleType: z.string().trim().min(1),
  vehicleNumber: z.string().trim().min(1),
});

function normalizeRole(role) {
  return String(role || "").toLowerCase();
}

function mapDriver(row) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    vehicleType: row.vehicle_type,
    vehicleNumber: row.vehicle_number,
    isOnline: Boolean(row.is_online),
    lat: row.lat === null || row.lat === undefined ? null : Number(row.lat),
    lng: row.lng === null || row.lng === undefined ? null : Number(row.lng),
  };
}

function requireAdmin(auth) {
  const role = normalizeRole(auth.role);
  if (role !== "admin") {
    throw new ApiError(403, "Only admin can access drivers");
  }
}

async function ensureDriverTables(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS drivers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      name TEXT,
      phone TEXT,
      vehicle_type TEXT,
      vehicle_number TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      is_online BOOLEAN NOT NULL DEFAULT FALSE,
      is_busy BOOLEAN NOT NULL DEFAULT FALSE,
      lat DOUBLE PRECISION,
      lng DOUBLE PRECISION,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await db.query(`ALTER TABLE drivers ADD COLUMN IF NOT EXISTS name TEXT;`);
  await db.query(`ALTER TABLE drivers ADD COLUMN IF NOT EXISTS phone TEXT;`);
  await db.query(`ALTER TABLE drivers ADD COLUMN IF NOT EXISTS vehicle_type TEXT;`);
  await db.query(`ALTER TABLE drivers ADD COLUMN IF NOT EXISTS vehicle_number TEXT;`);
  await db.query(`ALTER TABLE drivers ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;`);
  await db.query(`ALTER TABLE drivers ADD COLUMN IF NOT EXISTS is_online BOOLEAN NOT NULL DEFAULT FALSE;`);
  await db.query(`ALTER TABLE drivers ADD COLUMN IF NOT EXISTS is_busy BOOLEAN NOT NULL DEFAULT FALSE;`);
  await db.query(`ALTER TABLE drivers ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;`);
  await db.query(`ALTER TABLE drivers ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;`);
  await db.query(`ALTER TABLE drivers ALTER COLUMN user_id DROP NOT NULL;`);

  await db.query(`CREATE INDEX IF NOT EXISTS idx_drivers_is_online ON drivers(is_online);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_drivers_is_busy ON drivers(is_busy);`);
}

async function createDriver({ body, auth, db, redis }) {
  requireAdmin(auth);

  const input = createDriverSchema.parse(body);

  const result = await db.query(
    `
      INSERT INTO drivers (name, phone, vehicle_type, vehicle_number, is_active, is_online, is_busy)
      VALUES ($1, $2, $3, $4, TRUE, FALSE, FALSE)
      RETURNING id, name, phone, vehicle_type, vehicle_number, is_online, lat, lng
    `,
    [input.name, input.phone, input.vehicleType, input.vehicleNumber]
  );

  const driver = mapDriver(result.rows[0]);
  await setDriverOnline({ redis, driverId: driver.id, isOnline: false });
  await setDriverBusy({ redis, driverId: driver.id, isBusy: false });

  return driver;
}

async function listDrivers({ auth, db }) {
  requireAdmin(auth);

  const result = await db.query(
    `
      SELECT id, name, phone, vehicle_type, vehicle_number, is_online, lat, lng
      FROM drivers
      ORDER BY created_at DESC, id DESC
    `
  );

  return result.rows.map(mapDriver);
}

module.exports = {
  ensureDriverTables,
  createDriver,
  listDrivers,
};