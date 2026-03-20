/* eslint-disable no-console */
const { randomUUID } = require("crypto");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");

const BASE = process.env.BASE_URL || "http://localhost:8081";
const DATABASE_URL = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/hyperlocal";
const JWT_SECRET = process.env.JWT_SECRET || "devsecret";

const pool = new Pool({ connectionString: DATABASE_URL });

function tokenFor({ id, role }) {
  return jwt.sign({ sub: id, role }, JWT_SECRET, { expiresIn: "2h" });
}

function nowMs() {
  return Number(process.hrtime.bigint() / BigInt(1e6));
}

function percentile(arr, p) {
  if (arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1);
  return s[idx];
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function req(method, path, { body, token, timeoutMs = 12000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = nowMs();
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
    } catch (_e) {
      parsed = { raw: text };
    }
    return { ok: true, status: res.status, body: parsed, latencyMs: nowMs() - started };
  } catch (err) {
    return { ok: false, status: 0, body: { error: err.message }, latencyMs: nowMs() - started };
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
  const e = await pool.query("SELECT id FROM user_addresses WHERE user_id = $1 LIMIT 1", [userId]);
  if (e.rowCount > 0) return e.rows[0].id;
  const i = await pool.query(
    `INSERT INTO user_addresses (user_id, label, line1, city, state, postal_code, location, is_default)
     VALUES ($1, 'Home', 'Final Verify Address', 'Hyderabad', 'TS', '500001', ST_SetSRID(ST_Point(78.4869, 17.3852), 4326)::geography, TRUE)
     RETURNING id`,
    [userId]
  );
  return i.rows[0].id;
}

(async () => {
  const seed = String(Date.now()).slice(-7);
  const ids = {
    ownerA: randomUUID(), ownerB: randomUUID(), customer: randomUUID(), driver: randomUUID(), admin: randomUUID(),
    noFav: randomUUID(), noOrders: randomUUID(),
  };

  const phones = {
    ownerA: `791${seed}1`, ownerB: `791${seed}2`, customer: `791${seed}3`, driver: `791${seed}4`, admin: `791${seed}5`,
    noFav: `791${seed}6`, noOrders: `791${seed}7`,
  };

  const out = {
    favorites: "FAIL",
    repeatTracking: "FAIL",
    regularShops: "FAIL",
    rankingBoost: "FAIL",
    edgeCases: "FAIL",
    overall: "FAIL",
  };

  const notes = {
    step2Status: null,
    step2NoDistance: false,
    step2DeliveryTag: false,
    latencyAvgMs: null,
    latencyP95Ms: null,
    latencyUnder100ms: false,
    arraysNotNull: false,
  };

  try {
    await seedUser({ id: ids.ownerA, phone: phones.ownerA, role: "SHOP_OWNER", name: "Owner A" });
    await seedUser({ id: ids.ownerB, phone: phones.ownerB, role: "SHOP_OWNER", name: "Owner B" });
    await seedUser({ id: ids.customer, phone: phones.customer, role: "CUSTOMER", name: "Customer" });
    await seedUser({ id: ids.driver, phone: phones.driver, role: "DRIVER", name: "Driver" });
    await seedUser({ id: ids.admin, phone: phones.admin, role: "ADMIN", name: "Admin" });
    await seedUser({ id: ids.noFav, phone: phones.noFav, role: "CUSTOMER", name: "NoFav" });
    await seedUser({ id: ids.noOrders, phone: phones.noOrders, role: "CUSTOMER", name: "NoOrders" });

    const ownerAToken = tokenFor({ id: ids.ownerA, role: "shop_owner" });
    const ownerBToken = tokenFor({ id: ids.ownerB, role: "shop_owner" });
    const customerToken = tokenFor({ id: ids.customer, role: "customer" });
    const driverToken = tokenFor({ id: ids.driver, role: "driver" });
    const adminToken = tokenFor({ id: ids.admin, role: "admin" });
    const noFavToken = tokenFor({ id: ids.noFav, role: "customer" });
    const noOrdersToken = tokenFor({ id: ids.noOrders, role: "customer" });

    const addrId = await ensureAddress(ids.customer);

    const shopA = await req("POST", "/shops", { token: ownerAToken, body: { name: `Final Shop A ${seed}`, category: "grocery", phone: `99${seed}01`, lat: 17.385, lng: 78.4867 } });
    const shopB = await req("POST", "/shops", { token: ownerBToken, body: { name: `Final Shop B ${seed}`, category: "grocery", phone: `99${seed}02`, lat: 17.386, lng: 78.487 } });
    if (shopA.status !== 201 || shopB.status !== 201) {
      console.log(JSON.stringify({ result: out, notes, error: "shop setup failed" }, null, 2));
      process.exit(1);
    }
    const shopAId = shopA.body.id;
    const shopBId = shopB.body.id;

    const prodA = await req("POST", "/products", { token: ownerAToken, body: { shopId: shopAId, name: "milk", category: "dairy", price: 50, stock: 30 } });
    await req("POST", "/products", { token: ownerBToken, body: { shopId: shopBId, name: "milk", category: "dairy", price: 49, stock: 30 } });

    await sleep(2000);

    // Step 2 + baseline ranking
    const s0 = await req("GET", "/search/shops?q=milk&lat=17.385&lng=78.4867", { token: customerToken });
    const items0 = s0.body.items || [];
    notes.step2Status = s0.status;
    notes.step2NoDistance = s0.status === 200 && Array.isArray(items0) && items0.every((x) => x.distance === undefined && x.distanceMeters === undefined);
    notes.step2DeliveryTag = s0.status === 200 && Array.isArray(items0) && items0.length > 0 && items0.every((x) => x.deliveryTag !== undefined);
    const topBefore = items0[0]?.shopId || null;

    // Favorites flow
    const favAdd1 = await req("POST", `/users/favorites/${shopBId}`, { token: customerToken });
    const favAdd2 = await req("POST", `/users/favorites/${shopBId}`, { token: customerToken });
    const favList = await req("GET", "/users/favorites", { token: customerToken });
    const favRows = (favList.body.items || []).filter((x) => x.shopId === shopBId).length;
    out.favorites = favAdd1.status === 200 && favAdd2.status === 200 && favList.status === 200 && favRows === 1 ? "PASS" : "FAIL";

    // Ranking boost after favorite
    const s1 = await req("GET", "/search/shops?q=milk&lat=17.385&lng=78.4867", { token: customerToken });
    const topAfterFav = (s1.body.items || [])[0]?.shopId || null;
    out.rankingBoost = topBefore && topAfterFav === shopBId ? "PASS" : "FAIL";

    // Repeat flow via APIs
    let repeatOk = false;
    const driverLoc = await req("POST", "/drivers/location", { token: driverToken, body: { lat: 17.385, lng: 78.4867 } });
    if (driverLoc.status === 200 && driverLoc.body.driverId) {
      const conv = await req("POST", "/conversations", { token: customerToken, body: { shopId: shopAId } });
      const convId = conv.body?.id || conv.body?.conversationId;
      if ((conv.status === 200 || conv.status === 201) && convId) {
        const quote = await req("POST", "/quotes", { token: ownerAToken, body: { conversationId: convId, items: [{ productId: prodA.body.id, quantity: 1, price: 50 }] } });
        if (quote.status === 201 && quote.body.quoteId) {
          const accept = await req("POST", `/quotes/${quote.body.quoteId}/accept`, { token: customerToken });
          let orderId = accept.body?.orderId;
          if (!orderId) {
            const fb = await pool.query(
              `SELECT id FROM orders WHERE customer_id = $1 AND shop_id = $2 ORDER BY created_at DESC LIMIT 1`,
              [ids.customer, shopAId]
            );
            if (fb.rowCount > 0) orderId = fb.rows[0].id;
          }
          if (orderId) {
            await req("POST", `/orders/${orderId}/assign-driver`, { token: adminToken, body: { driverId: driverLoc.body.driverId } });
            await req("POST", `/orders/${orderId}/pickup`, { token: driverToken });
            await req("POST", `/orders/${orderId}/start-delivery`, { token: driverToken });
            const done = await req("POST", `/orders/${orderId}/complete`, { token: driverToken });
            const ord = await req("GET", `/orders/${orderId}`, { token: customerToken });
            repeatOk = done.status === 200 || (ord.status === 200 && ord.body.status === "DELIVERED");

            const st = await pool.query("SELECT order_count,last_order_at FROM shop_customer_stats WHERE shop_id = $1 AND user_id = $2 LIMIT 1", [shopAId, ids.customer]);
            repeatOk = repeatOk && st.rowCount === 1 && Number(st.rows[0].order_count) >= 1 && Boolean(st.rows[0].last_order_at);
          }
        }
      }
    }
    out.repeatTracking = repeatOk ? "PASS" : "FAIL";

    // Regular shops
    const regular = await req("GET", "/users/regular-shops", { token: customerToken });
    out.regularShops = regular.status === 200 && Array.isArray(regular.body.items) && regular.body.items.some((x) => x.shopId === shopAId) ? "PASS" : "FAIL";

    // Edge cases
    const removeFav = await req("DELETE", `/users/favorites/${shopBId}`, { token: customerToken });
    const afterRemove = await req("GET", "/users/favorites", { token: customerToken });
    const removed = removeFav.status === 200 && Array.isArray(afterRemove.body.items) && !afterRemove.body.items.some((x) => x.shopId === shopBId);

    const beforeCancel = await pool.query("SELECT COALESCE(MAX(order_count),0)::int AS c FROM shop_customer_stats WHERE shop_id = $1 AND user_id = $2", [shopAId, ids.customer]);
    const cancelOrder = await pool.query(
      `INSERT INTO orders (customer_id, shop_id, delivery_address_id, status, subtotal, delivery_fee, platform_fee, discount_total, grand_total, created_at, updated_at)
       VALUES ($1,$2,$3,'CANCELLED',50,10,0,0,60,NOW(),NOW()) RETURNING id`,
      [ids.customer, shopAId, addrId]
    );
    const afterCancel = await pool.query("SELECT COALESCE(MAX(order_count),0)::int AS c FROM shop_customer_stats WHERE shop_id = $1 AND user_id = $2", [shopAId, ids.customer]);
    const cancelNoStats = Number(afterCancel.rows[0].c) === Number(beforeCancel.rows[0].c);

    const sNoFav = await req("GET", "/search/shops?q=milk&lat=17.385&lng=78.4867", { token: noFavToken });
    const regularEmpty = await req("GET", "/users/regular-shops", { token: noOrdersToken });

    notes.arraysNotNull = Array.isArray(favList.body.items)
      && Array.isArray(afterRemove.body.items)
      && Array.isArray(regular.body.items)
      && Array.isArray(regularEmpty.body.items)
      && Array.isArray(sNoFav.body.items);

    out.edgeCases = favRows === 1 && removed && cancelNoStats && sNoFav.status === 200 && regularEmpty.status === 200 && regularEmpty.body.items.length === 0 && notes.arraysNotNull ? "PASS" : "FAIL";

    // Performance search <100ms
    const lats = [];
    for (let i = 0; i < 8; i += 1) {
      const s = await req("GET", "/search/shops?q=milk&lat=17.385&lng=78.4867", { token: customerToken, timeoutMs: 8000 });
      if (s.status === 200) lats.push(s.latencyMs);
    }
    if (lats.length > 0) {
      notes.latencyAvgMs = Math.round(lats.reduce((a, b) => a + b, 0) / lats.length);
      notes.latencyP95Ms = percentile(lats, 95);
      notes.latencyUnder100ms = notes.latencyP95Ms < 100;
    }

    const functional = [out.favorites, out.repeatTracking, out.regularShops, out.rankingBoost, out.edgeCases].every((x) => x === "PASS");
    out.overall = functional && notes.step2Status === 200 && notes.step2NoDistance && notes.step2DeliveryTag && notes.latencyUnder100ms ? "PASS" : "FAIL";

    console.log(JSON.stringify({ result: out, notes }, null, 2));
    process.exit(out.overall === "PASS" ? 0 : 1);
  } catch (err) {
    console.error(JSON.stringify({ result: out, notes, error: err.message }, null, 2));
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
