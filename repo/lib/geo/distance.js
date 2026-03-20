const EARTH_RADIUS_KM = 6371;

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function calculateDistanceKm(fromLat, fromLng, toLat, toLng) {
  if ([fromLat, fromLng, toLat, toLng].some((v) => v === null || v === undefined || Number.isNaN(Number(v)))) {
    return null;
  }

  const sourceLat = Number(fromLat);
  const sourceLng = Number(fromLng);
  const targetLat = Number(toLat);
  const targetLng = Number(toLng);

  const dLat = toRadians(targetLat - sourceLat);
  const dLng = toRadians(targetLng - sourceLng);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(sourceLat)) * Math.cos(toRadians(targetLat)) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

module.exports = {
  calculateDistanceKm,
};