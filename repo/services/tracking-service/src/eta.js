const EARTH_RADIUS_KM = 6371;
const DEFAULT_SPEED_KMH = 25;

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function haversineKm(fromLat, fromLng, toLat, toLng) {
  const dLat = toRadians(toLat - fromLat);
  const dLng = toRadians(toLng - fromLng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(fromLat)) * Math.cos(toRadians(toLat)) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

function calculateEtaSeconds({ fromLat, fromLng, toLat, toLng, speedKmh = DEFAULT_SPEED_KMH }) {
  if ([fromLat, fromLng, toLat, toLng].some((v) => v === null || v === undefined || Number.isNaN(Number(v)))) {
    return null;
  }

  const distanceKm = haversineKm(Number(fromLat), Number(fromLng), Number(toLat), Number(toLng));
  const clampedSpeed = Number(speedKmh) > 0 ? Number(speedKmh) : DEFAULT_SPEED_KMH;
  return Math.max(0, Math.round((distanceKm / clampedSpeed) * 3600));
}

module.exports = { calculateEtaSeconds, DEFAULT_SPEED_KMH };
