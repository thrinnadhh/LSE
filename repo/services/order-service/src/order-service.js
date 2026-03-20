const { z } = require("zod");
const { ApiError } = require("../../../apps/api-gateway/src/lib/errors");
const { KAFKA_TOPICS, EVENT_TYPES, createEventEnvelope } = require("../../../lib/kafka/event-schema");
const {
  setDriverBusy,
  setDriverOnline,
  updateDriverGeoIndex,
} = require("../../dispatch-service/src/availability-store");
const { calculateDistanceKm } = require("../../../lib/geo/distance");

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

async function runRedisSideEffect(taskName, task, timeoutMs = 1500) {
  try {
    await Promise.race([
      task,
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`${taskName} timeout`)), timeoutMs);
      }),
    ]);
  } catch (err) {
    console.warn("redis side effect skipped", { taskName, error: err.message });
  }
}

async function getOrderDeliveryContext({ orderId, db }) {
  const result = await db.query(
    `
      SELECT
        o.id AS order_id,
        s.id AS shop_id,
        s.name AS shop_name,
        ST_Y(COALESCE(sl.location, s.location)::geometry) AS shop_lat,
        ST_X(COALESCE(sl.location, s.location)::geometry) AS shop_lng,
        d.id AS driver_id,
        d.name AS driver_name,
        d.lat AS driver_lat,
        d.lng AS driver_lng,
        d.is_online AS driver_is_online,
        d.is_busy AS driver_is_busy,
        ST_Y(ua.location::geometry) AS customer_lat,
        ST_X(ua.location::geometry) AS customer_lng
      FROM orders o
      JOIN shops s ON s.id = o.shop_id
      LEFT JOIN shop_locations sl ON sl.shop_id = s.id
      LEFT JOIN drivers d ON d.id = o.driver_id
      LEFT JOIN user_addresses ua ON ua.id = o.delivery_address_id
      WHERE o.id = $1
      LIMIT 1
    `,
    [orderId]
  );

  if (result.rowCount === 0) {
    return null;
  }

  return result.rows[0];
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

function toOrderStatusPayload(orderRow) {
  return {
    orderId: orderRow.id,
    status: orderRow.status,
    customerId: orderRow.customer_id,
    shopId: orderRow.shop_id,
    driverId: orderRow.driver_id || null,
  };
}

async function publishOrderStatusChangedEvent({ kafkaProducer, orderRow }) {
  if (!kafkaProducer || !orderRow) {
    return;
  }

  const event = createEventEnvelope({
    eventType: EVENT_TYPES.ORDER_STATUS_CHANGED,
    source: "order-service",
    payload: toOrderStatusPayload(orderRow),
  });

  await kafkaProducer.publish({
    topic: KAFKA_TOPICS.orderEvents,
    event,
    key: orderRow.id,
  });
}

async function publishOrderStatusChangedById({ orderId, db, kafkaProducer }) {
  if (!orderId || !db || !kafkaProducer) {
    return;
  }

  const order = await getOrderRowOrThrow({ orderId, db });
  await publishOrderStatusChangedEvent({ kafkaProducer, orderRow: order });
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

async function recordShopCustomerCompletion({ db, shopId, customerId }) {
  if (!shopId || !customerId) {
    return;
  }

  await db.query(
    `
      ALTER TABLE shop_customer_stats
      ADD COLUMN IF NOT EXISTS customer_id UUID
    `
  );

  await db.query(
    `
      UPDATE shop_customer_stats
      SET customer_id = user_id
      WHERE customer_id IS NULL
    `
  );

  await db.query(
    `
      CREATE UNIQUE INDEX IF NOT EXISTS idx_shop_customer_unique
      ON shop_customer_stats (shop_id, customer_id)
    `
  );

  await db.query(
    `
      INSERT INTO shop_customer_stats (shop_id, customer_id, user_id, order_count, last_order_at)
      VALUES ($1, $2, $2, 1, NOW())
      ON CONFLICT (shop_id, customer_id)
      DO UPDATE SET
        user_id = EXCLUDED.customer_id,
        order_count = shop_customer_stats.order_count + 1,
        last_order_at = NOW()
    `,
    [shopId, customerId]
  );

  const stats = await db.query(
    `
      SELECT order_count
      FROM shop_customer_stats
      WHERE shop_id = $1
        AND customer_id = $2
      LIMIT 1
    `,
    [shopId, customerId]
  );

  const orderCount = Number(stats.rows[0]?.order_count || 0);
  console.info("stats updated", { shopId, customerId, orderCount });

  if (orderCount >= 3) {
    await db.query(
      `
        INSERT INTO favorite_shops (user_id, shop_id)
        VALUES ($1, $2)
        ON CONFLICT (user_id, shop_id)
        DO NOTHING
      `,
      [customerId, shopId]
    );
  }
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
  const payload = mapOrder(order, items);

  const context = await getOrderDeliveryContext({ orderId, db });
  if (!context) {
    return payload;
  }

  const shopLat = context.shop_lat !== null ? Number(context.shop_lat) : null;
  const shopLng = context.shop_lng !== null ? Number(context.shop_lng) : null;
  const driverLat = context.driver_lat !== null ? Number(context.driver_lat) : null;
  const driverLng = context.driver_lng !== null ? Number(context.driver_lng) : null;
  const customerLat = context.customer_lat !== null ? Number(context.customer_lat) : null;
  const customerLng = context.customer_lng !== null ? Number(context.customer_lng) : null;

  const distanceToShopKm = calculateDistanceKm(driverLat, driverLng, shopLat, shopLng);
  const distanceToCustomerKm = calculateDistanceKm(driverLat, driverLng, customerLat, customerLng);

  return {
    ...payload,
    shop: {
      id: context.shop_id,
      name: context.shop_name,
      lat: shopLat,
      lng: shopLng,
    },
    driver: context.driver_id
      ? {
          id: context.driver_id,
          name: context.driver_name,
          lat: driverLat,
          lng: driverLng,
          isOnline: context.driver_is_online,
          isBusy: context.driver_is_busy,
        }
      : null,
    distanceToShop: distanceToShopKm !== null ? Number(distanceToShopKm.toFixed(2)) : null,
    distanceToCustomer: distanceToCustomerKm !== null ? Number(distanceToCustomerKm.toFixed(2)) : null,
  };
}

async function assignDriver({ orderId, driverId, db, redis, kafkaProducer, requireAvailable = false }) {
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
  await publishOrderStatusChangedEvent({ kafkaProducer, orderRow: updated });
  const items = await getOrderItems({ orderId, db });
  return mapOrder(updated, items);
}

async function assignDriverToOrder({ orderId, body, auth, db, redis, kafkaProducer }) {
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
    kafkaProducer,
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
  await Promise.all([
    runRedisSideEffect(
      "setDriverOnline",
      setDriverOnline({ redis, driverId: row.id, isOnline: true })
    ),
    runRedisSideEffect(
      "setDriverBusy",
      setDriverBusy({ redis, driverId: row.id, isBusy: Boolean(row.is_busy) })
    ),
    runRedisSideEffect(
      "updateDriverGeoIndex",
      updateDriverGeoIndex({ redis, driverId: row.id, lat: row.lat, lng: row.lng })
    ),
  ]);

  const activeOrder = await db.query(
    `
      SELECT id
      FROM orders
      WHERE driver_id = $1
        AND status IN ('ASSIGNED', 'PICKED_UP', 'DELIVERING')
      ORDER BY updated_at DESC
      LIMIT 1
    `,
    [row.id]
  );

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
    currentOrderId: activeOrder.rowCount > 0 ? activeOrder.rows[0].id : null,
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

async function updateOrderStatus({ orderId, auth, db, redis, kafkaProducer, fromStatus, toStatus, actor }) {
  const allowDevManualCompletion = process.env.NODE_ENV !== "production" && actor === "driver" && toStatus === "DELIVERED";
  const role = normalizeRole(auth.role);
  let driverProfileId = null;

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
      if (!allowDevManualCompletion) {
        throw new ApiError(404, "Driver profile not found");
      }

      const userResult = await db.query(
        `
          SELECT full_name, phone
          FROM users
          WHERE id = $1
          LIMIT 1
        `,
        [auth.sub]
      );

      const insertedDriver = await db.query(
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
            created_at,
            updated_at
          )
          VALUES ($1, $2, $3, 'TWO_WHEELER', 'DEV-FALLBACK', TRUE, TRUE, FALSE, NOW(), NOW())
          ON CONFLICT (user_id)
          DO UPDATE SET is_active = TRUE, is_online = TRUE, updated_at = NOW()
          RETURNING id
        `,
        [auth.sub, userResult.rows[0]?.full_name || null, userResult.rows[0]?.phone || null]
      );

      driverProfileId = insertedDriver.rows[0].id;
    } else {
      driverProfileId = driverResult.rows[0].id;
    }

    if (!allowDevManualCompletion) {
      const orderDriverCheck = await db.query(
        `
          SELECT id
          FROM orders
          WHERE id = $1 AND driver_id = $2
          LIMIT 1
        `,
        [orderId, driverProfileId]
      );

      if (orderDriverCheck.rowCount === 0) {
        throw new ApiError(403, "Order is not assigned to this driver");
      }
    }
  }

  let driverIdForRelease = null;
  let transitionStatus = toStatus;
  await db.query("BEGIN");
  try {
    const current = await getOrderRowOrThrow({ orderId, db, forUpdate: true });
    let forcedBypassApplied = false;

    console.info("order status transition", {
      orderId,
      actor,
      requestedFromStatus: fromStatus,
      requestedToStatus: toStatus,
      currentStatus: current.status,
      driverId: current.driver_id,
      allowDevManualCompletion,
    });

    if (current.status !== fromStatus) {
      const canBypassInDev =
        allowDevManualCompletion
        && ["CREATED", "CONFIRMED", "ASSIGNED", "PICKED_UP", "DELIVERING"].includes(current.status);

      if (!canBypassInDev) {
        throw new ApiError(400, `Action allowed only when order is ${fromStatus}`);
      }

      console.log("Fallback completion triggered");
      console.info("dev fallback transition bypass", {
        orderId,
        fromStatus: current.status,
        toStatus,
      });

      if (current.status !== "DELIVERED") {
        const forcedResult = await db.query(
          `
            UPDATE orders
            SET status = 'DELIVERED',
                driver_id = COALESCE(driver_id, $2),
                updated_at = NOW()
            WHERE id = $1
            RETURNING driver_id
          `,
          [orderId, driverProfileId]
        );

        transitionStatus = "DELIVERED";
        const effectiveDriverId = forcedResult.rows[0]?.driver_id || current.driver_id;

        console.log("Forced DELIVERED for order:", orderId);
        console.log("DELIVERED reached -> updating stats");
        await recordShopCustomerCompletion({
          db,
          shopId: current.shop_id,
          customerId: current.customer_id,
        });

        if (effectiveDriverId) {
          driverIdForRelease = effectiveDriverId;
          await db.query(
            `
              UPDATE drivers
              SET is_busy = FALSE, updated_at = NOW()
              WHERE id = $1
            `,
            [effectiveDriverId]
          );
        }
      } else {
        transitionStatus = "DELIVERED";
      }

      forcedBypassApplied = true;
    }

    if (!forcedBypassApplied) {
      const updateResult = await db.query(
        `
          UPDATE orders
          SET status = $2,
              driver_id = COALESCE(driver_id, $3),
              updated_at = NOW()
          WHERE id = $1
          RETURNING driver_id
        `,
        [orderId, toStatus, driverProfileId]
      );

      const effectiveDriverId = updateResult.rows[0]?.driver_id || current.driver_id;

      if ((toStatus === "DELIVERED" || toStatus === "CANCELLED") && effectiveDriverId) {
        driverIdForRelease = effectiveDriverId;
        await db.query(
          `
            UPDATE drivers
            SET is_busy = FALSE, updated_at = NOW()
            WHERE id = $1
          `,
          [effectiveDriverId]
        );
      }

      if (toStatus === "DELIVERED") {
        console.log("DELIVERED reached -> updating stats", {
          orderId,
          shopId: current.shop_id,
          customerId: current.customer_id,
        });

        await recordShopCustomerCompletion({
          db,
          shopId: current.shop_id,
          customerId: current.customer_id,
        });
      }
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

  await publishOrderEvent({ redis, orderId, status: transitionStatus });

  const updated = await getOrderRowOrThrow({ orderId, db });
  await publishOrderStatusChangedEvent({ kafkaProducer, orderRow: updated });
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
  publishOrderStatusChangedById,
  getDriverCurrentOrder,
  listShopOrders,
};
