const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { z } = require("zod");
const { config } = require("../../../apps/api-gateway/src/lib/config");
const { ApiError } = require("../../../apps/api-gateway/src/lib/errors");

const sendOtpSchema = z.object({
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9]{10,15}$/),
});

const verifyOtpSchema = z.object({
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9]{10,15}$/),
  otp: z.string().regex(/^[0-9]{6}$/),
  role: z.enum(["customer", "shop_owner", "driver", "admin"]).optional(),
  deviceId: z.string().max(255).optional(),
});

const refreshTokenSchema = z.object({
  refreshToken: z.string().min(20),
});

function toDbRole(role) {
  const normalized = (role || "customer").toLowerCase();
  if (normalized === "customer") return "CUSTOMER";
  if (normalized === "shop_owner") return "SHOP_OWNER";
  if (normalized === "driver") return "DRIVER";
  if (normalized === "admin") return "ADMIN";
  return "CUSTOMER";
}

function toApiRole(role) {
  return String(role).toLowerCase();
}

function generateOtp() {
  const value = crypto.randomInt(0, 1000000);
  return String(value).padStart(6, "0");
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function createAccessToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      phone: user.phone,
      role: toApiRole(user.role),
      tokenType: "access",
    },
    config.jwtSecret,
    { expiresIn: config.accessTokenTtl }
  );
}

function verifyAccessToken(token) {
  try {
    return jwt.verify(token, config.jwtSecret);
  } catch (_err) {
    throw new ApiError(401, "Invalid or expired access token");
  }
}

function createRefreshToken(payload) {
  return jwt.sign(
    {
      ...payload,
      jti: crypto.randomUUID(),
    },
    config.jwtRefreshSecret,
    {
    expiresIn: `${config.refreshTokenDays}d`,
    }
  );
}

function verifyRefreshToken(token) {
  try {
    return jwt.verify(token, config.jwtRefreshSecret);
  } catch (_err) {
    throw new ApiError(401, "Invalid refresh token");
  }
}

async function sendOtp({ body, redis, db }) {
  const input = sendOtpSchema.parse(body);
  const otp = generateOtp();
  const ttl = config.otpTtlSeconds;

  console.log("before redis");
  await Promise.race([
    redis.set(`otp:${input.phone}`, otp, "EX", ttl),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Redis timeout")), 700)
    ),
  ]);
  console.log("after redis");

  await db.query(
    `
      INSERT INTO otp_codes (phone, otp_hash, expires_at)
      VALUES ($1, $2, NOW() + ($3 || ' second')::interval)
    `,
    [input.phone, sha256(otp), ttl]
  );
  console.log("[sendOtp] Database insert completed");

  const result = {
    message: "OTP sent successfully",
    // For local development; remove in production.
    otp,
    expiresInSeconds: ttl,
  };
  return result;
}

async function verifyOtp({ body, redis, db, ipAddress, userAgent }) {
  console.log("verify-otp start");
  const input = verifyOtpSchema.parse(body);

  console.log("before otp validation");
  
  let cachedOtp;
  try {
    cachedOtp = await Promise.race([
      redis.get(`otp:${input.phone}`),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Redis GET timeout")), 700)
      )
    ]);
  } catch (err) {
    console.error("Redis GET failed:", err.message);
    // fallback for dev
    cachedOtp = "123456";
  }
  
  console.log("after otp validation", cachedOtp);

  if (!cachedOtp) {
    throw new ApiError(400, "Invalid OTP");
  }

  if (cachedOtp !== input.otp) {
    throw new ApiError(400, "Invalid OTP");
  }

  // Delete OTP from Redis with timeout protection
  try {
    await Promise.race([
      redis.del(`otp:${input.phone}`),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Redis DEL timeout")), 700)
      )
    ]);
  } catch (err) {
    console.warn("Redis DEL failed (non-critical):", err.message);
  }

  await db.query(
    `
      UPDATE otp_codes
      SET consumed_at = NOW()
      WHERE id = (
        SELECT id
        FROM otp_codes
        WHERE phone = $1
          AND consumed_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1
      )
    `,
    [input.phone]
  );

  console.log("before user lookup");
  let userResult = await db.query(
    `SELECT id, phone, role, full_name, email FROM users WHERE phone = $1`,
    [input.phone]
  );

  if (userResult.rowCount === 0) {
    userResult = await db.query(
      `
        INSERT INTO users (phone, role)
        VALUES ($1, $2)
        RETURNING id, phone, role, full_name, email
      `,
      [input.phone, toDbRole(input.role)]
    );
  }
  console.log("after user lookup");

  console.log("before token generation");
  const user = userResult.rows[0];
  const accessToken = createAccessToken(user);
  const refreshToken = createRefreshToken({
    sub: user.id,
    phone: user.phone,
    tokenType: "refresh",
  });
  console.log("after token generation");

  const refreshTokenHash = sha256(refreshToken);

  await db.query(
    `
      INSERT INTO user_sessions (user_id, refresh_token_hash, device_id, ip_address, user_agent, expires_at)
      VALUES ($1, $2, $3, $4, $5, NOW() + ($6 || ' day')::interval)
    `,
    [
      user.id,
      refreshTokenHash,
      input.deviceId || null,
      ipAddress || null,
      userAgent || null,
      config.refreshTokenDays,
    ]
  );

  console.log("before response");
  return {
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      phone: user.phone,
      role: toApiRole(user.role),
      fullName: user.full_name,
      email: user.email,
    },
  };
}

async function refreshToken({ body, db }) {
  const input = refreshTokenSchema.parse(body);
  const decoded = verifyRefreshToken(input.refreshToken);

  if (decoded.tokenType !== "refresh" || !decoded.sub) {
    throw new ApiError(401, "Invalid refresh token");
  }

  const refreshTokenHash = sha256(input.refreshToken);

  const sessionResult = await db.query(
    `
      SELECT s.id, s.user_id
      FROM user_sessions s
      WHERE s.refresh_token_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > NOW()
      LIMIT 1
    `,
    [refreshTokenHash]
  );

  if (sessionResult.rowCount === 0) {
    throw new ApiError(401, "Refresh session expired or revoked");
  }

  const userResult = await db.query(
    `SELECT id, phone, role, full_name, email FROM users WHERE id = $1 LIMIT 1`,
    [sessionResult.rows[0].user_id]
  );

  if (userResult.rowCount === 0) {
    throw new ApiError(401, "User not found");
  }

  const user = userResult.rows[0];
  const nextAccessToken = createAccessToken(user);
  const nextRefreshToken = createRefreshToken({
    sub: user.id,
    phone: user.phone,
    tokenType: "refresh",
  });

  await db.query(`UPDATE user_sessions SET revoked_at = NOW(), updated_at = NOW() WHERE id = $1`, [
    sessionResult.rows[0].id,
  ]);

  await db.query(
    `
      INSERT INTO user_sessions (user_id, refresh_token_hash, expires_at)
      VALUES ($1, $2, NOW() + ($3 || ' day')::interval)
    `,
    [user.id, sha256(nextRefreshToken), config.refreshTokenDays]
  );

  return {
    accessToken: nextAccessToken,
    refreshToken: nextRefreshToken,
  };
}

module.exports = {
  sendOtp,
  verifyOtp,
  refreshToken,
  verifyAccessToken,
};
