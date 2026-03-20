#!/usr/bin/env node
/* Phase 13 Homepage + Discovery Layer Test */
const { randomUUID } = require("crypto");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");

const BASE = "http://localhost:8080";
const DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/hyperlocal";
const JWT_SECRET = "devsecret";

const pool = new Pool({ connectionString: DATABASE_URL });

function tokenFor({ id, role }) {
  return jwt.sign({ sub: id, role }, JWT_SECRET, { expiresIn: "2h" });
}

async function req(method, path, { body, token } = {}) {
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
    return { ok: true, status: res.status, body: parsed };
  } catch (err) {
    return { ok: false, status: 0, body: { error: err.message } };
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

(async () => {
  const result = {
    "Homepage API": "FAIL",
    "Categories API": "FAIL",
    "Discovery system": "FAIL",
  };

  try {
    const customerId = randomUUID();
    const ownerId = randomUUID();
    const seed = String(Date.now()).slice(-5);

    console.log("Setting up test data...");

    // Create test users
    await seedUser({ id: customerId, phone: `991${seed}1`, role: "CUSTOMER", name: "Customer" });
    await seedUser({ id: ownerId, phone: `991${seed}2`, role: "SHOP_OWNER", name: "Owner" });

    const customerToken = tokenFor({ id: customerId, role: "customer" });
    const ownerToken = tokenFor({ id: ownerId, role: "shop_owner" });

    // Create a test shop
    const shopRes = await req("POST", "/shops", {
      token: ownerToken,
      body: { name: `Test Shop ${seed}`, category: "grocery", phone: `99${seed}01`, lat: 17.385, lng: 78.4867 }
    });
    
    if (shopRes.status !== 201) {
      console.error("Shop creation failed:", shopRes.body);
      process.exit(1);
    }

    const shopId = shopRes.body.id;
    console.log(`✓ Created shop: ${shopId}`);

    // Add shop to favorites
    const favRes = await req("POST", `/users/favorites/${shopId}`, { token: customerToken });
    console.log(`✓ Added to favorites: ${favRes.status === 200 ? "OK" : "FAIL"}`);

    // Test 1: Get homepage
    console.log("\n--- Testing Homepage API ---");
    const homeRes = await req("GET", "/home?lat=17.385&lng=78.4867", { token: customerToken });

    if (homeRes.status === 200) {
      const home = homeRes.body;
      console.log(`✓ Homepage status: 200`);
      console.log(`  - Favorites: ${home.favorites?.length || 0} items`);
      console.log(`  - Regular shops: ${home.regularShops?.length || 0} items`);
      console.log(`  - Recommended: ${home.recommended?.length || 0} items`);
      console.log(`  - Categories: ${home.categories?.length || 0} items`);

      // Verify structure
      const hasRequired = 
        home.favorites !== undefined &&
        home.regularShops !== undefined &&
        home.recommended !== undefined &&
        home.categories !== undefined &&
        Array.isArray(home.categories) &&
        home.categories.length > 0;

      if (hasRequired) {
        result["Homepage API"] = "PASS";
        console.log("✓ Homepage structure: VALID");
      }
    } else {
      console.log(`✗ Homepage status: ${homeRes.status}`);
      console.log(`  Error: ${homeRes.body?.error || homeRes.body}`);
    }

    // Test 2: Get all categories
    console.log("\n--- Testing Categories API ---");
    const catRes = await req("GET", "/categories");

    if (catRes.status === 200) {
      const cats = catRes.body.categories || [];
      console.log(`✓ Categories status: 200`);
      console.log(`  - Found ${cats.length} categories`);
      const names = cats.map(c => c.name || c).slice(0, 3).join(", ");
      console.log(`  - Sample: ${names}`);

      const expectedCount = 7; // grocery, restaurant, pet_store, electronics, furniture, doctor, salon

      if (cats.length === expectedCount) {
        result["Categories API"] = "PASS";
        console.log("✓ Categories complete: VALID");
      }
    } else {
      console.log(`✗ Categories status: ${catRes.status}`);
    }

    // Test 3: Get shops by category
    console.log("\n--- Testing Discovery by Category ---");
    const groceryRes = await req("GET", "/categories/grocery/shops?lat=17.385&lng=78.4867");

    if (groceryRes.status === 200) {
      const groceryShops = groceryRes.body.shops || [];
      console.log(`✓ Category shops status: 200`);
      console.log(`  - Category: ${groceryRes.body.category}`);
      console.log(`  - Found ${groceryShops.length} shops`);

      if (Array.isArray(groceryShops) && groceryShops.every(s => s.shopId && s.name && s.deliveryTag)) {
        result["Discovery system"] = "PASS";
        console.log("✓ Discovery system: WORKING");
      }
    } else {
      console.log(`✗ Category shops status: ${groceryRes.status}`);
    }

    // Summary
    console.log("\n=== PHASE 13 TEST SUMMARY ===");
    Object.entries(result).forEach(([key, val]) => {
      console.log(`${val === "PASS" ? "✓" : "✗"} ${key}: ${val}`);
    });

    const allPass = Object.values(result).every(v => v === "PASS");
    console.log(`\nOverall: ${allPass ? "✓ PASS" : "✗ FAIL"}`);

    await pool.end();
    process.exit(allPass ? 0 : 1);
  } catch (err) {
    console.error("Test error:", err.message);
    process.exit(1);
  }
})();
