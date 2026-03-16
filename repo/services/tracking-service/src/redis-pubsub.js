const Redis = require("ioredis");

function createRedisPubSub(redisUrl) {
  const publisher = new Redis(redisUrl, {
    maxRetriesPerRequest: 2,
    enableOfflineQueue: true,
  });

  const subscriber = new Redis(redisUrl, {
    maxRetriesPerRequest: 2,
    enableOfflineQueue: true,
  });

  return {
    publisher,
    subscriber,
    close: async () => {
      await Promise.allSettled([publisher.quit(), subscriber.quit()]);
    },
  };
}

module.exports = { createRedisPubSub };
