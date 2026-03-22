const { ApiError } = require("../../../apps/api-gateway/src/lib/errors");
const {
  upsertUserPreference,
  listUserPreferences: fetchUserPreferences,
} = require("../../../lib/user-preferences");

function toApiRole(role) {
  return String(role).toLowerCase();
}

async function ensureUserCommerceTables(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS favorite_shops (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, shop_id)
    );
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_favorite_shops_user_id
    ON favorite_shops(user_id);
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_favorite_shops_shop_id
    ON favorite_shops(shop_id);
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS shop_customer_stats (
      shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      order_count INT NOT NULL DEFAULT 0,
      last_order_at TIMESTAMPTZ,
      PRIMARY KEY (shop_id, customer_id)
    );
  `);

  await db.query(`
    ALTER TABLE shop_customer_stats
    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;
  `);

  // Only update if user_id is NOT null and customer_id is NULL (unlikely but safe)
  await db.query(`
    UPDATE shop_customer_stats
    SET customer_id = user_id
    WHERE customer_id IS NULL AND user_id IS NOT NULL;
  `);

  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_shop_customer_unique
    ON shop_customer_stats (shop_id, customer_id);
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_shop_customer_stats_user
    ON shop_customer_stats(customer_id, order_count DESC, last_order_at DESC);
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS user_preferences (
      user_id UUID,
      shop_id UUID,
      category TEXT,
      score INT DEFAULT 1,
      updated_at TIMESTAMP DEFAULT NOW(),
      PRIMARY KEY (user_id, shop_id, category)
    );
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_user_preferences_user
    ON user_preferences(user_id, score DESC, updated_at DESC);
  `);
}

async function getMe({ userId, db }) {
  const result = await db.query(
    `
      SELECT id, phone, email, full_name, role, is_active, created_at
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
    [userId]
  );

  if (result.rowCount === 0) {
    throw new ApiError(404, "User not found");
  }

  const user = result.rows[0];
  return {
    id: user.id,
    phone: user.phone,
    email: user.email,
    fullName: user.full_name,
    role: toApiRole(user.role),
    isActive: user.is_active,
    createdAt: user.created_at,
  };
}

async function addFavoriteShop({ userId, shopId, db }) {
  const shop = await db.query(
    `SELECT id, COALESCE(is_active, TRUE) AS is_active FROM shops WHERE id = $1 LIMIT 1`,
    [shopId]
  );

  if (shop.rowCount === 0) {
    throw new ApiError(404, "Shop not found");
  }

  if (!shop.rows[0].is_active) {
    throw new ApiError(400, "Inactive shop cannot be favorited");
  }

  const insertResult = await db.query(
    `
      INSERT INTO favorite_shops (user_id, shop_id)
      VALUES ($1, $2)
      ON CONFLICT (user_id, shop_id)
      DO NOTHING
    `,
    [userId, shopId]
  );

  if (insertResult.rowCount > 0) {
    console.info("favorite added", { userId, shopId });
  }

  return { message: "Shop added to favorites" };
}

async function removeFavoriteShop({ userId, shopId, db }) {
  await db.query(
    `
      DELETE FROM favorite_shops
      WHERE user_id = $1
        AND shop_id = $2
    `,
    [userId, shopId]
  );

  return { message: "Removed from favorites" };
}

async function listFavoriteShops({ userId, db }) {
  console.log("Favorites query user_id:", userId);

  const result = await db.query(
    `
      SELECT
        s.id AS shop_id,
        s.name,
        s.category
      FROM favorite_shops fs
      JOIN shops s ON s.id = fs.shop_id
      WHERE fs.user_id = $1
      ORDER BY fs.created_at DESC
    `,
    [userId]
  );

  return result.rows.map((row) => ({
    shopId: row.shop_id,
    name: row.name,
    category: row.category,
  }));
}

async function listRegularShops({ userId, db, limit = 10 }) {
  console.log("Regular shops query user_id:", userId);

  const result = await db.query(
    `
      SELECT s.id AS "shopId",
        s.name,
        scs.order_count AS "orderCount",
        scs.last_order_at AS "lastOrderAt"
      FROM shop_customer_stats scs
      JOIN shops s ON s.id = scs.shop_id
      WHERE scs.customer_id = $1
      ORDER BY scs.order_count DESC, scs.last_order_at DESC
    `,
    [userId]
  );

  console.log("Regular shops rows:", result.rows.length, result.rows);

  return result.rows.slice(0, limit).map((row) => ({
    shopId: row.shopId,
    name: row.name,
    orderCount: Number(row.orderCount),
    lastOrderAt: row.lastOrderAt,
  }));
}

async function listUserPreferences({ userId, db, limit = 10 }) {
  const items = await fetchUserPreferences({ db, userId, limit });
  return items;
}

module.exports = {
  ensureUserCommerceTables,
  getMe,
  addFavoriteShop,
  removeFavoriteShop,
  listFavoriteShops,
  listRegularShops,
  listUserPreferences,
};
