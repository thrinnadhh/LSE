const { z } = require("zod");
const { ApiError } = require("../../../apps/api-gateway/src/lib/errors");

const SHOP_CATEGORIES = [
  "grocery",
  "pet_store",
  "electronics",
  "furniture",
  "salon",
  "doctor",
  "restaurant",
];

const shopCategorySchema = z.enum(SHOP_CATEGORIES);

const createShopSchema = z.object({
  name: z.string().trim().min(2).max(180),
  description: z.string().trim().max(2000).optional(),
  category: shopCategorySchema.optional(),
  phone: z.string().trim().regex(/^\+?[0-9]{10,15}$/),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

const updateShopSchema = z
  .object({
    name: z.string().trim().min(2).max(180).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    category: shopCategorySchema.nullable().optional(),
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

const shopDetailsQuerySchema = z
  .object({
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
  })
  .refine((value) => (value.lat === undefined) === (value.lng === undefined), {
    message: "lat and lng must be provided together",
  });

async function ensureShopTables(db) {
  await db.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shop_category') THEN
        CREATE TYPE shop_category AS ENUM (
          'grocery',
          'pet_store',
          'electronics',
          'furniture',
          'salon',
          'doctor',
          'restaurant'
        );
      END IF;
    END $$;
  `);

  await db.query(`ALTER TABLE shops ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES users(id);`);
  await db.query(`ALTER TABLE shops ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;`);
  await db.query(`ALTER TABLE shops ADD COLUMN IF NOT EXISTS is_open BOOLEAN DEFAULT TRUE;`);
  await db.query(`ALTER TABLE shops ADD COLUMN IF NOT EXISTS accepting_orders BOOLEAN DEFAULT TRUE;`);
  await db.query(`ALTER TABLE shops ADD COLUMN IF NOT EXISTS category TEXT;`);

  await db.query(`
    ALTER TABLE shops
    ALTER COLUMN category TYPE shop_category
    USING CASE
      WHEN category IS NULL THEN NULL
      WHEN category::text IN ('grocery', 'pet_store', 'electronics', 'furniture', 'salon', 'doctor', 'restaurant')
        THEN category::shop_category
      ELSE NULL
    END;
  `);

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
    shopId: row.id,
    ownerId: row.owner_id,
    name: row.name,
    description: row.description,
    category: row.category,
    phone: row.phone,
    rating: row.rating_avg !== null && row.rating_avg !== undefined ? Number(row.rating_avg) : 0,
    ratingAvg: row.rating_avg !== null && row.rating_avg !== undefined ? Number(row.rating_avg) : 0,
    ratingCount: row.rating_count !== null && row.rating_count !== undefined ? Number(row.rating_count) : 0,
    openingHours: row.opening_hours || {},
    opening_hours: row.opening_hours || {},
    isActive: row.is_active,
    isOpen: row.is_open !== null && row.is_open !== undefined ? Boolean(row.is_open) : true,
    is_open: row.is_open !== null && row.is_open !== undefined ? Boolean(row.is_open) : true,
    acceptingOrders: row.accepting_orders !== null && row.accepting_orders !== undefined ? Boolean(row.accepting_orders) : true,
    accepting_orders: row.accepting_orders !== null && row.accepting_orders !== undefined ? Boolean(row.accepting_orders) : true,
    lat: row.lat !== null ? Number(row.lat) : null,
    lng: row.lng !== null ? Number(row.lng) : null,
    createdAt: row.created_at,
    distance: row.distance_meters !== null && row.distance_meters !== undefined ? Math.round(Number(row.distance_meters)) : undefined,
  };
}

function mapNearbyShop(row) {
  return {
    shopId: row.id,
    name: row.name,
    category: row.category,
    rating: row.rating_avg !== null && row.rating_avg !== undefined ? Number(row.rating_avg) : 0,
    isOpen: row.is_open !== null && row.is_open !== undefined ? Boolean(row.is_open) : true,
    acceptingOrders: row.accepting_orders !== null && row.accepting_orders !== undefined ? Boolean(row.accepting_orders) : true,
    distance: row.distance_meters !== null && row.distance_meters !== undefined ? Math.round(Number(row.distance_meters)) : undefined,
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

async function getShopById({ id, query = {}, db }) {
  const input = shopDetailsQuerySchema.parse(query);

  const result = await db.query(
    `
      SELECT
        s.id,
        COALESCE(s.owner_id, s.owner_user_id) AS owner_id,
        s.name,
        s.description,
        s.category,
        s.phone,
        s.opening_hours,
        s.rating_avg,
        s.rating_count,
        COALESCE(s.is_active, TRUE) AS is_active,
        s.is_open,
        s.accepting_orders,
        s.created_at,
        ST_Y(s.location::geometry) AS lat,
        ST_X(s.location::geometry) AS lng,
        CASE
          WHEN $2::double precision IS NOT NULL AND $3::double precision IS NOT NULL
            THEN ST_Distance(
              s.location,
              ST_SetSRID(ST_Point($3, $2), 4326)::geography
            )
          ELSE NULL
        END AS distance_meters
      FROM shops s
      WHERE s.id = $1
      LIMIT 1
    `,
    [id, input.lat ?? null, input.lng ?? null]
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
        s.name,
        s.category,
        s.rating_avg,
        s.is_open,
        s.accepting_orders,
        ST_Distance(
          s.location,
          ST_SetSRID(ST_Point($2, $1), 4326)::geography
        ) AS distance_meters
      FROM shops s
      WHERE COALESCE(s.is_active, TRUE) = TRUE
        AND s.status = 'ACTIVE'
        AND ST_DWithin(
          s.location,
          ST_SetSRID(ST_Point($2, $1), 4326)::geography,
          $3
        )
      ORDER BY distance_meters ASC
      LIMIT 50
    `,
    [input.lat, input.lng, input.radius]
  );

  return result.rows.map(mapNearbyShop);
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
