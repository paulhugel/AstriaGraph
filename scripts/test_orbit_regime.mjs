#!/usr/bin/env node
import assert from 'node:assert/strict'
import { classifyOrbitRegime } from './lib/orbit_regime.mjs'

const km = n => n * 1000

// Reverse-engineered against real intactData.js sample rows (see
// scripts/lib/orbit_regime.mjs comment) - all of these are actual
// SMA/Ecc pairs from that dataset, paired with their original L/M/G/H label.
assert.equal(classifyOrbitRegime(km(7141.180), 0.001037), 'LEO') // GEOSAT
assert.equal(classifyOrbitRegime(km(8067.651), 0.070889), 'LEO') // EXPLORER 29
assert.equal(classifyOrbitRegime(km(7882.294), 0.002976), 'LEO') // GEO IK (name is misleading; orbit is LEO)
assert.equal(classifyOrbitRegime(km(12165.432), 0.014148), 'MEO') // LAGEOS 2
assert.equal(classifyOrbitRegime(km(42418.954), 0.000118), 'GEO') // GEOS 2
assert.equal(classifyOrbitRegime(km(126744.387), 0.500645), 'HEO') // GEOTAIL (huge SMA, but Ecc wins)

// Boundary and degenerate inputs
assert.equal(classifyOrbitRegime('', 0.001), '') // missing SMA (join miss / absent field)
assert.equal(classifyOrbitRegime(0, 0.001), '')
assert.equal(classifyOrbitRegime(-1, 0.001), '')
assert.equal(classifyOrbitRegime(km(7000), 'not-a-number'), 'LEO') // bad Ecc falls through to altitude bucketing, not HEO

console.log('Orbit regime classification fixtures passed')
