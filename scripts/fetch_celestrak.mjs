#!/usr/bin/env node
/*
  Fetches orbital elements from CelesTrak (HTTPS, public) and converts them to
  AstriaGraph TSV format for static GitHub Pages deployments (no backend).

  Outputs:
    - assets/data/www_query_NODEB.tsv (active satellites)
    - assets/data/www_query_DEB.tsv   (selected debris groups)
  Leaves existing assets/data/www_data_sources.tsv as-is (must include USSTRATCOM).

  Usage:
    node AstriaGraph/scripts/fetch_celestrak.mjs

  Notes:
    - Uses CelesTrak GP JSON (https://celestrak.org/NORAD/elements/).
    - Converts mean motion (rev/day) to SMA (meters).
    - Converts angles (deg) to radians to match the viewer expectations.
*/

import fs from 'node:fs/promises'
import path from 'node:path'

const MU_EARTH = 3.986004418e14 // m^3/s^2
const OUT_DIR = path.resolve(process.cwd(), 'assets', 'data')

const HEADER = [
  'DataSource','Name','Country','CatalogId','NoradId','BirthDate','Operator','Users','Purpose','DetailedPurpose',
  'LaunchMass','DryMass','Power','Lifetime','Contractor','LaunchSite','LaunchVehicle','OrbitType','Epoch',
  'SMA','Ecc','Inc','RAAN','ArgP','MeanAnom'
].join('\t')

function deg2rad(d) { return (Number(d) || 0) * Math.PI / 180 }
function toISO(x) { return (x || '').toString() }
function toNum(x) { const n = Number(x); return Number.isFinite(n) ? n : '' }
function smaFromMeanMotionRevPerDay(nRevPerDay) {
  const n = Number(nRevPerDay)
  if (!Number.isFinite(n) || n <= 0) return ''
  const nRadPerSec = n * 2 * Math.PI / 86400
  return Math.cbrt(MU_EARTH / (nRadPerSec * nRadPerSec))
}

function rowFromCelestrak(obj) {
  // CelesTrak GP JSON fields
  // OBJECT_NAME, OBJECT_ID, EPOCH, MEAN_MOTION, ECCENTRICITY, INCLINATION,
  // RA_OF_ASC_NODE, ARG_OF_PERICENTER, MEAN_ANOMALY, NORAD_CAT_ID
  const name = obj.OBJECT_NAME || ''
  const catalogId = obj.OBJECT_ID || ''
  const noradId = obj.NORAD_CAT_ID || ''
  const epoch = toISO(obj.EPOCH)
  const sma = smaFromMeanMotionRevPerDay(obj.MEAN_MOTION)
  const ecc = toNum(obj.ECCENTRICITY)
  const inc = deg2rad(obj.INCLINATION)
  const raan = deg2rad(obj.RA_OF_ASC_NODE)
  const argp = deg2rad(obj.ARG_OF_PERICENTER)
  const meanAnom = deg2rad(obj.MEAN_ANOMALY)

  const cols = [
    'USSTRATCOM', // DataSource code, maps via www_data_sources.tsv
    name,
    '',            // Country
    catalogId,
    noradId,
    '', '', '', '', '', // BirthDate, Operator, Users, Purpose, DetailedPurpose
    '', '', '', '', '', // LaunchMass, DryMass, Power, Lifetime, Contractor
    '', '',              // LaunchSite, LaunchVehicle
    '',                  // OrbitType (optional)
    epoch,
    sma,
    ecc,
    inc,
    raan,
    argp,
    meanAnom,
  ]
  return cols.map(v => (typeof v === 'number' && Number.isFinite(v)) ? String(v) : (v ?? '')).join('\t')
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'AstriaGraph-Static/1.0' }})
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return res.json()
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true })

  // Active satellites → NODEB file (non-debris)
  const activeUrl = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=json'
  const active = await fetchJson(activeUrl)
  const nodebLines = [HEADER, ...active.map(rowFromCelestrak)]
  await fs.writeFile(path.join(OUT_DIR, 'www_query_NODEB.tsv'), nodebLines.join('\n'))

  // Debris: pick a few large debris clouds as a demo; adjust groups as needed
  const debrisGroups = [
    'iridium-33-debris',
    'cosmos-2251-debris'
  ]
  const debrisAll = []
  for (const g of debrisGroups) {
    const url = `https://celestrak.org/NORAD/elements/gp.php?GROUP=${encodeURIComponent(g)}&FORMAT=json`
    try {
      const arr = await fetchJson(url)
      debrisAll.push(...arr)
    } catch (e) {
      console.warn(`[WARN] Skipping debris group ${g}: ${e.message}`)
    }
  }
  const debLines = [HEADER, ...debrisAll.map(rowFromCelestrak)]
  await fs.writeFile(path.join(OUT_DIR, 'www_query_DEB.tsv'), debLines.join('\n'))

  console.log(`Wrote ${active.length} active → www_query_NODEB.tsv`)
  console.log(`Wrote ${debrisAll.length} debris → www_query_DEB.tsv`)
  console.log('Done.')
}

main().catch(err => {
  console.error('[ERROR]', err)
  process.exit(1)
})
