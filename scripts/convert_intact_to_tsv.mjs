#!/usr/bin/env node
/*
  Convert UT intactData.js (TSV-in-JS) into AstriaGraph TSVs expected by the viewer.

  Inputs:
    - scripts/intactData.js containing:
        var dataSources = `...TSV...`   // DataSourceId -> Name
        var intactRso    = `...TSV...`   // RSO rows with columns described below

  Outputs:
    - assets/data/www_data_sources.tsv
      Header: Code\tName
      Rows: <DataSourceId>\t<Name>

    - assets/data/www_query_NODEB.tsv (non-debris)
      Header (must match viewer expectations):
        DataSource\tName\tCountry\tCatalogId\tNoradId\tBirthDate\tOperator\tUsers\tPurpose\tDetailedPurpose\tLaunchMass\tDryMass\tPower\tLifetime\tContractor\tLaunchSite\tLaunchVehicle\tOrbitType\tEpoch\tSMA\tEcc\tInc\tRAAN\tArgP\tMeanAnom

  Notes:
    - Inc/RAAN/ArgP/MeanAnom in intactRso appear to be radians already.
    - OrbitType in intactRso uses letters (L/M/G). We map to LEO/MEO/GEO.
    - Multiple epochs per NORAD are preserved as-is.
*/

import fs from 'node:fs/promises'
import path from 'node:path'

const ROOT = process.cwd()
const SRC_FILE = path.join(ROOT, 'scripts', 'intactData.js')
const OUT_DIR  = path.join(ROOT, 'assets', 'data')

function extractBacktick(name, text) {
  // Simple and robust: look for "var <name> = `" and take content until the next unescaped backtick
  const marker = `var ${name} = \``
  const start = text.indexOf(marker)
  if (start === -1) throw new Error(`Could not find start marker for ${name}`)
  const from = start + marker.length
  const end = text.indexOf('`', from)
  if (end === -1) throw new Error(`Could not find end backtick for ${name}`)
  return text.slice(from, end).trim()
}

function parseTSV(tsv) {
  const lines = tsv.split(/\r?\n/).filter(Boolean)
  const header = lines[0].split(/\t/)
  const rows = []
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(/\t/)
    if (cols.length < header.length) continue
    const rec = {}
    for (let j = 0; j < header.length; j++) rec[header[j]] = cols[j]
    rows.push(rec)
  }
  return { header, rows }
}

function mapOrbitType(ch) {
  switch ((ch || '').trim().toUpperCase()) {
    case 'L': return 'LEO'
    case 'M': return 'MEO'
    case 'G': return 'GEO'
    case 'H': return 'HEO'
    default: return ''
  }
}

