// Classifies an orbit into LEO/MEO/GEO/HEO from its semi-major axis and
// eccentricity, matching the scheme the legacy intactData feed used (single
// letters L/M/G/H, mapped to these names in the now-unused
// convert_intact_to_tsv.mjs). Thresholds were reverse-engineered by checking
// them against intactData.js sample rows (e.g. GEOS 2 at ~36,041 km altitude
// -> G, LAGEOS 2 at ~5,787 km altitude -> M, GEOTAIL at Ecc=0.50 -> H
// regardless of its huge SMA) and all matched.
const EARTH_RADIUS_KM = 6378.137
const LEO_MAX_ALTITUDE_KM = 2000
const GEO_ALTITUDE_KM = 35786
const GEO_BAND_KM = 3000
const HEO_ECCENTRICITY_THRESHOLD = 0.25

export function classifyOrbitRegime(smaMeters, eccentricity) {
  const sma = Number(smaMeters)
  if (!Number.isFinite(sma) || sma <= 0) return ''

  const ecc = Number(eccentricity)
  if (Number.isFinite(ecc) && ecc >= HEO_ECCENTRICITY_THRESHOLD) return 'HEO'

  const altitudeKm = sma / 1000 - EARTH_RADIUS_KM
  if (altitudeKm <= LEO_MAX_ALTITUDE_KM) return 'LEO'
  if (Math.abs(altitudeKm - GEO_ALTITUDE_KM) <= GEO_BAND_KM) return 'GEO'
  return 'MEO'
}
