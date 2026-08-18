#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const input = resolve(process.argv[2] || 'violettool.top_2026_08_18_15_05_46.har')
const output = resolve(process.argv[3] || 'apps/top.360nenz.ota-link/tests/fixtures/smarttool-catalog.snapshot.json')
const har = JSON.parse(readFileSync(input, 'utf8'))
const snapshot = {
  schemaVersion: 1,
  source: 'https://violettool.top/rom-api',
  capturedAt: har.log?.pages?.[0]?.startedDateTime || null,
  requestCount: har.log?.entries?.length || 0,
  endpointCounts: {},
  packages: {},
}

function itemsFrom(entry) {
  let text = entry.response?.content?.text || ''
  if (entry.response?.content?.encoding === 'base64') text = Buffer.from(text, 'base64').toString('utf8')
  try {
    const payload = JSON.parse(text)
    return Array.isArray(payload.items) ? payload.items : []
  } catch {
    return []
  }
}

for (const entry of har.log?.entries || []) {
  const url = new URL(entry.request.url)
  if (!url.pathname.startsWith('/rom-api/')) continue
  const endpoint = url.pathname.slice('/rom-api/'.length)
  snapshot.endpointCounts[endpoint] = (snapshot.endpointCounts[endpoint] || 0) + 1
  const packageType = url.searchParams.get('packageType') || ''
  const brand = url.searchParams.get('brand') || ''
  if (!packageType || !brand) continue
  const packageNode = (snapshot.packages[packageType] ||= {})
  const brandNode = (packageNode[brand] ||= { series: {}, counts: { series: 0, devices: 0, sampledVersions: 0 } })
  const items = itemsFrom(entry)
  if (endpoint === 'series') {
    for (const series of items) brandNode.series[series] ||= { devices: {} }
  } else if (endpoint === 'devices') {
    const series = url.searchParams.get('series') || ''
    const seriesNode = (brandNode.series[series] ||= { devices: {} })
    for (const device of items) seriesNode.devices[device] ||= []
  } else if (endpoint === 'versions') {
    const series = url.searchParams.get('series') || ''
    const device = url.searchParams.get('device') || ''
    const seriesNode = (brandNode.series[series] ||= { devices: {} })
    seriesNode.devices[device] = items.map((item) => typeof item === 'string' ? item : item?.name).filter(Boolean)
  }
}

for (const packageNode of Object.values(snapshot.packages)) {
  for (const brandNode of Object.values(packageNode)) {
    brandNode.counts.series = Object.keys(brandNode.series).length
    for (const seriesNode of Object.values(brandNode.series)) {
      brandNode.counts.devices += Object.keys(seriesNode.devices).length
      for (const versions of Object.values(seriesNode.devices)) brandNode.counts.sampledVersions += versions.length
    }
  }
}

mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, JSON.stringify(snapshot, null, 2) + '\n')
console.log(JSON.stringify({ input, output, packages: Object.keys(snapshot.packages), endpointCounts: snapshot.endpointCounts }))
