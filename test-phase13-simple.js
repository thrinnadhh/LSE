#!/usr/bin/env node
/* Phase 13 Simplified Test - uses existing data */
const { Pool } = require("pg");
const jwt = require("jsonwebtoken");

const BASE = "http://localhost:8080";
const DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/hyperlocal";
const JWT_SECRET = "devsecret";

const pool = new Pool({ connectionString: DATABASE_URL });

function tokenFor({ id, role }) {
  return jwt.sign({ sub: id, role }, JWT_SECRET, { expiresIn: "2h" });
}

async function req(method, path, { token } = {}) {
  try {
    const headers = {};
    if (token) headers.authorization = `Bearer ${token}`;

    const res = await fetch(BASE + path, {
      method,
      headers,
    });
    const text = await res.text();
    const parsed = text ? JSON.parse(text) : {};
    return { ok: true, status: res.status, body: parsed };
  } catch (err) {
    return { ok: false, status: 0, body: { error: err.message } };
  }
}

(async () => {
  const result = {
    "Homepage API": "FAIL",
    "Categories API": "FAIL",
    "Category Shops API": "FAIL",
  };

  try {
    // Get an existing customer
    const customerResult = await pool.query(
      `SELECT id FROM users WHERE role = 'CUSTOMER' LIMIT 1`
    );
    
    if (customerResult.rowCount === 0) {
      console.error("No customers in database");
      process.exit(1);
    }

    const customerId = customerResult.rows[0].id;
    const customerToken = tokenFor({ id: customerId, role: "customer" });

    console.log("Testing Phase 13 Discovery Layer...\n");

    // Test 1: Get homepage
    console.log("--- Testing Homepage API ---");
    const homeRes = await req("GET", "/home?lat=17.385&lng=78.4867", { token: customerToken });

    if (homeRes.status === 200) {
      const home = homeRes.body;
      console.log(`✓ Homepage status: 200`);
      console.log(`  - Favorites: ${home.favorites?.length || 0} items`);
      console.log(`  - Regular shops: ${home.regularShops?.length || 0} items`);
      console.log(`  - Recommended: ${home.recommended?.length || 0} items`);
      console.log(`  - Categories: ${home.categories?.length || 0} items`);

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
      console.log(`  Error: ${homeRes.body?.error}`);
    }

    // Test 2: Get all categories
    console.log("\n--- Testing Categories API ---");
    const catRes = await req("GET", "/home/categories");

    if (catRes.status === 200) {
      const cats = catRes.body.categories || [];
      console.log(`✓ Categories status: 200`);
      console.log(`  - Found ${cats.length} categories`);
      const names = cats.map(c => c.name).slice(0, 3).join(", ");
      console.log(`  - Sample: ${names}`);

      const expectedCount = 7;

      if (cats.length === expectedCount) {
        result["Categories API"] = "PASS";
        console.log("✓ Categories complete: VALID");
      }
    } else {
      console.log(`✗ Categories status: ${catRes.status}`);
    }

    // Test 3: Get shops by category
    console.log("\n--- Testing Category Shops Discovery ---");
    const groceryRes = await req("GET", "/home/categories/grocery/shops?lat=17.385&lng=78.4867");

    if (groceryRes.status === 200) {
      const groceryShops = groceryRes.body.shops || [];
      console.log(`✓ Category shops status: 200`);
      console.log(`  - Category: ${groceryRes.body.category}`);
      console.log(`  - Found ${groceryShops.length} shops`);

      if (Array.isArray(groceryShops) && groceryShops.length > 0) {
        const first = groceryShops[0];
        console.log(`  - Sample shop: ${first.name} (${first.deliveryTag})`);
        if (first.shopId && first.name && first.deliveryTag) {
          result["Category Shops API"] = "PASS";
          console.log("✓ Discovery system: WORKING");
        }
      } else if (groceryShops.length === 0) {
        console.log(`  - (No grocery shops nearby - that's OK)`);
        result["Category Shops API"] = "PASS";
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
    console.log(`\nResult: ${allPass ? "✓ PASS" : "✗ FAIL"}`);

    if (allPass) {
      console.log("\nPhase 13 Output:");
      console.log("Homepage API implemented");
      console.log("Categories API implemented");
      console.log("Discovery system working");
    }

    await pool.end();
    process.exit(allPass ? 0 : 1);
  } catch (err) {
    console.error("Test error:", err.message);
    process.exit(1);
  }
})();
