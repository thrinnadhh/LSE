/* eslint-disable no-console */
const { randomUUID } = require("crypto");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");

const BASE = process.env.BASE_URL || "http://localhost:8080";
const DATABASE_URL = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/hyperlocal";
const JWT_SECRET = process.env.JWT_SECRET || "devsecret";

(async () => {
  const db = new Pool({ connectionString: DATABASE_URL });
  try {
    const id = randomUUID();
    const phone = `799${String(Date.now()).slice(-7)}`;
    await db.query(
      `INSERT INTO users (id, phone, full_name, role, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4::user_role, TRUE, NOW(), NOW())`,
      [id, phone, "Probe Driver", "DRIVER"]
    );

    const token = jwt.sign({ sub: id, role: "driver" }, JWT_SECRET, { expiresIn: "15m" });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(`${BASE}/drivers/location`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ lat: 17.385, lng: 78.4867 }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    const text = await res.text();
    console.log(JSON.stringify({ status: res.status, body: text }, null, 2));
  } catch (err) {
    console.log(JSON.stringify({ error: err.message }, null, 2));
    process.exitCode = 1;
  } finally {
    await db.end();
  }
})();
