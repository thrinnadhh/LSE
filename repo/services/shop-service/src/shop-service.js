const { z } = require("zod");
const { ApiError } = require("../../../apps/api-gateway/src/lib/errors");

const createShopSchema = z.object({
  name: z.string().trim().min(2).max(180),
  description: z.string().trim().max(2000).optional(),
  category: z.string().trim().max(80).optional(),
  phone: z.string().trim().regex(/^\+?[0-9]{10,15}$/),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

const updateShopSchema = z
  .object({
    name: z.string().trim().min(2).max(180).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    category: z.string().trim().max(80).nullable().optional(),
    phone: z.string().trim().regex(/^\+?[0-9]{10,15}$/).optional(),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => (value.lat === undefined) === (value.lng === undefined), {
    message: "lat and lng must be provided together",
  });

const nearbyQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radius: z.coerce.number().positive().max(50000),
});

async function ensureShopTables(db) {
  await db.query(`ALTER TABLE shops ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES users(id);`);
  await db.query(`ALTER TABLE shops ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;`);
  await db.query(`ALTER TABLE shops ADD COLUMN IF NOT EXISTS is_open BOOLEAN DEFAULT TRUE;`);
  await db.query(`ALTER TABLE shops ADD COLUMN IF NOT EXISTS accepting_orders BOOLEAN DEFAULT TRUE;`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS shop_locations (
      shop_id UUID PRIMARY KEY REFERENCES shops(id) ON DELETE CASCADE,
      location GEOGRAPHY(POINT, 4326)
    );
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_shop_locations_geo
    ON shop_locations USING GIST(location);
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS shop_hours (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      shop_id UUID REFERENCES shops(id) ON DELETE CASCADE,
      day_of_week INT,
      open_time TIME,
      close_time TIME
    );
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_shop_hours_shop_id
    ON shop_hours(shop_id);
  `);
}

function normalizeRole(role) {
  return String(role || "").toLowerCase();
}

function mapShop(row) {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    description: row.description,
    category: row.category,
    phone: row.phone,
    isActive: row.is_active,
    isOpen: row.is_open !== null && row.is_open !== undefined ? Boolean(row.is_open) : true,
    acceptingOrders: row.accepting_orders !== null && row.accepting_orders !== undefined ? Boolean(row.accepting_orders) : true,
    lat: row.lat !== null ? Number(row.lat) : null,
    lng: row.lng !== null ? Number(row.lng) : null,
    createdAt: row.created_at,
    distance: row.distance_meters !== null && row.distance_meters !== undefined ? Number(row.distance_meters) : undefined,
  };
}

async function createShop({ body, auth, db }) {
  if (normalizeRole(auth.role) !== "shop_owner") {
    throw new ApiError(403, "Only shop_owner can create shops");
  }

  const input = createShopSchema.parse(body);

  const result = await db.query(
    `
      INSERT INTO shops (
        owner_user_id,
        owner_id,
        name,
        description,
        category,
        phone,
        status,
        opening_hours,
        location,
        city,
        is_active
      )
      VALUES (
        $1,
        $1,
        $2,
        $3,
        $4,
        $5,
        'ACTIVE',
        '{}'::jsonb,
        ST_SetSRID(ST_Point($7, $6), 4326)::geography,
        'unknown',
        TRUE
      )
      RETURNING id, owner_id, name, description, category, phone, is_active, created_at
    `,
    [auth.sub, input.name, input.description || null, input.category || null, input.phone, input.lat, input.lng]
  );

  const shop = result.rows[0];

  await db.query(
    `
      INSERT INTO shop_locations (shop_id, location)
      VALUES ($1, ST_SetSRID(ST_Point($3, $2), 4326)::geography)
      ON CONFLICT (shop_id)
      DO UPDATE SET location = EXCLUDED.location
    `,
    [shop.id, input.lat, input.lng]
  );

  return {
    ...mapShop({ ...shop, lat: input.lat, lng: input.lng }),
  };
}

async function getShopById({ id, db }) {
  const result = await db.query(
    `
      SELECT
        s.id,
        COALESCE(s.owner_id, s.owner_user_id) AS owner_id,
        s.name,
        s.description,
        s.category,
        s.phone,
        COALESCE(s.is_active, TRUE) AS is_active,
        s.is_open,
        s.accepting_orders,
        s.created_at,
        ST_Y(COALESCE(sl.location, s.location)::geometry) AS lat,
        ST_X(COALESCE(sl.location, s.location)::geometry) AS lng
      FROM shops s
      LEFT JOIN shop_locations sl ON s.id = sl.shop_id
      WHERE s.id = $1
      LIMIT 1
    `,
    [id]
  );

  if (result.rowCount === 0) {
    throw new ApiError(404, "Shop not found");
  }

  return mapShop(result.rows[0]);
}

async function updateShop({ id, body, auth, db }) {
  if (normalizeRole(auth.role) !== "shop_owner") {
    throw new ApiError(403, "Only shop_owner can update shops");
  }

  const input = updateShopSchema.parse(body);

  const ownershipCheck = await db.query(
    `
      SELECT id
      FROM shops
      WHERE id = $1
        AND (owner_user_id = $2 OR owner_id = $2)
      LIMIT 1
    `,
    [id, auth.sub]
  );

  if (ownershipCheck.rowCount === 0) {
    throw new ApiError(403, "You can only update your own shop");
  }

  const updates = [];
  const values = [];
  let idx = 1;

  if (input.name !== undefined) {
    updates.push(`name = $${idx++}`);
    values.push(input.name);
  }
  if (input.description !== undefined) {
    updates.push(`description = $${idx++}`);
    values.push(input.description);
  }
  if (input.category !== undefined) {
    updates.push(`category = $${idx++}`);
    values.push(input.category);
  }
  if (input.phone !== undefined) {
    updates.push(`phone = $${idx++}`);
    values.push(input.phone);
  }
  if (input.isActive !== undefined) {
    updates.push(`is_active = $${idx++}`);
    values.push(input.isActive);
  }
  if (input.lat !== undefined && input.lng !== undefined) {
    updates.push(`location = ST_SetSRID(ST_Point($${idx + 1}, $${idx}), 4326)::geography`);
    values.push(input.lat, input.lng);
    idx += 2;
  }

  if (updates.length === 0) {
    throw new ApiError(400, "No updatable fields provided");
  }

  values.push(id);

  await db.query(
    `
      UPDATE shops
      SET ${updates.join(", ")}, updated_at = NOW()
      WHERE id = $${idx}
    `,
    values
  );

  if (input.lat !== undefined && input.lng !== undefined) {
    await db.query(
      `
        INSERT INTO shop_locations (shop_id, location)
        VALUES ($1, ST_SetSRID(ST_Point($3, $2), 4326)::geography)
        ON CONFLICT (shop_id)
        DO UPDATE SET location = EXCLUDED.location
      `,
      [id, input.lat, input.lng]
    );
  }

  return getShopById({ id, db });
}

async function findNearbyShops({ query, db }) {
  const input = nearbyQuerySchema.parse(query);

  const result = await db.query(
    `
      SELECT
        s.id,
        COALESCE(s.owner_id, s.owner_user_id) AS owner_id,
        s.name,
        s.description,
        s.category,
        s.phone,
        COALESCE(s.is_active, TRUE) AS is_active,
        s.is_open,
        s.accepting_orders,
        s.created_at,
        ST_Y(l.location::geometry) AS lat,
        ST_X(l.location::geometry) AS lng,
        ST_Distance(
          l.location,
          ST_SetSRID(ST_Point($2, $1), 4326)::geography
        ) AS distance_meters
      FROM shops s
      JOIN shop_locations l ON s.id = l.shop_id
      WHERE COALESCE(s.is_active, TRUE) = TRUE
        AND ST_DWithin(
          l.location,
          ST_SetSRID(ST_Point($2, $1), 4326)::geography,
          $3
        )
      ORDER BY distance_meters ASC
      LIMIT 20
    `,
    [input.lat, input.lng, input.radius]
  );

  return result.rows.map(mapShop);
}

const availabilitySchema = z.object({
  acceptingOrders: z.boolean(),
});

async function patchAvailability({ id, body, auth, db }) {
  if (normalizeRole(auth.role) !== "shop_owner") {
    throw new ApiError(403, "Only shop_owner can update shop availability");
  }

  const input = availabilitySchema.parse(body);

  const ownershipCheck = await db.query(
    `SELECT id FROM shops WHERE id = $1 AND (owner_user_id = $2 OR owner_id = $2) LIMIT 1`,
    [id, auth.sub]
  );

  if (ownershipCheck.rowCount === 0) {
    throw new ApiError(403, "You can only update your own shop");
  }

  await db.query(
    `UPDATE shops SET accepting_orders = $1, updated_at = NOW() WHERE id = $2`,
    [input.acceptingOrders, id]
  );

  return getShopById({ id, db });
}

module.exports = {
  ensureShopTables,
  createShop,
  getShopById,
  updateShop,
  findNearbyShops,
  patchAvailability,
};
