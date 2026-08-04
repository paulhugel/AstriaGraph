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
    - Uses CelesTrak GP JSON (https://celestrak.org/NORAD/elements/) for orbital
      elements, and CelesTrak SATCAT (https://celestrak.org/satcat/) for
      operational-status enrichment (OpsStatusCode, ObjectType, LAUNCH_DATE,
      OWNER), joined by NORAD_CAT_ID. The GP feed alone carries no operational
      status field.
    - Converts mean motion (rev/day) to SMA (meters).
    - Converts angles (deg) to radians to match the viewer expectations.
    - Usage-policy cadence (celestrak.org/usage-policy.php): GP data no more
      than once/2h; SATCAT updates 1-2x/day and should not be polled faster
      than that. This script performs one fetch per source per invocation —
      callers (e.g. a scheduled workflow) are responsible for not invoking it
      more often than the policy allows.
*/

import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const MU_EARTH = 3.986004418e14 // m^3/s^2
const OUT_DIR = path.resolve(process.cwd(), 'assets', 'data')

const HEADER = [
  'DataSource','Name','Country','CatalogId','NoradId','BirthDate','Operator','Users','Purpose','DetailedPurpose',
  'LaunchMass','DryMass','Power','Lifetime','Contractor','LaunchSite','LaunchVehicle','OrbitType','Epoch',
  'SMA','Ecc','Inc','RAAN','ArgP','MeanAnom','OpsStatusCode','ObjectType'
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

function rowFromCelestrak(obj, satcatByNoradId) {
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

  // SATCAT (celestrak.org/satcat/) carries operational-status metadata that
  // the GP feed does not. Joined by NORAD_CAT_ID; a miss (satellite present
  // in GP-active but not in SATCAT-active) leaves these fields blank rather
  // than failing the row.
  const satcat = satcatByNoradId ? satcatByNoradId.get(String(noradId)) : undefined
  const birthDate = satcat && satcat.LAUNCH_DATE ? satcat.LAUNCH_DATE : ''
  const operator = satcat && satcat.OWNER ? satcat.OWNER : ''
  const opsStatusCode = satcat && satcat.OPS_STATUS_CODE ? satcat.OPS_STATUS_CODE : ''
  const objectType = satcat && satcat.OBJECT_TYPE ? satcat.OBJECT_TYPE : ''

  const cols = [
    'CELESTRAK', // DataSource code, maps via www_data_sources.tsv
    name,
    '',            // Country
    catalogId,
    noradId,
    birthDate, operator, '', '', '', // BirthDate, Operator, Users, Purpose, DetailedPurpose
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
    opsStatusCode,
    objectType,
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

async function fetchSatcatActiveMap() {
  // SATCAT enrichment is best-effort: a failure here must not block or
  // replace publication of the GP-derived datasets. On failure we log and
  // return an empty map, so every row's OpsStatusCode/ObjectType/BirthDate/
  // Operator simply stay blank for this run (same shape as before this
  // enrichment existed) rather than aborting the whole fetch.
  const satcatUrl = 'https://celestrak.org/satcat/records.php?GROUP=active&FORMAT=json'
  try {
    const records = await fetchJson(satcatUrl)
    if (!Array.isArray(records))
      throw new Error('SATCAT active response was not an array')
    const map = new Map()
    for (const rec of records) {
      if (rec && rec.NORAD_CAT_ID !== undefined && rec.NORAD_CAT_ID !== null)
        map.set(String(rec.NORAD_CAT_ID), rec)
    }
    return map
  } catch (e) {
    console.warn(`[WARN] SATCAT active fetch failed; continuing without operational-status enrichment: ${e.message}`)
    return new Map()
  }
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true })

  // Active satellites → NODEB file (non-debris)
  const activeUrl = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=json'
  const active = await fetchJson(activeUrl)
  validateRecords(active, 'active')

  // SATCAT active-group records, keyed by NORAD_CAT_ID, for OpsStatusCode/
  // ObjectType/LAUNCH_DATE/OWNER enrichment. Not required for debris groups:
  // their ObjectType is already implied by group membership, and querying
  // SATCAT again for them would be an unnecessary extra request per the
  // usage policy's "only download the data you need" guidance.
  const satcatByNoradId = await fetchSatcatActiveMap()

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

  const nodebLines = [HEADER, ...active.map(obj => rowFromCelestrak(obj, satcatByNoradId))]
  const debLines = [HEADER, ...debrisAll.map(obj => rowFromCelestrak(obj))]
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

export { HEADER, rowFromCelestrak, validateRecords, fetchSatcatActiveMap }
