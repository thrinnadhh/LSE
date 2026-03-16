const { z } = require("zod");
const { ApiError } = require("../../../apps/api-gateway/src/lib/errors");
const {
  setDriverBusy,
  setDriverOnline,
  updateDriverGeoIndex,
} = require("../../dispatch-service/src/availability-store");

const assignDriverSchema = z.object({
  driverId: z.string().uuid(),
});

const driverLocationSchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

function normalizeRole(role) {
  return String(role || "").toLowerCase();
}

function mapOrderItem(row) {
  return {
    productName: row.product_name,
    quantity: Number(row.qty),
    unitPrice: Number(row.unit_price),
    subtotal: Number(row.line_total),
  };
}

function mapOrder(row, items) {
  return {
    orderId: row.id,
    status: row.status,
    customerId: row.customer_id,
    shopId: row.shop_id,
    driverId: row.driver_id,
    items,
    grandTotal: Number(row.grand_total),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function publishOrderEvent({ redis, orderId, status }) {
  if (!redis || !orderId || !status) {
    return;
  }

  await redis.publish(
    "order:events",
    JSON.stringify({
      orderId,
      status,
      timestamp: new Date().toISOString(),
    })
  );
}

async function ensureOrderLifecycleTables(db) {
  await db.query(`
    DO $$
    BEGIN
      ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'CONFIRMED';
      ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'ASSIGNED';
      ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'PICKED_UP';
      ALTER TYPE order_status ADD VALUE IF NOT EXISTS 'DELIVERING';
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS drivers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
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
  await db.query(`ALTER TABLE drivers ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;`);
  await db.query(`ALTER TABLE drivers ADD COLUMN IF NOT EXISTS is_online BOOLEAN NOT NULL DEFAULT FALSE;`);
  await db.query(`ALTER TABLE drivers ADD COLUMN IF NOT EXISTS is_busy BOOLEAN NOT NULL DEFAULT FALSE;`);
  await db.query(`ALTER TABLE drivers ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;`);
  await db.query(`ALTER TABLE drivers ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;`);

  await db.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS driver_id UUID REFERENCES drivers(id);`);

  await db.query(`CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_orders_shop_id ON orders(shop_id);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_orders_driver_id ON orders(driver_id);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_drivers_is_online ON drivers(is_online);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_drivers_is_busy ON drivers(is_busy);`);
}

async function getOrderRowOrThrow({ orderId, db, forUpdate = false }) {
  const result = await db.query(
    `
      SELECT id, customer_id, shop_id, driver_id, status, grand_total, created_at, updated_at
      FROM orders
      WHERE id = $1
      ${forUpdate ? "FOR UPDATE" : ""}
      LIMIT 1
    `,
    [orderId]
  );

  if (result.rowCount === 0) {
    throw new ApiError(404, "Order not found");
  }

  return result.rows[0];
}

async function getOrderItems({ orderId, db }) {
  const itemsResult = await db.query(
    `
      SELECT product_name, qty, unit_price, line_total
      FROM order_items
      WHERE order_id = $1
      ORDER BY id ASC
    `,
    [orderId]
  );

  return itemsResult.rows.map(mapOrderItem);
}

async function getOrderById({ orderId, auth, db }) {
  const order = await getOrderRowOrThrow({ orderId, db });
  const role = normalizeRole(auth.role);

  const isCustomer = auth.sub === order.customer_id;
  const isAdmin = role === "admin";
  if (!isCustomer && !isAdmin) {
    throw new ApiError(403, "You are not allowed to view this order");
  }

  const items = await getOrderItems({ orderId, db });
  return mapOrder(order, items);
}

async function assignDriver({ orderId, driverId, db, redis, requireAvailable = false }) {
  await db.query("BEGIN");
  try {
    const order = await getOrderRowOrThrow({ orderId, db, forUpdate: true });

    if (order.driver_id) {
      throw new ApiError(400, "Order already has an assigned driver");
    }

    if (order.status !== "CREATED" && order.status !== "CONFIRMED") {
      throw new ApiError(400, "Driver can only be assigned to CREATED or CONFIRMED orders");
    }

    const driverResult = await db.query(
      `
        SELECT id, is_active, is_online, COALESCE(is_busy, FALSE) AS is_busy
        FROM drivers
        WHERE id = $1
        LIMIT 1
        FOR UPDATE
      `,
      [driverId]
    );

    if (driverResult.rowCount === 0) {
      throw new ApiError(404, "Driver not found");
    }

    const driver = driverResult.rows[0];
    if (!driver.is_active) {
      throw new ApiError(400, "Driver is inactive");
    }

    if (requireAvailable && (!driver.is_online || driver.is_busy)) {
      throw new ApiError(400, "Driver is not available for assignment");
    }

    await db.query(
      `
        UPDATE drivers
        SET is_busy = TRUE, updated_at = NOW()
        WHERE id = $1
      `,
      [driverId]
    );

    await db.query(
      `
        UPDATE orders
        SET driver_id = $2, status = 'ASSIGNED', updated_at = NOW()
        WHERE id = $1
      `,
      [orderId, driverId]
    );

    await db.query("COMMIT");
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  }

  await setDriverBusy({ redis, driverId, isBusy: true });
  await publishOrderEvent({ redis, orderId, status: "ASSIGNED" });

  const updated = await getOrderRowOrThrow({ orderId, db });
  const items = await getOrderItems({ orderId, db });
  return mapOrder(updated, items);
}

async function assignDriverToOrder({ orderId, body, auth, db, redis }) {
  const role = normalizeRole(auth.role);
  if (role !== "admin" && role !== "dispatch_service") {
    throw new ApiError(403, "Only admin or dispatch service can assign drivers");
  }

  const input = assignDriverSchema.parse(body);

  return assignDriver({
    orderId,
    driverId: input.driverId,
    db,
    redis,
    requireAvailable: false,
  });
}

async function upsertDriverLocation({ body, auth, db, redis }) {
  const role = normalizeRole(auth.role);
  if (role !== "driver") {
    throw new ApiError(403, "Only drivers can update location");
  }

  const input = driverLocationSchema.parse(body);

  const userResult = await db.query(
    `
      SELECT phone, full_name
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
    [auth.sub]
  );

  if (userResult.rowCount === 0) {
    throw new ApiError(404, "User not found");
  }

  const user = userResult.rows[0];

  const result = await db.query(
    `
      INSERT INTO drivers (
        user_id,
        name,
        phone,
        vehicle_type,
        vehicle_number,
        is_active,
        is_online,
        is_busy,
        lat,
        lng,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, 'TWO_WHEELER', 'UNKNOWN', TRUE, TRUE, FALSE, $4, $5, NOW(), NOW())
      ON CONFLICT (user_id)
      DO UPDATE SET lat = EXCLUDED.lat, lng = EXCLUDED.lng, is_online = TRUE, updated_at = NOW()
      RETURNING id, user_id, name, phone, vehicle_type, vehicle_number, is_active, is_online, is_busy, lat, lng, created_at, updated_at
    `,
    [auth.sub, user.full_name || null, user.phone || null, input.lat, input.lng]
  );

  const row = result.rows[0];
  await setDriverOnline({ redis, driverId: row.id, isOnline: true });
  await setDriverBusy({ redis, driverId: row.id, isBusy: Boolean(row.is_busy) });
  await updateDriverGeoIndex({ redis, driverId: row.id, lat: row.lat, lng: row.lng });

  return {
    driverId: row.id,
    userId: row.user_id,
    name: row.name,
    phone: row.phone,
    vehicleType: row.vehicle_type,
    vehicleNumber: row.vehicle_number,
    isActive: row.is_active,
    isOnline: row.is_online,
    lat: row.lat !== null ? Number(row.lat) : null,
    lng: row.lng !== null ? Number(row.lng) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function ensureShopOwnerForOrder({ orderId, authUserId, db }) {
  const check = await db.query(
    `
      SELECT o.id
      FROM orders o
      JOIN shops s ON s.id = o.shop_id
      WHERE o.id = $1
        AND (s.owner_user_id = $2 OR s.owner_id = $2)
      LIMIT 1
    `,
    [orderId, authUserId]
  );

  if (check.rowCount === 0) {
    throw new ApiError(403, "You can only manage orders for your own shop");
  }
}

async function updateOrderStatus({ orderId, auth, db, redis, fromStatus, toStatus, actor }) {
  const role = normalizeRole(auth.role);
  if (actor === "shop") {
    if (role !== "shop_owner") {
      throw new ApiError(403, "Only shop_owner can confirm orders");
    }
    await ensureShopOwnerForOrder({ orderId, authUserId: auth.sub, db });
  }

  if (actor === "driver") {
    if (role !== "driver") {
      throw new ApiError(403, "Only drivers can update delivery status");
    }

    const driverResult = await db.query(
      `
        SELECT id
        FROM drivers
        WHERE user_id = $1
        LIMIT 1
      `,
      [auth.sub]
    );

    if (driverResult.rowCount === 0) {
      throw new ApiError(404, "Driver profile not found");
    }

    const orderDriverCheck = await db.query(
      `
        SELECT id
        FROM orders
        WHERE id = $1 AND driver_id = $2
        LIMIT 1
      `,
      [orderId, driverResult.rows[0].id]
    );

    if (orderDriverCheck.rowCount === 0) {
      throw new ApiError(403, "Order is not assigned to this driver");
    }
  }

  let driverIdForRelease = null;
  await db.query("BEGIN");
  try {
    const current = await getOrderRowOrThrow({ orderId, db, forUpdate: true });
    if (current.status !== fromStatus) {
      throw new ApiError(400, `Action allowed only when order is ${fromStatus}`);
    }

    await db.query(
      `
        UPDATE orders
        SET status = $2, updated_at = NOW()
        WHERE id = $1
      `,
      [orderId, toStatus]
    );

    if ((toStatus === "DELIVERED" || toStatus === "CANCELLED") && current.driver_id) {
      driverIdForRelease = current.driver_id;
      await db.query(
        `
          UPDATE drivers
          SET is_busy = FALSE, updated_at = NOW()
          WHERE id = $1
        `,
        [current.driver_id]
      );
    }

    await db.query("COMMIT");
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  }

  if (driverIdForRelease) {
    await setDriverBusy({ redis, driverId: driverIdForRelease, isBusy: false });
    await setDriverOnline({ redis, driverId: driverIdForRelease, isOnline: true });
  }

  await publishOrderEvent({ redis, orderId, status: toStatus });

  const updated = await getOrderRowOrThrow({ orderId, db });
  const items = await getOrderItems({ orderId, db });
  return mapOrder(updated, items);
}

async function getDriverCurrentOrder({ auth, db }) {
  const role = normalizeRole(auth.role);
  if (role !== "driver") {
    throw new ApiError(403, "Only drivers can fetch current assigned order");
  }

  const driverResult = await db.query(
    `
      SELECT id
      FROM drivers
      WHERE user_id = $1
      LIMIT 1
    `,
    [auth.sub]
  );

  if (driverResult.rowCount === 0) {
    return null;
  }

  const orderResult = await db.query(
    `
      SELECT id, customer_id, shop_id, driver_id, status, grand_total, created_at, updated_at
      FROM orders
      WHERE driver_id = $1
        AND status IN ('ASSIGNED', 'PICKED_UP', 'DELIVERING')
      ORDER BY updated_at DESC
      LIMIT 1
    `,
    [driverResult.rows[0].id]
  );

  if (orderResult.rowCount === 0) {
    return null;
  }

  const order = orderResult.rows[0];
  const items = await getOrderItems({ orderId: order.id, db });
  return mapOrder(order, items);
}

async function listShopOrders({ shopId, auth, db }) {
  const role = normalizeRole(auth.role);
  if (role !== "shop_owner") {
    throw new ApiError(403, "Only shop_owner can view shop orders");
  }

  const ownership = await db.query(
    `
      SELECT id
      FROM shops
      WHERE id = $1
        AND (owner_user_id = $2 OR owner_id = $2)
      LIMIT 1
    `,
    [shopId, auth.sub]
  );

  if (ownership.rowCount === 0) {
    throw new ApiError(403, "You can only view orders for your own shop");
  }

  const ordersResult = await db.query(
    `
      SELECT id, customer_id, shop_id, driver_id, status, grand_total, created_at, updated_at
      FROM orders
      WHERE shop_id = $1
      ORDER BY created_at DESC
      LIMIT 100
    `,
    [shopId]
  );

  if (ordersResult.rowCount === 0) {
    return [];
  }

  const orderIds = ordersResult.rows.map((row) => row.id);
  const itemsResult = await db.query(
    `
      SELECT order_id, product_name, qty, unit_price, line_total
      FROM order_items
      WHERE order_id = ANY($1::uuid[])
      ORDER BY id ASC
    `,
    [orderIds]
  );

  const itemsByOrderId = new Map();
  for (const row of itemsResult.rows) {
    if (!itemsByOrderId.has(row.order_id)) {
      itemsByOrderId.set(row.order_id, []);
    }
    itemsByOrderId.get(row.order_id).push(mapOrderItem(row));
  }

  return ordersResult.rows.map((row) => mapOrder(row, itemsByOrderId.get(row.id) || []));
}

module.exports = {
  ensureOrderLifecycleTables,
  getOrderById,
  assignDriver,
  assignDriverToOrder,
  upsertDriverLocation,
  updateOrderStatus,
  getDriverCurrentOrder,
  listShopOrders,
};
