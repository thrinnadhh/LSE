const Redis = require("ioredis");
const { config } = require("./config");

const redis = new Redis(config.redisUrl, {
  maxRetriesPerRequest: 2,
  enableOfflineQueue: true,
});

redis.on("error", (err) => {
  console.error("redis connection error", err.message);
});

module.exports = { redis };
