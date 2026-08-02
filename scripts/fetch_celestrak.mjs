#!/usr/bin/env node
/*
  Fetches orbital elements from CelesTrak (HTTPS, public) and converts them to
  AstriaGraph TSV format for static GitHub Pages deployments (no backend).

  Outputs:
    - assets/data/www_query_NODEB.tsv (active satellites)
    - assets/data/www_query_DEB.tsv   (selected debris groups)
  Leaves existing assets/data/www_data_sources.tsv as-is (must include CELESTRAK).

  Usage:
    node AstriaGraph/scripts/fetch_celestrak.mjs

  Notes:
    - Uses CelesTrak GP JSON (https://celestrak.org/NORAD/elements/).
    - Converts mean motion (rev/day) to SMA (meters).
    - Converts angles (deg) to radians to match the viewer expectations.
*/

import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

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
    'CELESTRAK', // DataSource code, maps via www_data_sources.tsv
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

function validateRecords(records, label) {
  if (!Array.isArray(records) || records.length === 0)
    throw new Error(`No ${label} records were fetched; refusing to publish datasets`)
  for (const [index, record] of records.entries()) {
    if (!record || typeof record !== 'object')
      throw new Error(`Invalid ${label} record at index ${index}; refusing to publish datasets`)
    const requiredNumericFields = [
      'NORAD_CAT_ID', 'MEAN_MOTION', 'ECCENTRICITY', 'INCLINATION',
      'RA_OF_ASC_NODE', 'ARG_OF_PERICENTER', 'MEAN_ANOMALY'
    ]
    const missing = requiredNumericFields.filter(field => {
      const value = record[field]
      return value === undefined || value === null || value === '' ||
        !Number.isFinite(Number(value))
    })
    if (missing.length > 0 || !record.EPOCH) {
      const fields = missing.concat(!record.EPOCH ? ['EPOCH'] : [])
      throw new Error(
        `Invalid ${label} record at index ${index}; missing/invalid ${fields.join(', ')}`
      )
    }
    const eccentricity = Number(record.ECCENTRICITY)
    if (Number(record.NORAD_CAT_ID) <= 0)
      throw new Error(`Invalid ${label} record at index ${index}; NORAD_CAT_ID must be positive`)
    if (eccentricity < 0 || eccentricity >= 1)
      throw new Error(`Invalid ${label} record at index ${index}; Eccentricity must be in [0, 1)`)
    if (Number(record.MEAN_MOTION) <= 0)
      throw new Error(`Invalid ${label} record at index ${index}; MEAN_MOTION must be positive`)
    if (Number.isNaN(Date.parse(record.EPOCH)))
      throw new Error(`Invalid ${label} record at index ${index}; EPOCH must be a valid date`)
  }
}

async function publishPair(nodebContents, debContents) {
  const parentDir = path.dirname(OUT_DIR)
  const stagingDir = await fs.mkdtemp(path.join(parentDir, '.astria-refresh-'))
  const stagedDataDir = path.join(stagingDir, 'data')
  const backupDir = await fs.mkdtemp(path.join(parentDir, '.astria-previous-'))
  const backupDataDir = path.join(backupDir, 'data')
  let oldDataMoved = false
  let newDataPublished = false
  let rollbackFailed = false

  try {
    await fs.cp(OUT_DIR, stagedDataDir, { recursive: true })
    await fs.writeFile(path.join(stagedDataDir, 'www_query_NODEB.tsv'), nodebContents)
    await fs.writeFile(path.join(stagedDataDir, 'www_query_DEB.tsv'), debContents)
    await fs.rename(OUT_DIR, backupDataDir)
    oldDataMoved = true
    await fs.rename(stagedDataDir, OUT_DIR)
    newDataPublished = true
    await fs.rm(backupDir, { recursive: true, force: true })
  } catch (error) {
    if (newDataPublished)
      await fs.rm(OUT_DIR, { recursive: true, force: true })
    if (oldDataMoved)
      await fs.rename(backupDataDir, OUT_DIR)
        .catch(restoreError => {
          rollbackFailed = true
          throw new Error(`Dataset pair rollback failed: ${restoreError.message}`)
        })
    throw new Error(`Dataset pair publication failed safely: ${error.message}`)
  } finally {
    await fs.rm(stagingDir, { recursive: true, force: true })
    if (!newDataPublished && !rollbackFailed)
      await fs.rm(backupDir, { recursive: true, force: true })
  }
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true })

  // Active satellites → NODEB file (non-debris)
  const activeUrl = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=json'
  const active = await fetchJson(activeUrl)
  validateRecords(active, 'active')

  // Debris: use the named CelesTrak groups that are currently supported.
  // An invalid group must not silently replace the checked-in dataset with
  // a header-only file.
  const debrisGroups = [
    'iridium-33-debris',
    'cosmos-2251-debris'
  ]
  const debrisAll = []
  for (const g of debrisGroups) {
    const url = `https://celestrak.org/NORAD/elements/gp.php?GROUP=${encodeURIComponent(g)}&FORMAT=json`
    try {
      const arr = await fetchJson(url)
      validateRecords(arr, `debris group ${g}`)
      debrisAll.push(...arr)
    } catch (e) {
      throw new Error(`Required debris group ${g} failed; preserving existing datasets: ${e.message}`)
    }
  }
  if (debrisAll.length === 0) {
    throw new Error('No debris records were fetched; refusing to overwrite www_query_DEB.tsv')
  }
  validateRecords(debrisAll, 'debris')

  const nodebLines = [HEADER, ...active.map(rowFromCelestrak)]
  const debLines = [HEADER, ...debrisAll.map(rowFromCelestrak)]
  await publishPair(nodebLines.join('\n'), debLines.join('\n'))

  console.log(`Wrote ${active.length} active → www_query_NODEB.tsv`)
  console.log(`Wrote ${debrisAll.length} debris → www_query_DEB.tsv`)
  console.log('Done.')
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(err => {
    console.error('[ERROR]', err)
    process.exit(1)
  })
}

export { HEADER, rowFromCelestrak, validateRecords }
