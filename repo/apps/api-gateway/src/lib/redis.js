const Redis = require("ioredis");
const { config } = require("./config");

const redis = new Redis(config.redisUrl, {
  maxRetriesPerRequest: 0,
  connectTimeout: 2000,
  commandTimeout: 5000,
  lazyConnect: false,
  enableOfflineQueue: false,
  retryStrategy: () => null,
});

redis.on("error", (err) => {
  console.error("redis connection error", err.message);
});

module.exports = { redis };
