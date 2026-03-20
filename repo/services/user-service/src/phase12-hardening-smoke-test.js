/* eslint-disable no-console */
const { randomUUID } = require("crypto");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const orderService = require("../../order-service/src/order-service");

const BASE = process.env.BASE_URL || "http://localhost:8081";
const DATABASE_URL = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/hyperlocal";
const JWT_SECRET = process.env.JWT_SECRET || "devsecret";

const pool = new Pool({ connectionString: DATABASE_URL });

function tokenFor({ id, role }) {
  return jwt.sign({ sub: id, role }, JWT_SECRET, { expiresIn: "2h" });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function req(method, path, { body, token, timeoutMs = 30000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers = {};
    if (body !== undefined) {
      headers["content-type"] = "application/json";
    }
    if (token) {
      headers.authorization = `Bearer ${token}`;
    }

    const response = await fetch(BASE + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const text = await response.text();
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch (_err) {
      parsed = { raw: text };
    }

    return { status: response.status, body: parsed };
  } finally {
    clearTimeout(timer);
  }
}

async function seedUser({ id, phone, role, name }) {
  await pool.query(
    `
      INSERT INTO users (id, phone, full_name, role, is_active, created_at, updated_at)
      VALUES ($1, $2, $3, $4::user_role, TRUE, NOW(), NOW())
      ON CONFLICT (id)
      DO UPDATE SET phone = EXCLUDED.phone, full_name = EXCLUDED.full_name, role = EXCLUDED.role, updated_at = NOW()
    `,
    [id, phone, name, role]
  );
}

async function ensureAddress(userId) {
  const existing = await pool.query(
    `SELECT id FROM user_addresses WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC LIMIT 1`,
    [userId]
  );

  if (existing.rowCount > 0) {
    return existing.rows[0].id;
  }

  const inserted = await pool.query(
    `
      INSERT INTO user_addresses (user_id, label, line1, city, state, postal_code, location, is_default)
      VALUES ($1, 'Home', 'P12 Hardening Address', 'Hyderabad', 'TS', '500001', ST_SetSRID(ST_Point(78.4869, 17.3852), 4326)::geography, TRUE)
      RETURNING id
    `,
    [userId]
  );

  return inserted.rows[0].id;
}

(async () => {
  const seed = String(Date.now()).slice(-7);
  const ids = {
    ownerA: randomUUID(),
    ownerB: randomUUID(),
    customer: randomUUID(),
    customerNoOrders: randomUUID(),
    customerNoFavorites: randomUUID(),
  };

  const phones = {
    ownerA: `789${seed}1`,
    ownerB: `789${seed}2`,
    customer: `789${seed}3`,
    customerNoOrders: `789${seed}4`,
    customerNoFavorites: `789${seed}5`,
  };

  const checks = {
    duplicateFavoriteNoDuplicateRow: false,
    deleteFavoriteRemoved: false,
    cancelledOrderNoStatsUpdate: false,
    noFavoritesSearchWorks: false,
    noOrdersRegularShopsEmpty: false,
  };

  try {
    await seedUser({ id: ids.ownerA, phone: phones.ownerA, role: "SHOP_OWNER", name: "Hardening Owner A" });
    await seedUser({ id: ids.ownerB, phone: phones.ownerB, role: "SHOP_OWNER", name: "Hardening Owner B" });
    await seedUser({ id: ids.customer, phone: phones.customer, role: "CUSTOMER", name: "Hardening Customer" });
    await seedUser({ id: ids.customerNoOrders, phone: phones.customerNoOrders, role: "CUSTOMER", name: "No Orders Customer" });
    await seedUser({ id: ids.customerNoFavorites, phone: phones.customerNoFavorites, role: "CUSTOMER", name: "No Favorites Customer" });

    const ownerAToken = tokenFor({ id: ids.ownerA, role: "shop_owner" });
    const ownerBToken = tokenFor({ id: ids.ownerB, role: "shop_owner" });
    const customerToken = tokenFor({ id: ids.customer, role: "customer" });
    const customerNoOrdersToken = tokenFor({ id: ids.customerNoOrders, role: "customer" });
    const customerNoFavoritesToken = tokenFor({ id: ids.customerNoFavorites, role: "customer" });

    const customerAddressId = await ensureAddress(ids.customer);

    const shopA = await req("POST", "/shops", {
      token: ownerAToken,
      body: {
        name: `P12 Hardening Shop A ${seed}`,
        category: "grocery",
        phone: `97${seed}01`,
        lat: 17.385,
        lng: 78.4867,
      },
    });

    const shopB = await req("POST", "/shops", {
      token: ownerBToken,
      body: {
        name: `P12 Hardening Shop B ${seed}`,
        category: "grocery",
        phone: `97${seed}02`,
        lat: 17.386,
        lng: 78.487,
      },
    });

    if (shopA.status !== 201 || shopB.status !== 201) {
      throw new Error(`shop creation failed: ${shopA.status}/${shopB.status}`);
    }

    const shopAId = shopA.body.id;
    const shopBId = shopB.body.id;

    const prodA = await req("POST", "/products", {
      token: ownerAToken,
      body: {
        shopId: shopAId,
        name: `P12 Hardening Milk ${seed}`,
        category: "dairy",
        price: 50,
        stock: 20,
      },
    });

    if (prodA.status !== 201) {
      throw new Error(`product creation failed: ${prodA.status}`);
    }

    await sleep(2000);

    // 1) Add same favorite twice -> no duplicate
    const fav1 = await req("POST", `/users/favorites/${shopBId}`, { token: customerToken });
    const fav2 = await req("POST", `/users/favorites/${shopBId}`, { token: customerToken });
    const favoriteCount = await pool.query(
      `SELECT COUNT(*)::int AS c FROM favorite_shops WHERE user_id = $1 AND shop_id = $2`,
      [ids.customer, shopBId]
    );
    checks.duplicateFavoriteNoDuplicateRow = fav1.status === 200
      && fav2.status === 200
      && favoriteCount.rows[0].c === 1;

    // 2) Delete favorite -> removed
    const del = await req("DELETE", `/users/favorites/${shopBId}`, { token: customerToken });
    const listAfterDelete = await req("GET", "/users/favorites", { token: customerToken });
    const existsAfterDelete = (listAfterDelete.body.items || []).some((x) => x.shopId === shopBId);
    checks.deleteFavoriteRemoved = del.status === 200 && !existsAfterDelete;

    // 3) Cancel order -> stats not updated
    const beforeStats = await pool.query(
      `SELECT order_count FROM shop_customer_stats WHERE shop_id = $1 AND user_id = $2 LIMIT 1`,
      [shopAId, ids.customer]
    );
    const beforeCount = beforeStats.rowCount > 0 ? Number(beforeStats.rows[0].order_count) : 0;

    const insertedOrder = await pool.query(
      `
        INSERT INTO orders (
          customer_id,
          shop_id,
          delivery_address_id,
          status,
          subtotal,
          delivery_fee,
          platform_fee,
          discount_total,
          grand_total,
          created_at,
          updated_at
        ) VALUES (
          $1,
          $2,
          $3,
          'CREATED',
          50,
          10,
          0,
          0,
          60,
          NOW(),
          NOW()
        )
        RETURNING id
      `,
      [ids.customer, shopAId, customerAddressId]
    );

    await orderService.updateOrderStatus({
      orderId: insertedOrder.rows[0].id,
      auth: { sub: ids.ownerA, role: "shop_owner" },
      db: pool,
      redis: null,
      kafkaProducer: null,
      fromStatus: "CREATED",
      toStatus: "CANCELLED",
      actor: "shop",
    });

    const afterStats = await pool.query(
      `SELECT order_count FROM shop_customer_stats WHERE shop_id = $1 AND user_id = $2 LIMIT 1`,
      [shopAId, ids.customer]
    );
    const afterCount = afterStats.rowCount > 0 ? Number(afterStats.rows[0].order_count) : 0;
    checks.cancelledOrderNoStatsUpdate = beforeCount === afterCount;

    // 4) No favorites -> search works
    const search = await req(
      "GET",
      `/search/shops?q=${encodeURIComponent(`P12 Hardening Milk ${seed}`)}&lat=17.385&lng=78.4867&radius=5000`,
      { token: customerNoFavoritesToken }
    );
    checks.noFavoritesSearchWorks = search.status === 200 && Array.isArray(search.body.items) && search.body.items.length > 0;

    // 5) No orders -> regular shops empty
    const regularNoOrders = await req("GET", "/users/regular-shops", { token: customerNoOrdersToken });
    checks.noOrdersRegularShopsEmpty = regularNoOrders.status === 200
      && Array.isArray(regularNoOrders.body.items)
      && regularNoOrders.body.items.length === 0;

    const ok = Object.values(checks).every(Boolean);
    console.log(JSON.stringify({ status: ok ? "PASS" : "FAIL", checks }, null, 2));
    process.exit(ok ? 0 : 1);
  } catch (err) {
    console.error(JSON.stringify({ status: "FAIL", error: err.message, checks }, null, 2));
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
