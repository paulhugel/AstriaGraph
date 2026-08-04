#!/usr/bin/env node
/*
  Fetches the comprehensive on-orbit debris population from Space-Track.org
  (the authoritative USSPACECOM/18th Space Defense Squadron catalog that
  CelesTrak itself is downstream of) and converts it to AstriaGraph TSV
  format for static GitHub Pages deployments.

  Outputs:
    - assets/data/www_query_DEB.tsv (all on-orbit cataloged debris)
  Leaves existing assets/data/www_data_sources.tsv as-is (must include
  SPACETRACK -> Space-Track).

  Why Space-Track and not CelesTrak for debris: CelesTrak only exposes debris
  via a handful of named collision-event groups (iridium-33-debris,
  cosmos-2251-debris, fengyun-1c-debris) - there is no "all debris" query on
  CelesTrak. Space-Track's `gp` class supports filtering by OBJECT_TYPE
  directly across the full catalog and, unlike CelesTrak's GP feed, already
  includes OBJECT_TYPE/DECAY_DATE/LAUNCH_DATE/COUNTRY_CODE/SEMIMAJOR_AXIS in
  the same query - no second SATCAT join is needed. See
  docs/plans/celestrak-satcat-status.md for the full comparison (verified
  live: Space-Track had 12,287 on-orbit cataloged debris objects vs. the
  ~700 this project got from CelesTrak's two named collision groups).

  Usage:
    SPACETRACK_USER=... SPACETRACK_PASSWORD=... node scripts/fetch_spacetrack_debris.mjs

  Required environment variables (never hold these in the repo or CLI args -
  they must come from GitHub Actions secrets or a local, gitignored shell
  environment):
    SPACETRACK_USER      Space-Track.org account username/email
    SPACETRACK_PASSWORD  Space-Track.org account password

  Notes:
    - Auth: POST identity=/password= to /ajaxauth/login, per
      https://www.space-track.org/documentation#/howto ("Getting a Cookie").
      Node's fetch does not persist cookies across calls like a browser or
      Python's requests.Session(), so the Set-Cookie from login is captured
      and manually attached as a Cookie header on the subsequent query and
      logout requests.
    - Rate limit (space-track.org/documentation#/api, "API Use Guidelines"):
      GP class max 1 request/hour, and Space-Track explicitly asks scripts to
      run 10-20 minutes off the top/bottom of the hour, not at :00/:30. This
      script does not self-throttle (it has no persisted state) - the caller
      (a scheduled workflow) is responsible for the cadence and minute
      offset; see docs/plans/celestrak-satcat-status.md for the planned
      cadence. A best-effort, non-blocking warning is logged if invoked at
      exactly :00 or :30 UTC as a nudge, not an enforcement.
    - Query scope: OBJECT_TYPE=DEBRIS, decay_date=null-val (on-orbit only,
      excludes the ~23,500 historical/decayed debris records that have no
      current valid orbit to plot), epoch > now-30 (propagable/recent
      ephemerides only, matching Space-Track's own recommended one-time
      retrieval pattern).
*/

import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { publishFile } from './lib/publish.mjs'
import { classifyOrbitRegime } from './lib/orbit_regime.mjs'

const OUT_DIR = path.resolve(process.cwd(), 'assets', 'data')
const BASE_URL = 'https://www.space-track.org'

const HEADER = [
  'DataSource','Name','Country','CatalogId','NoradId','BirthDate','Operator','Users','Purpose','DetailedPurpose',
  'LaunchMass','DryMass','Power','Lifetime','Contractor','LaunchSite','LaunchVehicle','OrbitType','Epoch',
  'SMA','Ecc','Inc','RAAN','ArgP','MeanAnom','OpsStatusCode','ObjectType'
].join('\t')

function deg2rad(d) { return (Number(d) || 0) * Math.PI / 180 }
function toISO(x) { return (x || '').toString() }
function toNum(x) { const n = Number(x); return Number.isFinite(n) ? n : '' }

