const { createConsumer } = require("../../../apps/api-gateway/src/lib/kafka");
const { assignDriver } = require("../../order-service/src/order-service");
const { getNearbyDriversByGeo, isDriverBusy } = require("./availability-store");

const ORDER_CREATED_TOPIC = "ORDER_CREATED";
const DISPATCH_RETRY_DELAY_MS = 10_000;
const DISPATCH_QUEUE_KEY = "dispatch:orders";
const DISPATCH_ATTEMPTS_PREFIX = "dispatch:attempts:";
const DISPATCH_MAX_RETRIES = 10;
let activeDispatcher = null;

async function getDispatchTarget({ orderId, db }) {
  const result = await db.query(
    `
      SELECT
        o.id,
        o.status,
        o.driver_id,
        ST_Y(ua.location::geometry) AS delivery_lat,
        ST_X(ua.location::geometry) AS delivery_lng
      FROM orders o
      JOIN user_addresses ua ON ua.id = o.delivery_address_id
      WHERE o.id = $1
      LIMIT 1
    `,
    [orderId]
  );

  return result.rows[0] || null;
}

async function getDriverCandidatesFromGeo({ target, redis }) {
  if (!target || target.delivery_lat === null || target.delivery_lng === null) {
    return [];
  }

  return getNearbyDriversByGeo({
    redis,
    lat: Number(target.delivery_lat),
    lng: Number(target.delivery_lng),
    radiusKm: 3,
    limit: 25,
  });
}

async function getDriverRowsByIds({ db, driverIds }) {
  if (!driverIds.length) {
    return new Map();
  }

  const result = await db.query(
    `
      SELECT
        d.id,
        d.is_active,
        d.is_online,
        COALESCE(d.is_busy, FALSE) AS is_busy
      FROM drivers d
      WHERE d.id = ANY($1::uuid[])
    `,
    [driverIds]
  );

  return new Map(result.rows.map((row) => [row.id, row]));
}

async function chooseAvailableDriver({ target, db, redis }) {
  const nearby = await getDriverCandidatesFromGeo({ target, redis });
  const driverRows = await getDriverRowsByIds({
    db,
    driverIds: nearby.map((item) => item.driverId),
  });

  for (const candidate of nearby) {
    const driver = driverRows.get(candidate.driverId);
    if (!driver || !driver.is_active || !driver.is_online) {
      continue;
    }

    const busyLocked = await isDriverBusy({ redis, driverId: candidate.driverId });
    if (busyLocked) {
      continue;
    }

    if (!driver.is_busy) {
      return candidate.driverId;
    }
  }

  return null;
}

function attemptsKey(orderId) {
  return `${DISPATCH_ATTEMPTS_PREFIX}${orderId}`;
}

async function enqueueDispatchOrder({ redis, orderId }) {
  if (!redis || !orderId) {
    return;
  }

  await redis.lpush(DISPATCH_QUEUE_KEY, orderId);
}

async function incrementDispatchAttempts({ redis, orderId }) {
  const key = attemptsKey(orderId);
  const attempts = await redis.incr(key);
  await redis.expire(key, 2 * 60 * 60);
  return attempts;
}

async function clearDispatchAttempts({ redis, orderId }) {
  await redis.del(attemptsKey(orderId));
}

async function scheduleRetry({ redis, orderId, attempts }) {
  if (attempts >= DISPATCH_MAX_RETRIES) {
    await clearDispatchAttempts({ redis, orderId });
    console.info("dispatch_no_driver", { orderId, attempts, maxRetries: DISPATCH_MAX_RETRIES });
    return;
  }

  console.info("dispatch_retry", { orderId, attempts, delayMs: DISPATCH_RETRY_DELAY_MS });
  setTimeout(() => {
    enqueueDispatchOrder({ redis, orderId }).catch((err) => {
      console.error("dispatch retry enqueue failed", { orderId, error: err.message });
    });
  }, DISPATCH_RETRY_DELAY_MS);
}

async function publishOrderCreated({ producer, orderId }) {
  await producer.send({
    topic: ORDER_CREATED_TOPIC,
    messages: [
      {
        key: orderId,
        value: JSON.stringify({ orderId, createdAt: new Date().toISOString() }),
      },
    ],
  });
}

async function dispatchOrderCreated({ orderId }) {
  if (!activeDispatcher || !orderId) {
    return;
  }

  await activeDispatcher.enqueue(orderId);
}

async function startDispatchConsumer({ db, redis, kafkaProducer }) {
  const consumer = createConsumer({ groupId: "dispatch-service" });
  let isWorkerRunning = true;

  async function dispatchOrder(orderId) {
    const target = await getDispatchTarget({ orderId, db });
    if (!target) {
      await clearDispatchAttempts({ redis, orderId });
      return;
    }

    if (target.driver_id || (target.status !== "CREATED" && target.status !== "CONFIRMED")) {
      await clearDispatchAttempts({ redis, orderId });
      return;
    }

    const attempts = await incrementDispatchAttempts({ redis, orderId });
    console.info("dispatch_attempt", { orderId, attempts });

    const driverId = await chooseAvailableDriver({ target, db, redis });
    if (!driverId) {
      console.info("dispatch_no_driver", { orderId, attempts });
      await scheduleRetry({ redis, orderId, attempts });
      return;
    }

    try {
      await assignDriver({
        orderId,
        driverId,
        db,
        redis,
        kafkaProducer,
        requireAvailable: true,
      });
      await clearDispatchAttempts({ redis, orderId });
      console.info("dispatch_success", { orderId, driverId, attempts });
    } catch (err) {
      if (err.statusCode === 400 || err.statusCode === 404) {
        const refreshed = await getDispatchTarget({ orderId, db });
        if (refreshed && !refreshed.driver_id && (refreshed.status === "CREATED" || refreshed.status === "CONFIRMED")) {
          await scheduleRetry({ redis, orderId, attempts });
        } else {
          await clearDispatchAttempts({ redis, orderId });
        }
        return;
      }

      throw err;
    }
  }

  async function startQueueWorker() {
    while (isWorkerRunning) {
      try {
        const result = await redis.brpop(DISPATCH_QUEUE_KEY, 0);
        if (!result || !result[1]) {
          continue;
        }

        const orderId = String(result[1]);
        await dispatchOrder(orderId);
      } catch (err) {
        console.error("dispatch worker loop failed", { error: err.message });
      }
    }
  }

  activeDispatcher = {
    enqueue: async (orderId) => {
      await enqueueDispatchOrder({ redis, orderId });
    },
  };

  startQueueWorker();

  await consumer.connect();
  await consumer.subscribe({ topic: ORDER_CREATED_TOPIC, fromBeginning: false });
  await consumer.run({
    eachMessage: async ({ message }) => {
      if (!message.value) {
        return;
      }

      const payload = JSON.parse(message.value.toString());
      if (!payload.orderId) {
        return;
      }

      await enqueueDispatchOrder({ redis, orderId: payload.orderId });
    },
  });

  return {
    consumer,
    stop: async () => {
      isWorkerRunning = false;
      await consumer.disconnect();
    },
  };
}

module.exports = {
  DISPATCH_MAX_RETRIES,
  ORDER_CREATED_TOPIC,
  DISPATCH_QUEUE_KEY,
  DISPATCH_RETRY_DELAY_MS,
  dispatchOrderCreated,
  enqueueDispatchOrder,
  publishOrderCreated,
  startDispatchConsumer,
};