#!/usr/bin/env node
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { HEADER, rowFromCelestrak, validateRecords } from './fetch_celestrak.mjs'

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
assert.equal(row[0], 'CELESTRAK')
assert.equal(row[4], '100178')
assert.equal(row[18], validRecord.EPOCH)

const mainSource = fs.readFileSync(new URL('../main.js', import.meta.url), 'utf8')
assert.match(mainSource, /function UseStaticFallback\(/)
assert.match(mainSource, /function ValidateTsvResponse\(/)
assert.doesNotMatch(mainSource, /object_name:\s|norad_id:\s/)
console.log('CelesTrak validation fixtures passed')
