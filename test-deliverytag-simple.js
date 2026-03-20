#!/usr/bin/env node
/* Simple deliveryTag verification - checks search response has deliveryTag */
const { Pool } = require("pg");

const BASE = process.env.BASE_URL || "http://localhost:8080";
const DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/hyperlocal";

const pool = new Pool({ connectionString: DATABASE_URL });

async function main() {
  try {
    // Check if any shops with products exist in the database
    const result = await pool.query(`
      SELECT s.id, s.name, p.name as product_name, COUNT(*) as product_count
      FROM shops s
      JOIN products p ON p.shop_id = s.id
      GROUP BY s.id, s.name, p.name
      LIMIT 5
    `);

    console.log(`Found ${result.rowCount} shop-product combinations`);
    
    if (result.rowCount === 0) {
      console.log("No shops with products found. Creating test data...");
      const { randomUUID } = require("crypto");
      const jwt = require("jsonwebtoken");
      
      const userId = randomUUID();
      const ownerId = randomUUID();
      const JWT_SECRET = "devsecret";
      
      // Create users
      await pool.query(`
        INSERT INTO users (id, phone, full_name, role, is_active, created_at, updated_at)
        VALUES ($1, '9991111111', 'Customer', 'CUSTOMER', TRUE, NOW(), NOW())
        ON CONFLICT (id) DO NOTHING
      `, [userId]);
      
      await pool.query(`
        INSERT INTO users (id, phone, full_name, role, is_active, created_at, updated_at)
        VALUES ($1, '9992222222', 'Owner', 'SHOP_OWNER', TRUE, NOW(), NOW())
        ON CONFLICT (id) DO NOTHING
      `, [ownerId]);
      
      // Create shop
      const shopId = randomUUID();
      await pool.query(`
        INSERT INTO shops (id, owner_id, name, category, phone, location, is_active, created_at, updated_at)
        VALUES ($1, $2, 'Test Shop', 'grocery', '9993333333', ST_SetSRID(ST_Point(78.4867, 17.385), 4326)::geography, TRUE, NOW(), NOW())
        ON CONFLICT (id) DO NOTHING
      `, [shopId, ownerId]);
      
      // Create product
      const prodId = randomUUID();
      await pool.query(`
        INSERT INTO products (id, shop_id, name, category, price, stock, created_at, updated_at)
        VALUES ($1, $2, 'test milk', 'dairy', 50, 30, NOW(), NOW())
        ON CONFLICT (id) DO NOTHING
      `, [prodId, shopId]);
      
      console.log("Test data created. Waiting for indexing...");
      await new Promise(r => setTimeout(r, 3000));
    }

    // Now test search endpoint
    console.log("\nTesting search endpoint...");
    const searchUrl = `${BASE}/search/shops?q=milk&lat=17.385&lng=78.4867&radius=5000`;
    
    const response = await fetch(searchUrl);
    const data = await response.json();
    
    console.log(`Status: ${response.status}`);
    console.log(`Items found: ${data.items?.length || 0}`);
    
    if (data.items && data.items.length > 0) {
      const first = data.items[0];
      console.log("\nFirst item:", JSON.stringify(first, null, 2));
      
      if ("deliveryTag" in first) {
        console.log("\n✓✓✓ SUCCESS ✓✓✓");
        console.log("deliveryTag is present in response!");
        console.log(`Value: "${first.deliveryTag}"`);
        console.log("\nPhase 12 Final Fix: COMPLETE");
        console.log("overall: PASS");
      } else {
        console.log("\n✗✗✗ FAILED ✗✗✗");
        console.log("deliveryTag is MISSING from response!");
        console.log("Response has keys:", Object.keys(first));
      }
    } else {
      console.log("\nNo search results returned");
    }
    
    await pool.end();
  } catch (err) {
    console.error("Error:", err.message);
    process.exit(1);
  }
}

main();
