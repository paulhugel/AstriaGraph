#!/usr/bin/env node
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { HEADER, rowFromCelestrak, validateRecords, fetchSatcatActiveMap } from './fetch_celestrak.mjs'

const validRecord = {
  OBJECT_NAME: 'TESTSAT', OBJECT_ID: '2026-001A', NORAD_CAT_ID: 100178,
  EPOCH: '2026-08-02T00:00:00.000Z', MEAN_MOTION: 15.2,
  ECCENTRICITY: 0.001, INCLINATION: 51.6, RA_OF_ASC_NODE: 10,
  ARG_OF_PERICENTER: 20, MEAN_ANOMALY: 30,
}

validateRecords([validRecord], 'fixture')
assert.throws(() => validateRecords([], 'empty'), /No empty records/)
assert.throws(() => validateRecords([{ ...validRecord, NORAD_CAT_ID: undefined }], 'missing-id'), /NORAD_CAT_ID/)
assert.throws(() => validateRecords([{ ...validRecord, NORAD_CAT_ID: 0 }], 'zero-id'), /positive/)
assert.throws(() => validateRecords([{ ...validRecord, NORAD_CAT_ID: -1 }], 'negative-id'), /positive/)
assert.throws(() => validateRecords([{ ...validRecord, ECCENTRICITY: 1 }], 'bad-eccentricity'), /Eccentricity/)
assert.throws(() => validateRecords([{ ...validRecord, MEAN_MOTION: 'not-a-number' }], 'bad-orbit'), /MEAN_MOTION/)
assert.throws(() => validateRecords([{ ...validRecord, MEAN_MOTION: 0 }], 'zero-motion'), /positive/)
assert.throws(() => validateRecords([{ ...validRecord, EPOCH: 'not-a-date' }], 'bad-epoch'), /EPOCH/)

const row = rowFromCelestrak(validRecord).split('\t')
assert.equal(row.length, HEADER.split('\t').length)
assert.equal(row.length, 27)
assert.equal(row[0], 'CELESTRAK')
assert.equal(row[4], '100178')
assert.equal(row[18], validRecord.EPOCH)
assert.equal(row[5], '') // BirthDate blank without SATCAT enrichment
assert.equal(row[6], '') // Operator blank without SATCAT enrichment
assert.equal(row[25], '') // OpsStatusCode blank without SATCAT enrichment
assert.equal(row[26], '') // ObjectType blank without SATCAT enrichment

// SATCAT enrichment: join hit populates BirthDate/Operator/OpsStatusCode/ObjectType
const satcatMap = new Map([
  ['100178', { LAUNCH_DATE: '2026-07-01', OWNER: 'US', OPS_STATUS_CODE: '+', OBJECT_TYPE: 'PAY' }],
])
const enrichedRow = rowFromCelestrak(validRecord, satcatMap).split('\t')
assert.equal(enrichedRow.length, 27)
assert.equal(enrichedRow[5], '2026-07-01')
assert.equal(enrichedRow[6], 'US')
assert.equal(enrichedRow[25], '+')
assert.equal(enrichedRow[26], 'PAY')

// SATCAT join miss: NORAD ID not present in the map leaves fields blank, not throwing
const missRow = rowFromCelestrak(validRecord, new Map()).split('\t')
assert.equal(missRow.length, 27)
assert.equal(missRow[5], '')
assert.equal(missRow[6], '')
assert.equal(missRow[25], '')
assert.equal(missRow[26], '')

// A SATCAT record missing individual fields (e.g. unrecognized/blank OPS_STATUS_CODE)
// must not throw, and should fall back to blank for that field only.
const partialSatcatMap = new Map([['100178', { LAUNCH_DATE: '2026-07-01' }]])
const partialRow = rowFromCelestrak(validRecord, partialSatcatMap).split('\t')
assert.equal(partialRow[5], '2026-07-01')
assert.equal(partialRow[6], '')
assert.equal(partialRow[25], '')
assert.equal(partialRow[26], '')

// SATCAT fetch failure must degrade gracefully: fetchSatcatActiveMap() should
// resolve to an empty Map, not throw and not block publication of NODEB.
{
  const realFetch = global.fetch
  global.fetch = async () => ({ ok: false, status: 500 })
  try {
    const map = await fetchSatcatActiveMap()
    assert.ok(map instanceof Map)
    assert.equal(map.size, 0)
  } finally {
    global.fetch = realFetch
  }
}

// A malformed (non-array) SATCAT response must also degrade gracefully.
{
  const realFetch = global.fetch
  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ not: 'an array' }) })
  try {
    const map = await fetchSatcatActiveMap()
    assert.ok(map instanceof Map)
    assert.equal(map.size, 0)
  } finally {
    global.fetch = realFetch
  }
}

// A successful SATCAT response is keyed by NORAD_CAT_ID as a string.
{
  const realFetch = global.fetch
  global.fetch = async () => ({
    ok: true, status: 200,
    json: async () => ([{ NORAD_CAT_ID: 900, OPS_STATUS_CODE: '+', OBJECT_TYPE: 'PAY' }]),
  })
  try {
    const map = await fetchSatcatActiveMap()
    assert.equal(map.size, 1)
    assert.equal(map.get('900').OPS_STATUS_CODE, '+')
  } finally {
    global.fetch = realFetch
  }
}

const mainSource = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8')
assert.match(mainSource, /function UseStaticFallback\(/)
assert.match(mainSource, /function ValidateTsvResponse\(/)
assert.match(mainSource, /function ValidateDataSourceResponse\(/)
assert.match(mainSource, /sourceIndex = hdrs.indexOf\('Code'\)/)
assert.match(mainSource, /function StartDataLoad\(/)
assert.match(mainSource, /DataLoadStarted/)
assert.match(mainSource, /preload timed out/)
assert.match(mainSource, /Cesium preload unavailable; loading data/)
assert.doesNotMatch(mainSource, /object_name:\s|norad_id:\s/)
console.log('CelesTrak validation fixtures passed')