async function main() {
  const js = await fs.readFile(SRC_FILE, 'utf8')
  const dataSourcesTsv = extractBacktick('dataSources', js)
  const intactRsoTsv   = extractBacktick('intactRso', js)

  const ds = parseTSV(dataSourcesTsv)
  const rso = parseTSV(intactRsoTsv)

  // Build DataSourceId -> Name mapping (normalize 0: USSPACECOM -> USSTRATCOM for viewer semantics)
  const idToName = new Map()
  for (const row of ds.rows) {
    const id = (row['DataSourceId'] ?? '').trim()
    let name = (row['Name'] ?? '').trim()
    if (id === '0' && name.toUpperCase().includes('USSPACE')) name = 'USSTRATCOM'
    if (id) idToName.set(id, name)
  }

  await fs.mkdir(OUT_DIR, { recursive: true })

  // Write www_data_sources.tsv with Code\tName
  const dsOut = ['Code\tName', ...Array.from(idToName, ([id, name]) => `${id}\t${name}`)].join('\n')
  await fs.writeFile(path.join(OUT_DIR, 'www_data_sources.tsv'), dsOut)

  // Dedupe to latest per NoradId, prioritizing sources with valid elements
  const priority = ['0','4','3','1','7'] // USSTRATCOM(0) > SeeSat-L(4) > JSC(3) > Planet(1) > UCS(7)
  const bestByNorad = new Map()

  function hasValidElems(row) {
    const sma = Number(row['SMA'])
    const inc = Number(row['Inc'])
    const ecc = Number(row['Ecc'])
    const raan = Number(row['RAAN'])
    const argp = Number(row['ArgP'])
    const manom = Number(row['MeanAnom'])
    return Number.isFinite(sma) && sma > 0 && [inc,ecc,raan,argp,manom].every(Number.isFinite) && (row['Epoch'] ?? '').trim().length > 0
  }
  function epochToDate(row) {
    const e = (row['Epoch'] ?? '').trim()
    const d = Date.parse(e)
    return Number.isFinite(d) ? d : -Infinity
  }
  function better(a, b) { // return true if a better than b
    if (!b) return true
    const pa = priority.indexOf(String(a['DataSourceId']).trim())
    const pb = priority.indexOf(String(b['DataSourceId']).trim())
    if (pa !== pb) return (pa !== -1 ? pa : 999) < (pb !== -1 ? pb : 999)
    // same priority: prefer newer epoch
    return epochToDate(a) > epochToDate(b)
  }

  for (const row of rso.rows) {
    if (!hasValidElems(row)) continue
    const norad = String(row['NoradId'] ?? '').trim()
    if (!norad) continue
    const prev = bestByNorad.get(norad)
    if (better(row, prev)) bestByNorad.set(norad, row)
  }

  // Prepare NODEB rows
  const headerOut = [
    'DataSource','Name','Country','CatalogId','NoradId','BirthDate','Operator','Users','Purpose','DetailedPurpose',
    'LaunchMass','DryMass','Power','Lifetime','Contractor','LaunchSite','LaunchVehicle','OrbitType','Epoch',
    'SMA','Ecc','Inc','RAAN','ArgP','MeanAnom'
  ]

  const outRows = []
  for (const row of bestByNorad.values()) {
    const dataSourceId = (row['DataSourceId'] ?? '').trim()
    const name = row['Name'] ?? ''
    const country = row['Country'] ?? ''
    const catalogId = row['CatalogId'] ?? ''
    const noradId = row['NoradId'] ?? ''
    const birth = row['BirthDate'] ?? ''
    const operator = row['Operator'] ?? ''
    const users = row['Users'] ?? ''
    const purpose = row['Purpose'] ?? ''
    const dpurpose = row['DetailedPurpose'] ?? ''
    const launchMass = row['LaunchMass'] ?? ''
    const dryMass = row['DryMass'] ?? ''
    const power = row['Power'] ?? ''
    const lifetime = row['Lifetime'] ?? ''
    const contractor = row['Contractor'] ?? ''
    const launchSite = row['LaunchSite'] ?? ''
    const launchVeh = row['LaunchVehicle'] ?? ''
    const orbitType = mapOrbitType(row['OrbitType'] ?? '')
    const epoch = row['Epoch'] ?? ''
    const sma = row['SMA'] ?? ''
    const ecc = row['Ecc'] ?? ''
    const inc = row['Inc'] ?? ''
    const raan = row['RAAN'] ?? ''
    const argp = row['ArgP'] ?? ''
    const meanAnom = row['MeanAnom'] ?? ''

    const cols = [
      dataSourceId,
      name,
      country,
      catalogId,
      noradId,
      birth,
      operator,
      users,
      purpose,
      dpurpose,
      launchMass,
      dryMass,
      power,
      lifetime,
      contractor,
      launchSite,
      launchVeh,
      orbitType,
      epoch,
      sma,
      ecc,
      inc,
      raan,
      argp,
      meanAnom,
    ]
    outRows.push(cols.map(v => (v ?? '').toString()).join('\t'))
  }

  const nodebOut = [headerOut.join('\t'), ...outRows].join('\n')
  await fs.writeFile(path.join(OUT_DIR, 'www_query_NODEB.tsv'), nodebOut)

  console.log(`Wrote data sources: ${idToName.size} → assets/data/www_data_sources.tsv`)
  console.log(`Wrote NODEB rows: ${outRows.length} → assets/data/www_query_NODEB.tsv`)
  console.log('Done.')
}

main().catch(err => { console.error('[ERROR]', err); process.exit(1) })
