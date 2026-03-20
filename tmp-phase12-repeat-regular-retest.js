/* eslint-disable no-console */
const { randomUUID } = require("crypto");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const orderService = require("./repo/services/order-service/src/order-service");

const BASE = process.env.BASE_URL || "http://localhost:8081";
const DATABASE_URL = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/hyperlocal";
const JWT_SECRET = process.env.JWT_SECRET || "devsecret";

const pool = new Pool({ connectionString: DATABASE_URL });

function tokenFor({ id, role }) {
  return jwt.sign({ sub: id, role }, JWT_SECRET, { expiresIn: "2h" });
}

async function req(method, path, { body, token, timeoutMs = 12000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = {};
    if (body !== undefined) headers["content-type"] = "application/json";
    if (token) headers.authorization = `Bearer ${token}`;

    const res = await fetch(BASE + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch (_err) {
      parsed = { raw: text };
    }
    return { status: res.status, body: parsed };
  } catch (err) {
    return { status: 0, body: { error: err.message } };
  } finally {
    clearTimeout(timer);
  }
}

async function seedUser({ id, phone, role, name }) {
  await pool.query(
    `INSERT INTO users (id, phone, full_name, role, is_active, created_at, updated_at)
     VALUES ($1, $2, $3, $4::user_role, TRUE, NOW(), NOW())
     ON CONFLICT (id)
     DO UPDATE SET phone = EXCLUDED.phone, full_name = EXCLUDED.full_name, role = EXCLUDED.role, updated_at = NOW()`,
    [id, phone, name, role]
  );
}

async function ensureAddress(userId) {
  const existing = await pool.query("SELECT id FROM user_addresses WHERE user_id = $1 LIMIT 1", [userId]);
  if (existing.rowCount > 0) return existing.rows[0].id;
  const inserted = await pool.query(
    `INSERT INTO user_addresses (user_id, label, line1, city, state, postal_code, location, is_default)
     VALUES ($1, 'Home', 'Repeat Retest Address', 'Hyderabad', 'TS', '500001', ST_SetSRID(ST_Point(78.4869, 17.3852), 4326)::geography, TRUE)
     RETURNING id`,
    [userId]
  );
  return inserted.rows[0].id;
}

(async () => {
  const seed = String(Date.now()).slice(-7);
  const ids = {
    owner: randomUUID(),
    customer: randomUUID(),
    driver: randomUUID(),
    admin: randomUUID(),
  };

  try {
    await seedUser({ id: ids.owner, phone: `792${seed}1`, role: "SHOP_OWNER", name: "Retest Owner" });
    await seedUser({ id: ids.customer, phone: `792${seed}2`, role: "CUSTOMER", name: "Retest Customer" });
    await seedUser({ id: ids.driver, phone: `792${seed}3`, role: "DRIVER", name: "Retest Driver" });
    await seedUser({ id: ids.admin, phone: `792${seed}4`, role: "ADMIN", name: "Retest Admin" });

    await ensureAddress(ids.customer);

    const ownerToken = tokenFor({ id: ids.owner, role: "shop_owner" });
    const customerToken = tokenFor({ id: ids.customer, role: "customer" });
    const driverToken = tokenFor({ id: ids.driver, role: "driver" });

    const shop = await req("POST", "/shops", {
      token: ownerToken,
      body: {
        name: `Retest Shop ${seed}`,
        category: "grocery",
        phone: `97${seed}11`,
        lat: 17.385,
        lng: 78.4867,
      },
    });

    if (shop.status !== 201) {
      throw new Error(`shop create failed: ${shop.status}`);
    }

    const shopId = shop.body.id;

    const product = await req("POST", "/products", {
      token: ownerToken,
      body: {
        shopId,
        name: `Retest Milk ${seed}`,
        category: "dairy",
        price: 50,
        stock: 20,
      },
    });

    if (product.status !== 201) {
      throw new Error(`product create failed: ${product.status}`);
    }

    const driverProfile = await pool.query(
      `INSERT INTO drivers (user_id, name, phone, vehicle_type, vehicle_number, is_active, is_online, is_busy, lat, lng, created_at, updated_at)
       VALUES ($1, 'Retest Driver', $2, 'TWO_WHEELER', 'RETEST', TRUE, TRUE, FALSE, 17.385, 78.4867, NOW(), NOW())
       ON CONFLICT (user_id)
       DO UPDATE SET is_active = TRUE, is_online = TRUE, is_busy = FALSE, lat = 17.385, lng = 78.4867, updated_at = NOW()
       RETURNING id`,
      [ids.driver, `792${seed}3`]
    );
    const driverId = driverProfile.rows[0].id;

    const conv = await req("POST", "/conversations", {
      token: customerToken,
      body: { shopId },
    });
    const conversationId = conv.body.id || conv.body.conversationId;
    if ((conv.status !== 200 && conv.status !== 201) || !conversationId) {
      throw new Error(`conversation failed: ${conv.status}`);
    }

    const quote = await req("POST", "/quotes", {
      token: ownerToken,
      body: {
        conversationId,
        items: [{ productId: product.body.id, quantity: 1, price: 50 }],
      },
    });
    if (quote.status !== 201 || !quote.body.quoteId) {
      throw new Error(`quote failed: ${quote.status}`);
    }

    const accept = await req("POST", `/quotes/${quote.body.quoteId}/accept`, {
      token: customerToken,
      timeoutMs: 15000,
    });

    let orderId = accept.body.orderId;
    if (!orderId) {
      const fallback = await pool.query(
        `SELECT id FROM orders WHERE customer_id = $1 AND shop_id = $2 ORDER BY created_at DESC LIMIT 1`,
        [ids.customer, shopId]
      );
      if (fallback.rowCount > 0) orderId = fallback.rows[0].id;
    }

    if (!orderId) {
      throw new Error("order not found after quote accept");
    }

    await orderService.assignDriver({
      orderId,
      driverId,
      db: pool,
      redis: null,
      kafkaProducer: null,
      requireAvailable: false,
    });

    await orderService.updateOrderStatus({
      orderId,
      auth: { sub: ids.driver, role: "driver" },
      db: pool,
      redis: null,
      kafkaProducer: null,
      fromStatus: "ASSIGNED",
      toStatus: "PICKED_UP",
      actor: "driver",
    });

    await orderService.updateOrderStatus({
      orderId,
      auth: { sub: ids.driver, role: "driver" },
      db: pool,
      redis: null,
      kafkaProducer: null,
      fromStatus: "PICKED_UP",
      toStatus: "DELIVERING",
      actor: "driver",
    });

    const completed = await orderService.updateOrderStatus({
      orderId,
      auth: { sub: ids.driver, role: "driver" },
      db: pool,
      redis: null,
      kafkaProducer: null,
      fromStatus: "DELIVERING",
      toStatus: "DELIVERED",
      actor: "driver",
    });

    const stats = await pool.query(
      `SELECT shop_id, user_id, order_count, last_order_at FROM shop_customer_stats WHERE user_id = $1 ORDER BY last_order_at DESC`,
      [ids.customer]
    );

    const regular = await req("GET", "/users/regular-shops", { token: customerToken });

    console.log(
      JSON.stringify(
        {
          completedOrderStatus: completed.status,
          orderId,
          dbStatsRows: stats.rows,
          regularShopsStatus: regular.status,
          regularShopsBody: regular.body,
          pass:
            completed.status === "DELIVERED"
            && stats.rowCount > 0
            && Number(stats.rows[0].order_count) >= 1
            && regular.status === 200
            && Array.isArray(regular.body.items)
            && regular.body.items.some((x) => x.shopId === shopId && x.name && x.category),
        },
        null,
        2
      )
    );
  } catch (err) {
    console.error(JSON.stringify({ error: err.message }, null, 2));
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
