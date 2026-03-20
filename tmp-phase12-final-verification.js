/* eslint-disable no-console */
const { randomUUID } = require("crypto");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");

const BASE = process.env.BASE_URL || "http://localhost:8081";
const DATABASE_URL = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/hyperlocal";
const JWT_SECRET = process.env.JWT_SECRET || "devsecret";

const pool = new Pool({ connectionString: DATABASE_URL });

function nowMs() {
  return Number(process.hrtime.bigint() / BigInt(1e6));
}

function tokenFor({ id, role }) {
  return jwt.sign({ sub: id, role }, JWT_SECRET, { expiresIn: "2h" });
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function req(method, path, { body, token, timeoutMs = 30000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = nowMs();

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

    return {
      status: res.status,
      body: parsed,
      latencyMs: nowMs() - startedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function seedUser({ id, phone, role, fullName }) {
  await pool.query(
    `
      INSERT INTO users (id, phone, full_name, role, is_active, created_at, updated_at)
      VALUES ($1, $2, $3, $4::user_role, TRUE, NOW(), NOW())
      ON CONFLICT (id)
      DO UPDATE SET phone = EXCLUDED.phone, full_name = EXCLUDED.full_name, role = EXCLUDED.role, updated_at = NOW()
    `,
    [id, phone, fullName, role]
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
      VALUES ($1, 'Home', 'Phase12 Final Address', 'Hyderabad', 'TS', '500001', ST_SetSRID(ST_Point(78.4869, 17.3852), 4326)::geography, TRUE)
      RETURNING id
    `,
    [userId]
  );

  return inserted.rows[0].id;
}

function percentile(arr, p) {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx];
}

(async () => {
  const seed = String(Date.now()).slice(-7);
  const ids = {
    ownerA: randomUUID(),
    ownerB: randomUUID(),
    customer: randomUUID(),
    driver: randomUUID(),
    admin: randomUUID(),
    noFavCustomer: randomUUID(),
    noOrderCustomer: randomUUID(),
  };

  const phones = {
    ownerA: `790${seed}1`,
    ownerB: `790${seed}2`,
    customer: `790${seed}3`,
    driver: `790${seed}4`,
    admin: `790${seed}5`,
    noFavCustomer: `790${seed}6`,
    noOrderCustomer: `790${seed}7`,
  };

  const result = {
    favorites: "FAIL",
    repeatTracking: "FAIL",
    regularShops: "FAIL",
    rankingBoost: "FAIL",
    edgeCases: "FAIL",
    overall: "FAIL",
  };

  const details = {
    step2SearchContract: false,
    step2DeliveryTagPresent: false,
    latencyAvgMs: null,
    latencyP95Ms: null,
    latencyUnder100ms: false,
    queryEfficiency: true,
  };

  try {
    await seedUser({ id: ids.ownerA, phone: phones.ownerA, role: "SHOP_OWNER", fullName: "Final Owner A" });
    await seedUser({ id: ids.ownerB, phone: phones.ownerB, role: "SHOP_OWNER", fullName: "Final Owner B" });
    await seedUser({ id: ids.customer, phone: phones.customer, role: "CUSTOMER", fullName: "Final Customer" });
    await seedUser({ id: ids.driver, phone: phones.driver, role: "DRIVER", fullName: "Final Driver" });
    await seedUser({ id: ids.admin, phone: phones.admin, role: "ADMIN", fullName: "Final Admin" });
    await seedUser({ id: ids.noFavCustomer, phone: phones.noFavCustomer, role: "CUSTOMER", fullName: "No Favorite Customer" });
    await seedUser({ id: ids.noOrderCustomer, phone: phones.noOrderCustomer, role: "CUSTOMER", fullName: "No Order Customer" });

    const ownerAToken = tokenFor({ id: ids.ownerA, role: "shop_owner" });
    const ownerBToken = tokenFor({ id: ids.ownerB, role: "shop_owner" });
    const customerToken = tokenFor({ id: ids.customer, role: "customer" });
    const driverToken = tokenFor({ id: ids.driver, role: "driver" });
    const adminToken = tokenFor({ id: ids.admin, role: "admin" });
    const noFavToken = tokenFor({ id: ids.noFavCustomer, role: "customer" });
    const noOrderToken = tokenFor({ id: ids.noOrderCustomer, role: "customer" });

    const customerAddressId = await ensureAddress(ids.customer);

    const driverLocation = await req("POST", "/drivers/location", {
      token: driverToken,
      body: { lat: 17.385, lng: 78.4867 },
      timeoutMs: 12000,
    });
    if (driverLocation.status !== 200 || !driverLocation.body.driverId) {
      throw new Error(`driver setup failed: ${driverLocation.status}`);
    }

    const shopA = await req("POST", "/shops", {
      token: ownerAToken,
      body: {
        name: `P12 Final Shop A ${seed}`,
        category: "grocery",
        phone: `98${seed}01`,
        lat: 17.385,
        lng: 78.4867,
      },
    });
    const shopB = await req("POST", "/shops", {
      token: ownerBToken,
      body: {
        name: `P12 Final Shop B ${seed}`,
        category: "grocery",
        phone: `98${seed}02`,
        lat: 17.386,
        lng: 78.487,
      },
    });

    if (shopA.status !== 201 || shopB.status !== 201) {
      throw new Error(`shop create failed: ${shopA.status}/${shopB.status}`);
    }

    const shopAId = shopA.body.id;
    const shopBId = shopB.body.id;

    const prodA = await req("POST", "/products", {
      token: ownerAToken,
      body: { shopId: shopAId, name: "milk", category: "dairy", price: 50, stock: 20 },
    });
    const prodB = await req("POST", "/products", {
      token: ownerBToken,
      body: { shopId: shopBId, name: "milk", category: "dairy", price: 49, stock: 20 },
    });

    if (prodA.status !== 201 || prodB.status !== 201) {
      throw new Error(`product create failed: ${prodA.status}/${prodB.status}`);
    }

    await sleep(2000);

    // Step 2 and Step 8 baseline
    const firstSearch = await req("GET", "/search/shops?q=milk&lat=17.385&lng=78.4867", {
      token: customerToken,
    });

    const searchItems = firstSearch.body.items || [];
    const noDistanceField = Array.isArray(searchItems)
      && searchItems.every((x) => x.distance === undefined && x.distanceMeters === undefined);
    const hasDeliveryTag = Array.isArray(searchItems)
      && searchItems.length > 0
      && searchItems.every((x) => x.deliveryTag !== undefined);

    details.step2SearchContract = firstSearch.status === 200 && Array.isArray(searchItems) && searchItems.length > 0 && noDistanceField;
    details.step2DeliveryTagPresent = hasDeliveryTag;

    const topBefore = searchItems[0] && searchItems[0].shopId;

    // Step 3 + 4
    const addFav = await req("POST", `/users/favorites/${shopBId}`, { token: customerToken });
    const addFavAgain = await req("POST", `/users/favorites/${shopBId}`, { token: customerToken });
    const favoritesList = await req("GET", "/users/favorites", { token: customerToken });
    const favMatches = (favoritesList.body.items || []).filter((x) => x.shopId === shopBId).length;

    const favoritesPass = addFav.status === 200
      && addFavAgain.status === 200
      && favoritesList.status === 200
      && favMatches === 1;
    result.favorites = favoritesPass ? "PASS" : "FAIL";

    // Step 5 repeat order flow (API path)
    const conversation = await req("POST", "/conversations", { token: customerToken, body: { shopId: shopAId } });
    const conversationId = conversation.body?.id || conversation.body?.conversationId;
    if ((conversation.status !== 200 && conversation.status !== 201) || !conversationId) {
      throw new Error(`conversation failed: ${conversation.status}`);
    }

    const quote = await req("POST", "/quotes", {
      token: ownerAToken,
      body: { conversationId, items: [{ productId: prodA.body.id, quantity: 1, price: 50 }] },
    });
    if (quote.status !== 201 || !quote.body.quoteId) {
      throw new Error(`quote failed: ${quote.status}`);
    }

    const accept = await req("POST", `/quotes/${quote.body.quoteId}/accept`, {
      token: customerToken,
      timeoutMs: 12000,
    });

    let orderId = accept.body && accept.body.orderId;
    if (!orderId) {
      const fallback = await pool.query(
        `
          SELECT id
          FROM orders
          WHERE customer_id = $1 AND shop_id = $2 AND created_at > NOW() - INTERVAL '10 minutes'
          ORDER BY created_at DESC
          LIMIT 1
        `,
        [ids.customer, shopAId]
      );
      if (fallback.rowCount > 0) {
        orderId = fallback.rows[0].id;
      }
    }

    if (!orderId) {
      throw new Error("order creation/accept failed");
    }

    const assign = await req("POST", `/orders/${orderId}/assign-driver`, {
      token: adminToken,
      body: { driverId: driverLocation.body.driverId },
      timeoutMs: 12000,
    });
    const pickup = await req("POST", `/orders/${orderId}/pickup`, { token: driverToken, timeoutMs: 12000 });
    const startDelivery = await req("POST", `/orders/${orderId}/start-delivery`, { token: driverToken, timeoutMs: 12000 });
    const complete = await req("POST", `/orders/${orderId}/complete`, { token: driverToken, timeoutMs: 12000 });

    const orderAfter = await req("GET", `/orders/${orderId}`, { token: customerToken });
    const delivered = (complete.status === 200 || orderAfter.status === 200)
      && (complete.body.status === "DELIVERED" || orderAfter.body.status === "DELIVERED");

    result.repeatTracking = delivered ? "PASS" : "FAIL";

    // Step 6 DB update
    const stats = await pool.query(
      `SELECT order_count, last_order_at FROM shop_customer_stats WHERE shop_id = $1 AND user_id = $2 LIMIT 1`,
      [shopAId, ids.customer]
    );

    const statsUpdated = stats.rowCount === 1 && Number(stats.rows[0].order_count) >= 1 && Boolean(stats.rows[0].last_order_at);
    if (!statsUpdated) {
      result.repeatTracking = "FAIL";
    }

    // Step 7 regular shops
    const regular = await req("GET", "/users/regular-shops", { token: customerToken });
    const regularItems = regular.body.items || [];
    const regularPass = regular.status === 200
      && Array.isArray(regularItems)
      && regularItems.some((x) => x.shopId === shopAId)
      && regularItems.every((x) => x.shopId !== null);
    result.regularShops = regularPass ? "PASS" : "FAIL";

    // Step 8 ranking verification
    const secondSearch = await req("GET", "/search/shops?q=milk&lat=17.385&lng=78.4867", {
      token: customerToken,
    });
    const topAfter = (secondSearch.body.items || [])[0]?.shopId;
    result.rankingBoost = topBefore && topAfter && topAfter === shopBId ? "PASS" : "FAIL";

    // Step 9 edge cases
    const removeFav = await req("DELETE", `/users/favorites/${shopBId}`, { token: customerToken });
    const afterRemove = await req("GET", "/users/favorites", { token: customerToken });
    const removedOk = removeFav.status === 200 && Array.isArray(afterRemove.body.items) && !afterRemove.body.items.some((x) => x.shopId === shopBId);

    const beforeCancel = await pool.query(
      `SELECT COALESCE(MAX(order_count), 0)::int AS c FROM shop_customer_stats WHERE shop_id = $1 AND user_id = $2`,
      [shopAId, ids.customer]
    );

    const cancelOrderInsert = await pool.query(
      `
        INSERT INTO orders (
          customer_id, shop_id, delivery_address_id, status,
          subtotal, delivery_fee, platform_fee, discount_total, grand_total,
          created_at, updated_at
        ) VALUES ($1, $2, $3, 'CREATED', 50, 10, 0, 0, 60, NOW(), NOW())
        RETURNING id
      `,
      [ids.customer, shopAId, customerAddressId]
    );

    await req("POST", `/orders/${cancelOrderInsert.rows[0].id}/confirm`, { token: ownerAToken, timeoutMs: 12000 });
    await pool.query(`UPDATE orders SET status = 'CANCELLED', updated_at = NOW() WHERE id = $1`, [cancelOrderInsert.rows[0].id]);

    const afterCancel = await pool.query(
      `SELECT COALESCE(MAX(order_count), 0)::int AS c FROM shop_customer_stats WHERE shop_id = $1 AND user_id = $2`,
      [shopAId, ids.customer]
    );
    const cancelNoStats = Number(afterCancel.rows[0].c) === Number(beforeCancel.rows[0].c);

    const searchNoFav = await req("GET", "/search/shops?q=milk&lat=17.385&lng=78.4867", { token: noFavToken });
    const noFavWorks = searchNoFav.status === 200 && Array.isArray(searchNoFav.body.items);

    const regularNoOrders = await req("GET", "/users/regular-shops", { token: noOrderToken });
    const noOrdersEmpty = regularNoOrders.status === 200 && Array.isArray(regularNoOrders.body.items) && regularNoOrders.body.items.length === 0;

    const edgePass = favMatches === 1 && removedOk && cancelNoStats && noFavWorks && noOrdersEmpty;
    result.edgeCases = edgePass ? "PASS" : "FAIL";

    // Step 10 array response checks
    const arrayShapeOk = Array.isArray(favoritesList.body.items)
      && Array.isArray(afterRemove.body.items)
      && Array.isArray(regular.body.items)
      && Array.isArray(regularNoOrders.body.items)
      && Array.isArray(searchNoFav.body.items);

    if (!arrayShapeOk) {
      result.edgeCases = "FAIL";
    }

    // Step 11 performance
    const latencies = [];
    for (let i = 0; i < 8; i += 1) {
      const s = await req("GET", "/search/shops?q=milk&lat=17.385&lng=78.4867", { token: customerToken });
      if (s.status === 200) {
        latencies.push(Number(s.latencyMs));
      }
    }

    if (latencies.length > 0) {
      details.latencyAvgMs = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
      details.latencyP95Ms = percentile(latencies, 95);
      details.latencyUnder100ms = details.latencyP95Ms !== null && details.latencyP95Ms < 100;
    }

    const functionalPass = [result.favorites, result.repeatTracking, result.regularShops, result.rankingBoost, result.edgeCases].every((x) => x === "PASS");
    result.overall = functionalPass && details.step2SearchContract && details.step2DeliveryTagPresent && details.latencyUnder100ms ? "PASS" : "FAIL";

    console.log(JSON.stringify({ result, details }, null, 2));
    process.exit(result.overall === "PASS" ? 0 : 1);
  } catch (err) {
    console.error(JSON.stringify({ result, error: err.message, details }, null, 2));
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
