// Test auth service directly
const { Pool } = require('pg');
const Redis = require('ioredis');

const db = new Pool({
  connectionString: 'postgresql://postgres:postgres@hyperlocal-postgres:5432/hyperlocal'
});

const redis = new Redis('redis://hyperlocal-redis:6379/0');

async function testOtp() {
  try {
    console.log('Testing OTP generation...');
    const crypto = require('crypto');
    
    // Simulate sendOtp
    const phone = '+919999999999';
    const otp = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const sha256 = (val) => crypto.createHash('sha256').update(val).digest('hex');
    
    console.log('OTP:', otp);
    
    // Set in Redis
    console.log('Setting in Redis...');
    await redis.set(`otp:${phone}`, otp, 'EX', 300);
    console.log('Redis set complete');
    
    // Insert in DB
    console.log('Inserting into database...');
    const result = await db.query(
      `INSERT INTO otp_codes (phone, otp_hash, expires_at)
       VALUES ($1, $2, NOW() + ($3 || ' second')::interval)`,
      [phone, sha256(otp), 300]
    );
    console.log('DB insert complete:', result.rowCount);
    
    console.log('✅ SUCCESS');
    process.exit(0);
  } catch (err) {
    console.error('❌ ERROR:', err.message);
    process.exit(1);
  }
}

testOtp();