function rowFromSpaceTrack(obj) {
  // Space-Track `gp` class fields (see modeldef/class/gp):
  // OBJECT_NAME, OBJECT_ID, NORAD_CAT_ID, EPOCH, SEMIMAJOR_AXIS (km),
  // ECCENTRICITY, INCLINATION, RA_OF_ASC_NODE, ARG_OF_PERICENTER,
  // MEAN_ANOMALY, OBJECT_TYPE, LAUNCH_DATE, COUNTRY_CODE, DECAY_DATE
  const name = obj.OBJECT_NAME || ''
  const catalogId = obj.OBJECT_ID || ''
  const noradId = obj.NORAD_CAT_ID || ''
  const epoch = toISO(obj.EPOCH)
  const sma = toNum(obj.SEMIMAJOR_AXIS) === '' ? '' : Number(obj.SEMIMAJOR_AXIS) * 1000 // km -> m
  const ecc = toNum(obj.ECCENTRICITY)
  const inc = deg2rad(obj.INCLINATION)
  const raan = deg2rad(obj.RA_OF_ASC_NODE)
  const argp = deg2rad(obj.ARG_OF_PERICENTER)
  const meanAnom = deg2rad(obj.MEAN_ANOMALY)
  const birthDate = obj.LAUNCH_DATE || ''
  const country = obj.COUNTRY_CODE || ''
  // Space-Track spells this out in full ("DEBRIS"), unlike CelesTrak's
  // abbreviated SATCAT codes ("DEB"). Preserved as-is rather than remapped:
  // main.js's CelesTrak-specific ObjectType branch is gated on
  // DataSource=="CelesTrak" and never sees this value; these rows instead
  // render via the legacy Name-substring "DEB" fallback, which matches
  // Space-Track's OBJECT_NAME values (e.g. "VANGUARD DEB") correctly.
  const objectType = obj.OBJECT_TYPE || ''
  // OrbitType was previously always hardcoded blank, leaving the viewer's
  // "Orbit regime" (LEO/MEO/GEO/HEO) filter unable to match anything.
  const orbitType = classifyOrbitRegime(sma, ecc)

  const cols = [
    'SPACETRACK', // DataSource code, maps via www_data_sources.tsv
    name,
    country,
    catalogId,
    noradId,
    birthDate, '', '', '', '', // BirthDate, Operator, Users, Purpose, DetailedPurpose
    '', '', '', '', '', // LaunchMass, DryMass, Power, Lifetime, Contractor
    '', '',              // LaunchSite, LaunchVehicle
    orbitType,
    epoch,
    sma,
    ecc,
    inc,
    raan,
    argp,
    meanAnom,
    '',          // OpsStatusCode: not a Space-Track concept, left blank
    objectType,
  ]
  return cols.map(v => (typeof v === 'number' && Number.isFinite(v)) ? String(v) : (v ?? '')).join('\t')
}

