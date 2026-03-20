const { calculateDistanceKm } = require("../../../lib/geo/distance");
const DEFAULT_SPEED_KMH = 25;

function calculateEtaSeconds({ fromLat, fromLng, toLat, toLng, speedKmh = DEFAULT_SPEED_KMH }) {
  const distanceKm = calculateDistanceKm(fromLat, fromLng, toLat, toLng);
  if (distanceKm === null) {
    return null;
  }

  const clampedSpeed = Number(speedKmh) > 0 ? Number(speedKmh) : DEFAULT_SPEED_KMH;
  return Math.max(0, Math.round((distanceKm / clampedSpeed) * 3600));
}

module.exports = { calculateEtaSeconds, calculateDistanceKm, DEFAULT_SPEED_KMH };
