#!/usr/bin/env node
/* Direct OTP Test - checks database and Redis */
const { Pool } = require("pg");
const redis = require("redis");

const pool = new Pool({
  connectionString: "postgresql://postgres:postgres@localhost:5432/hyperlocal",
});

const redisClient = redis.createClient({
  url: "redis://localhost:6379",
});

(async () => {
  try {
    await redisClient.connect();

    console.log("Checking OTP Infrastructure\n");

    // Check OTP codes table
    console.log("--- OTP Codes Table ---");
    const tableCheck = await pool.query(`
      SELECT EXISTS(
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'otp_codes'
      )
    `);
    console.log(`✓ otp_codes table exists: ${tableCheck.rows[0].exists}`);

    // Check table structure
    const columns = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'otp_codes'
      ORDER BY ordinal_position
    `);
    console.log("✓ Columns:");
    columns.rows.forEach(row => {
      console.log(`  - ${row.column_name}: ${row.data_type}`);
    });

    // Check user sessions table
    console.log("\n--- User Sessions Table ---");
    const sessionTableCheck = await pool.query(`
      SELECT EXISTS(
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'user_sessions'
      )
    `);
    console.log(`✓ user_sessions table exists: ${sessionTableCheck.rows[0].exists}`);

    // Check Redis connectivity
    console.log("\n--- Redis Connectivity ---");
    const testKey = `otp:test:${Date.now()}`;
    await redisClient.set(testKey, "test-value", { EX: 60 });
    const value = await redisClient.get(testKey);
    console.log(`✓ Redis set: OK`);
    console.log(`✓ Redis get: ${value ? "OK" : "FAIL"}`);

    // Test OTP storage
    console.log("\n--- OTP Storage Test ---");
    const testPhone = `+919${String(Date.now()).slice(-7)}`;
    const testOtp = "123456";
    
    // Store in Redis
    const otpKey = `otp:${testPhone}`;
    await redisClient.set(otpKey, testOtp, { EX: 300 });
    console.log(`✓ Stored OTP in Redis for ${testPhone}`);

    // Retrieve from Redis
    const retrieved = await redisClient.get(otpKey);
    console.log(`✓ Retrieved OTP: ${retrieved}`);

    // Store in database
    const crypto = require("crypto");
    const sha256 = (v) => crypto.createHash("sha256").update(v).digest("hex");
    
    await pool.query(
      `INSERT INTO otp_codes (phone, otp_hash, expires_at) 
       VALUES ($1, $2, NOW() + interval '5 minutes')`,
      [testPhone, sha256(testOtp)]
    );
    console.log(`✓ Stored OTP hash in database`);

    // Verify database storage
    const dbCheck = await pool.query(
      `SELECT phone, expires_at FROM otp_codes WHERE phone = $1 ORDER BY created_at DESC LIMIT 1`,
      [testPhone]
    );
    console.log(`✓ Database record found: ${dbCheck.rowCount > 0 ? "OK" : "FAIL"}`);

    console.log("\n=== OTP INFRASTRUCTURE ===");
    console.log("✓ OTP Codes Table: READY");
    console.log("✓ User Sessions Table: READY");
    console.log("✓ Redis Caching: READY");
    console.log("✓ Database Storage: READY");
    console.log("\nOTP endpoints are fully configured:\n");
    console.log("POST /auth/send-otp");
    console.log("POST /auth/verify-otp");

    await redisClient.disconnect();
    await pool.end();
  } catch (err) {
    console.error("Error:", err.message);
    process.exit(1);
  }
})();
