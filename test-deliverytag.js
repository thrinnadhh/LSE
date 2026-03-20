#!/usr/bin/env node
/* Quick test for deliveryTag */
const { Pool } = require("pg");
const jwt = require("jsonwebtoken");
const { randomUUID } = require("crypto");

const BASE = process.env.BASE_URL || "http://localhost:8081";
const DATABASE_URL = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/hyperlocal";
const JWT_SECRET = process.env.JWT_SECRET || "devsecret";

const pool = new Pool({ connectionString: DATABASE_URL });

function tokenFor({ id, role }) {
  return jwt.sign({ sub: id, role }, JWT_SECRET, { expiresIn: "2h" });
}

async function req(method, path, { body, token } = {}) {
  const started = Date.now();
  try {
    const headers = {};
    if (body) headers["content-type"] = "application/json";
    if (token) headers.authorization = `Bearer ${token}`;

    const res = await fetch(BASE + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const parsed = text ? JSON.parse(text) : {};
    return { ok: true, status: res.status, body: parsed, latencyMs: Date.now() - started };
  } catch (err) {
    console.error("Request error:", err.message);
    return { ok: false, status: 0, body: { error: err.message }, latencyMs: Date.now() - started };
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
     VALUES ($1, 'Home', 'Test', 'Hyderabad', 'TS', '500001', ST_SetSRID(ST_Point(78.4869, 17.3852), 4326)::geography, TRUE)
     RETURNING id`,
    [userId]
  );
  return i.rows[0].id;
}

(async () => {
  try {
    console.log("Creating test users...");
    const ownerId = randomUUID();
    const customerId = randomUUID();
    const seed = String(Date.now()).slice(-5);

    await seedUser({ id: ownerId, phone: `991${seed}1`, role: "SHOP_OWNER", name: "Owner" });
    await seedUser({ id: customerId, phone: `991${seed}2`, role: "CUSTOMER", name: "Customer" });

    const ownerToken = tokenFor({ id: ownerId, role: "shop_owner" });
    const customerToken = tokenFor({ id: customerId, role: "customer" });

    await ensureAddress(customerId);

    console.log("Creating shop...");
    const shopRes = await req("POST", "/shops", {
      token: ownerToken,
      body: { name: `Test Shop ${seed}`, category: "grocery", phone: `99${seed}01`, lat: 17.385, lng: 78.4867 }
    });
    console.log(`Shop creation: ${shopRes.status}`);
    if (shopRes.status !== 201) {
      console.error("Shop creation failed:", shopRes.body);
      process.exit(1);
    }
    const shopId = shopRes.body.id;

    console.log("Creating product...");
    const prodRes = await req("POST", "/products", {
      token: ownerToken,
      body: { shopId, name: "test milk", category: "dairy", price: 50, stock: 30 }
    });
    console.log(`Product creation: ${prodRes.status}`);

    console.log("Waiting for indexing...");
    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log("Searching...");
    const searchRes = await req("GET", `/search/shops?q=milk&lat=17.385&lng=78.4867&radius=5000`, {
      token: customerToken
    });
    console.log(`Search status: ${searchRes.status}`);
    console.log(`Search response:`, JSON.stringify(searchRes.body, null, 2));

    if (searchRes.body.items && searchRes.body.items.length > 0) {
      const first = searchRes.body.items[0];
      console.log("\nFirst item keys:", Object.keys(first));
      console.log("Has deliveryTag?", "deliveryTag" in first);
      if ("deliveryTag" in first) {
        console.log("deliveryTag value:", first.deliveryTag);
        console.log("\n✓ SUCCESS: deliveryTag is present!");
      } else {
        console.log("\n✗ FAIL: deliveryTag is missing!");
      }
    } else {
      console.log("\nNo items returned in search");
    }

    await pool.end();
  } catch (err) {
    console.error("Fatal error:", err);
    process.exit(1);
  }
})();