function validateRecords(records, label) {
  if (!Array.isArray(records) || records.length === 0)
    throw new Error(`No ${label} records were fetched; refusing to publish datasets`)
  for (const [index, record] of records.entries()) {
    if (!record || typeof record !== 'object')
      throw new Error(`Invalid ${label} record at index ${index}; refusing to publish datasets`)
    const requiredNumericFields = [
      'NORAD_CAT_ID', 'SEMIMAJOR_AXIS', 'ECCENTRICITY', 'INCLINATION',
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
    if (Number(record.SEMIMAJOR_AXIS) <= 0)
      throw new Error(`Invalid ${label} record at index ${index}; SEMIMAJOR_AXIS must be positive`)
    if (Number.isNaN(Date.parse(record.EPOCH)))
      throw new Error(`Invalid ${label} record at index ${index}; EPOCH must be a valid date`)
  }
}

function extractCookie(setCookieHeaders) {
  // fetch()'s Headers object folds multiple Set-Cookie values into one
  // comma-joined string in most runtimes; getSetCookie() (Node >=18.14) is
  // the reliable way to get them as a real array.
  if (!setCookieHeaders || setCookieHeaders.length === 0) return ''
  return setCookieHeaders.map(c => c.split(';')[0]).join('; ')
}

async function login(username, password) {
  const res = await fetch(`${BASE_URL}/ajaxauth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'AstriaGraph-Static/1.0'
    },
    body: new URLSearchParams({ identity: username, password: password }).toString()
  })
  if (!res.ok)
    throw new Error(`Space-Track login request failed: HTTP ${res.status}`)

  const cookie = extractCookie(typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : null)
  if (!cookie)
    throw new Error('Space-Track login did not return a session cookie')

  // Verify auth actually succeeded (a bad password still returns HTTP 200
  // with an error body) via the documented whoami endpoint, not by guessing
  // at the login response body's shape.
  const who = await fetch(`${BASE_URL}/app/data/whoami`, {
    headers: { Cookie: cookie, 'User-Agent': 'AstriaGraph-Static/1.0' }
  })
  if (!who.ok)
    throw new Error(`Space-Track whoami check failed: HTTP ${who.status}`)
  const whoBody = await who.json()
  if (!whoBody || whoBody.logged_in !== true)
    throw new Error('Space-Track login failed: whoami reports not logged in (check SPACETRACK_USER/SPACETRACK_PASSWORD)')

  return cookie
}

async function logout(cookie) {
  // Best-effort: a logout failure must not fail the whole run, the session
  // cookie simply expires on its own after ~2 hours regardless.
  try {
    await fetch(`${BASE_URL}/ajaxauth/logout`, {
      headers: { Cookie: cookie, 'User-Agent': 'AstriaGraph-Static/1.0' }
    })
  } catch (e) {
    console.warn(`[WARN] Space-Track logout request failed (non-fatal): ${e.message}`)
  }
}

function warnIfUnfavorableTiming() {
  // Non-blocking nudge only, per Space-Track's request to avoid exactly
  // :00/:30 - the actual cadence/scheduling enforcement belongs to whatever
  // invokes this script (a scheduled workflow), not this script itself.
  const minute = new Date().getUTCMinutes()
  if (minute === 0 || minute === 30) {
    console.warn(`[WARN] Running at :${String(minute).padStart(2, '0')} UTC - Space-Track asks GP-class scripts to run 10-20 minutes off the top/bottom of the hour to avoid busy periods. Consider rescheduling.`)
  }
}

async function main() {
  const username = process.env.SPACETRACK_USER
  const password = process.env.SPACETRACK_PASSWORD
  if (!username || !password) {
    throw new Error(
      'Missing credentials: set SPACETRACK_USER and SPACETRACK_PASSWORD environment variables ' +
      '(GitHub Actions secrets in CI; a local, gitignored shell environment for manual runs). ' +
      'This script never reads or accepts credentials via command-line arguments.'
    )
  }

  warnIfUnfavorableTiming()
  await fs.mkdir(OUT_DIR, { recursive: true })

  const cookie = await login(username, password)
  try {
    const query = [
      'class/gp',
      'OBJECT_TYPE/DEBRIS',
      'decay_date/null-val',
      'epoch/%3Enow-30',
      'orderby/NORAD_CAT_ID%20asc',
      'format/json'
    ].join('/')
    const res = await fetch(`${BASE_URL}/basicspacedata/query/${query}`, {
      headers: { Cookie: cookie, 'User-Agent': 'AstriaGraph-Static/1.0' }
    })
    if (!res.ok)
      throw new Error(`Space-Track gp query failed: HTTP ${res.status}`)
    const records = await res.json()
    validateRecords(records, 'debris')

    const debLines = [HEADER, ...records.map(rowFromSpaceTrack)]
    await publishFile(path.join(OUT_DIR, 'www_query_DEB.tsv'), debLines.join('\n'))

    console.log(`Wrote ${records.length} on-orbit debris → www_query_DEB.tsv`)
    console.log('Done.')
  } finally {
    await logout(cookie)
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(err => {
    console.error('[ERROR]', err)
    process.exit(1)
  })
}

export { HEADER, rowFromSpaceTrack, validateRecords, extractCookie, login, logout }
