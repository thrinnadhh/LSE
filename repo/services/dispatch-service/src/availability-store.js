const ONLINE_PREFIX = "driver:online:";
const BUSY_PREFIX = "driver:busy:";
const DRIVERS_GEO_KEY = "drivers:geo";
const DRIVER_BUSY_LOCK_TTL_SECONDS = 30 * 60;

function onlineKey(driverId) {
  return `${ONLINE_PREFIX}${driverId}`;
}

function busyKey(driverId) {
  return `${BUSY_PREFIX}${driverId}`;
}

async function setDriverOnline({ redis, driverId, isOnline }) {
  if (!redis || !driverId) {
    return;
  }

  await redis.set(onlineKey(driverId), isOnline ? "1" : "0");
}

async function setDriverBusy({ redis, driverId, isBusy }) {
  if (!redis || !driverId) {
    return;
  }

  if (isBusy) {
    await redis.set(busyKey(driverId), "1", "EX", DRIVER_BUSY_LOCK_TTL_SECONDS);
    return;
  }

  await redis.del(busyKey(driverId));
}

async function isDriverBusy({ redis, driverId }) {
  if (!redis || !driverId) {
    return false;
  }

  const exists = await redis.exists(busyKey(driverId));
  return exists === 1;
}

async function updateDriverGeoIndex({ redis, driverId, lat, lng }) {
  if (!redis || !driverId || lat === null || lat === undefined || lng === null || lng === undefined) {
    return;
  }

  await redis.geoadd(DRIVERS_GEO_KEY, Number(lng), Number(lat), String(driverId));
}

async function getNearbyDriversByGeo({ redis, lat, lng, radiusKm = 3, limit = 20 }) {
  if (!redis || lat === null || lat === undefined || lng === null || lng === undefined) {
    return [];
  }

  const rows = await redis.georadius(
    DRIVERS_GEO_KEY,
    Number(lng),
    Number(lat),
    Number(radiusKm),
    "km",
    "WITHDIST",
    "COUNT",
    Number(limit),
    "ASC"
  );

  return rows.map((entry) => {
    if (!Array.isArray(entry)) {
      return { driverId: String(entry), distanceKm: null };
    }

    return {
      driverId: String(entry[0]),
      distanceKm: entry[1] === undefined ? null : Number(entry[1]),
    };
  });
}

async function getDriverAvailability({ redis, driverId }) {
  if (!redis || !driverId) {
    return null;
  }

  const [online, busyExists] = await Promise.all([
    redis.get(onlineKey(driverId)),
    redis.exists(busyKey(driverId)),
  ]);

  return {
    isOnline: online === null ? null : online === "1",
    isBusy: busyExists === 1,
  };
}

module.exports = {
  DRIVER_BUSY_LOCK_TTL_SECONDS,
  DRIVERS_GEO_KEY,
  getNearbyDriversByGeo,
  setDriverOnline,
  setDriverBusy,
  isDriverBusy,
  updateDriverGeoIndex,
  getDriverAvailability,
};