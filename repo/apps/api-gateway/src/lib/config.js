const config = {
  port: Number(process.env.PORT || 8080),
  databaseUrl:
    process.env.DATABASE_URL ||
    "postgresql://postgres:postgres@localhost:5432/hyperlocal",
  redisUrl: process.env.REDIS_URL || "redis://localhost:6379",
  jwtSecret: process.env.JWT_SECRET || "devsecret",
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || "devrefreshsecret",
  accessTokenTtl: process.env.ACCESS_TOKEN_TTL || "15m",
  refreshTokenDays: Number(process.env.REFRESH_TOKEN_DAYS || 30),
  otpTtlSeconds: Number(process.env.OTP_TTL_SECONDS || 300),
};

module.exports = { config };
