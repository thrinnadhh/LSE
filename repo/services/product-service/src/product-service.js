const { z } = require("zod");
const { ApiError } = require("../../../apps/api-gateway/src/lib/errors");
const { PRODUCT_CREATED_TOPIC } = require("../../search-service/src/search-indexer");

const createProductSchema = z.object({
  shopId: z.string().uuid().optional(),
  shop_id: z.string().uuid().optional(),
  name: z.string().trim().min(2).max(180),
  description: z.string().trim().max(2000).optional(),
  category: z.string().trim().max(80).optional(),
  price: z.coerce.number().positive(),
  stock: z.coerce.number().int().min(0).default(0),
  imageUrl: z.string().url().optional(),
});

const updateInventorySchema = z.object({
  stockQuantity: z.coerce.number().int().min(0),
});

function normalizeRole(role) {
  return String(role || "").toLowerCase();
}

function mapProduct(row) {
  const stockQuantity = Number(row.stock_quantity || 0);
  const reservedQuantity = Number(row.reserved_quantity || 0);
  const availableQuantity = stockQuantity - reservedQuantity;

  return {
    id: row.id,
    productId: row.id,
    shopId: row.shop_id,
    name: row.name,
    description: row.description,
    category: row.category,
    price: Number(row.price),
    imageUrl: row.image_url,
    isActive: row.is_active,
    createdAt: row.created_at,
    stockQuantity,
    reservedQuantity,
    availableQuantity,
    available_quantity: availableQuantity,
    inStock: availableQuantity > 0,
  };
}

async function ensureProductTables(db) {
  await db.query(`
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
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_products_shop_id
    ON products(shop_id);
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_products_shop_active
    ON products(shop_id, is_active);
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS inventory (
      product_id UUID PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
      stock_quantity INT DEFAULT 0,
      reserved_quantity INT DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS product_images (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      product_id UUID REFERENCES products(id) ON DELETE CASCADE,
      image_url TEXT
    );
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_product_images_product_id
    ON product_images(product_id);
  `);
}

async function resolveOwnedShopId({ requestedShopId, ownerId, db }) {
  if (requestedShopId) {
    const ownership = await db.query(
      `
        SELECT id
        FROM shops
        WHERE id = $1
          AND (owner_user_id = $2 OR owner_id = $2)
        LIMIT 1
      `,
      [requestedShopId, ownerId]
    );

    if (ownership.rowCount === 0) {
      throw new ApiError(403, "You can only create products for your own shop");
    }

    return requestedShopId;
  }

  const ownedShops = await db.query(
    `
      SELECT id
      FROM shops
      WHERE owner_user_id = $1 OR owner_id = $1
      ORDER BY created_at ASC
      LIMIT 2
    `,
    [ownerId]
  );

  if (ownedShops.rowCount === 0) {
    throw new ApiError(400, "Create a shop first before adding products");
  }

  if (ownedShops.rowCount > 1) {
    throw new ApiError(400, "shopId is required when you own multiple shops");
  }

  return ownedShops.rows[0].id;
}

async function createProduct({ body, auth, db, producer, traceId }) {
  console.log("createProduct auth object:", JSON.stringify(auth));
  if (normalizeRole(auth.role) !== "shop_owner") {
    throw new ApiError(403, "Only shop_owner can create products");
  }

  const input = createProductSchema.parse(body);
  const shopId = await resolveOwnedShopId({
    requestedShopId: input.shopId || input.shop_id,
    ownerId: auth.sub,
    db,
  });

  const created = await db.query(
    `
      INSERT INTO products (shop_id, name, description, category, price, image_url, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, TRUE)
      RETURNING id, shop_id, name, description, category, price, image_url, is_active, created_at
    `,
    [shopId, input.name, input.description || null, input.category || null, input.price, input.imageUrl || null]
  );

  const product = created.rows[0];

  await db.query(
    `
      INSERT INTO inventory (product_id, stock_quantity, reserved_quantity, updated_at)
      VALUES ($1, $2, 0, NOW())
      ON CONFLICT (product_id)
      DO UPDATE SET stock_quantity = EXCLUDED.stock_quantity, updated_at = NOW()
    `,
    [product.id, input.stock]
  );

  if (input.imageUrl) {
    await db.query(
      `
        INSERT INTO product_images (product_id, image_url)
        VALUES ($1, $2)
      `,
      [product.id, input.imageUrl]
    );
  }

  await producer.send({
    topic: PRODUCT_CREATED_TOPIC,
    messages: [
      {
        key: product.id,
        value: JSON.stringify({
          productId: product.id,
          shopId: product.shop_id,
          productName: product.name,
          category: product.category,
          price: Number(product.price),
        }),
        headers: traceId ? { traceId, version: "1.0" } : { version: "1.0" },
      },
    ],
  });

  const full = await getProductById({ id: product.id, db });
  return full;
}

async function listProductsByShop({ shopId, db }) {
  const result = await db.query(
    `
      SELECT
        p.id,
        p.shop_id,
        p.name,
        p.description,
        p.category,
        p.price,
        p.image_url,
        p.is_active,
        p.created_at,
        COALESCE(i.stock_quantity, 0) AS stock_quantity,
        COALESCE(i.reserved_quantity, 0) AS reserved_quantity
      FROM products p
      LEFT JOIN inventory i ON p.id = i.product_id
      WHERE p.shop_id = $1
        AND p.is_active = TRUE
      ORDER BY p.created_at DESC
    `,
    [shopId]
  );

  return result.rows.map(mapProduct);
}

async function getProductById({ id, db }) {
  const result = await db.query(
    `
      SELECT
        p.id,
        p.shop_id,
        p.name,
        p.description,
        p.category,
        p.price,
        p.image_url,
        p.is_active,
        p.created_at,
        COALESCE(i.stock_quantity, 0) AS stock_quantity,
        COALESCE(i.reserved_quantity, 0) AS reserved_quantity
      FROM products p
      LEFT JOIN inventory i ON p.id = i.product_id
      WHERE p.id = $1
      LIMIT 1
    `,
    [id]
  );

  if (result.rowCount === 0) {
    throw new ApiError(404, "Product not found");
  }

  return mapProduct(result.rows[0]);
}

async function updateInventory({ productId, body, auth, db }) {
  if (normalizeRole(auth.role) !== "shop_owner") {
    throw new ApiError(403, "Only shop_owner can update inventory");
  }

  const input = updateInventorySchema.parse(body);

  const ownership = await db.query(
    `
      SELECT p.id
      FROM products p
      JOIN shops s ON s.id = p.shop_id
      WHERE p.id = $1
        AND (s.owner_user_id = $2 OR s.owner_id = $2)
      LIMIT 1
    `,
    [productId, auth.sub]
  );

  if (ownership.rowCount === 0) {
    throw new ApiError(403, "You can only update inventory for your own products");
  }

  await db.query(
    `
      INSERT INTO inventory (product_id, stock_quantity, reserved_quantity, updated_at)
      VALUES ($1, $2, 0, NOW())
      ON CONFLICT (product_id)
      DO UPDATE SET stock_quantity = EXCLUDED.stock_quantity, updated_at = NOW()
    `,
    [productId, input.stockQuantity]
  );

  return getProductById({ id: productId, db });
}

module.exports = {
  ensureProductTables,
  createProduct,
  listProductsByShop,
  getProductById,
  updateInventory,
};
