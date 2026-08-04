#!/usr/bin/env node
import assert from 'node:assert/strict'
import { HEADER, rowFromSpaceTrack, validateRecords, extractCookie, login, logout } from './fetch_spacetrack_debris.mjs'

const validRecord = {
  OBJECT_NAME: 'VANGUARD DEB', OBJECT_ID: '1958-002C', NORAD_CAT_ID: '1576',
  EPOCH: '2026-08-03T10:40:44.566464', SEMIMAJOR_AXIS: '7977.735',
  ECCENTRICITY: '0.01077001', INCLINATION: '47.2116', RA_OF_ASC_NODE: '263.1279',
  ARG_OF_PERICENTER: '336.2661', MEAN_ANOMALY: '23.3184',
  OBJECT_TYPE: 'DEBRIS', LAUNCH_DATE: '1960-08-12', COUNTRY_CODE: 'US',
  DECAY_DATE: null,
}

validateRecords([validRecord], 'fixture')
assert.throws(() => validateRecords([], 'empty'), /No empty records/)
assert.throws(() => validateRecords([{ ...validRecord, NORAD_CAT_ID: undefined }], 'missing-id'), /NORAD_CAT_ID/)
assert.throws(() => validateRecords([{ ...validRecord, NORAD_CAT_ID: 0 }], 'zero-id'), /positive/)
assert.throws(() => validateRecords([{ ...validRecord, NORAD_CAT_ID: -1 }], 'negative-id'), /positive/)
assert.throws(() => validateRecords([{ ...validRecord, ECCENTRICITY: 1 }], 'bad-eccentricity'), /Eccentricity/)
assert.throws(() => validateRecords([{ ...validRecord, SEMIMAJOR_AXIS: 'not-a-number' }], 'bad-orbit'), /SEMIMAJOR_AXIS/)
assert.throws(() => validateRecords([{ ...validRecord, SEMIMAJOR_AXIS: 0 }], 'zero-sma'), /positive/)
assert.throws(() => validateRecords([{ ...validRecord, EPOCH: 'not-a-date' }], 'bad-epoch'), /EPOCH/)

const row = rowFromSpaceTrack(validRecord).split('\t')
assert.equal(row.length, HEADER.split('\t').length)
assert.equal(row.length, 27)
assert.equal(row[0], 'SPACETRACK')
assert.equal(row[1], 'VANGUARD DEB')
assert.equal(row[2], 'US')
assert.equal(row[3], '1958-002C')
assert.equal(row[4], '1576')
assert.equal(row[5], '1960-08-12') // BirthDate <- LAUNCH_DATE
assert.equal(row[17], 'LEO') // OrbitType derived from SEMIMAJOR_AXIS/Ecc (~1600 km altitude)
assert.equal(row[18], validRecord.EPOCH)
assert.equal(Number(row[19]), 7977735) // SMA: km -> m
assert.equal(row[25], '') // OpsStatusCode: not a Space-Track concept
assert.equal(row[26], 'DEBRIS') // ObjectType preserved as Space-Track spells it (not abbreviated)

// A record missing optional fields (COUNTRY_CODE, LAUNCH_DATE) must not throw,
// and should fall back to blank for those fields only.
const partial = { ...validRecord }
delete partial.COUNTRY_CODE
delete partial.LAUNCH_DATE
const partialRow = rowFromSpaceTrack(partial).split('\t')
assert.equal(partialRow[2], '')
assert.equal(partialRow[5], '')

// extractCookie: multiple Set-Cookie values get folded into one Cookie header,
// each trimmed to just name=value (dropping Path/HttpOnly/etc attributes).
assert.equal(extractCookie(null), '')
assert.equal(extractCookie([]), '')
assert.equal(
  extractCookie(['chocolatechip=abc123; Path=/; HttpOnly', 'sessionid=xyz789; Path=/']),
  'chocolatechip=abc123; sessionid=xyz789'
)

// login(): failure modes, all against a stubbed global.fetch — no real
// network or credentials involved.
async function withStubbedFetch(responses, run) {
  const realFetch = global.fetch
  let call = 0
  global.fetch = async (url) => {
    const r = responses[call]
    call++
    if (!r) throw new Error(`unexpected extra fetch call: ${url}`)
    return r
  }
  try {
    return await run()
  } finally {
    global.fetch = realFetch
  }
}

{
  // Login POST itself fails (bad credentials rejected at the HTTP level,
  // or the endpoint is unreachable).
  await withStubbedFetch([{ ok: false, status: 401 }], async () => {
    await assert.rejects(() => login('user', 'pass'), /login request failed: HTTP 401/)
  })
}

{
  // Login POST succeeds but returns no Set-Cookie at all.
  await withStubbedFetch([
    { ok: true, status: 200, headers: { getSetCookie: () => [] } },
  ], async () => {
    await assert.rejects(() => login('user', 'pass'), /did not return a session cookie/)
  })
}

{
  // Login POST succeeds with a cookie, but whoami says we're not actually
  // logged in — this is the case a wrong password produces (space-track
  // still returns HTTP 200 with an error body on bad credentials).
  await withStubbedFetch([
    { ok: true, status: 200, headers: { getSetCookie: () => ['chocolatechip=abc; Path=/'] } },
    { ok: true, status: 200, json: async () => ({ logged_in: false, identity: null }) },
  ], async () => {
    await assert.rejects(() => login('user', 'wrongpass'), /whoami reports not logged in/)
  })
}

{
  // Full success path: cookie captured, whoami confirms logged_in true.
  await withStubbedFetch([
    { ok: true, status: 200, headers: { getSetCookie: () => ['chocolatechip=abc; Path=/; HttpOnly'] } },
    { ok: true, status: 200, json: async () => ({ logged_in: true, identity: 'user' }) },
  ], async () => {
    const cookie = await login('user', 'pass')
    assert.equal(cookie, 'chocolatechip=abc')
  })
}

{
  // logout() must never throw, even if the request itself fails — a failed
  // logout is not fatal, the cookie just expires on its own.
  const realFetch = global.fetch
  global.fetch = async () => { throw new Error('network down') }
  try {
    await logout('chocolatechip=abc') // must not throw
  } finally {
    global.fetch = realFetch
  }
}

console.log('Space-Track validation fixtures passed')
