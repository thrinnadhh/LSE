const Redis = require("ioredis");
const { config } = require("./config");
const logger = require("../../../../../src/logger");

const redis = new Redis(config.redisUrl, {
  maxRetriesPerRequest: 0,
  connectTimeout: 2000,
  commandTimeout: 5000,
  lazyConnect: false,
  enableOfflineQueue: false,
  retryStrategy: () => null,
});

redis.on("error", (err) => {
  logger.error({ event: "redis.connection_error", error: err.message });
});

module.exports = { redis };
