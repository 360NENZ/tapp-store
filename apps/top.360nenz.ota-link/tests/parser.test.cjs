const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const { buildCatalog, collectUrls, pickDownloadUrl, parseArchiveTokens, archiveVersionIndex, findArchiveRelease, fullDeviceName, normalizedDeviceName, violetParams, linkTiming, isFixedOwnRecord, formatBytes } = require('../main.js')

test('按设备和地区构建三级目录并将新版本排在前面', () => {
  const oldRelease = { id: 'old', device: 'OP 13', region: 'EU', version: '1.0', build_timestamp: '2026-01-01T00:00:00' }
  const newRelease = { id: 'new', device: 'OP 13', region: 'EU', version: '2.0', build_timestamp: '2026-02-01T00:00:00' }
  const otherRegion = { id: 'cn', device: 'OP 13', region: 'CN', version: '3.0' }
  const catalog = buildCatalog([oldRelease, otherRegion, newRelease])
  assert.deepEqual(Object.keys(catalog['OP 13']).sort(), ['CN', 'EU'])
  assert.deepEqual(catalog['OP 13'].EU.map((release) => release.id), ['new', 'old'])
})

test('递归提取并去重 HTTPS 地址', () => {
  const output = []
  collectUrls({ a: 'https://example.com/a', b: ['http://unsafe.test', 'https://example.com/a'] }, output, {})
  assert.deepEqual(output, ['https://example.com/a'])
})

test('优先选择与版本匹配的 OTA 压缩包', () => {
  const release = { version: 'OS3.0.303.0.WOCEUXM', ota_version: 'dada_eea_global-ota_full-OS3.0.303.0.WOCEUXM' }
  const payload = {
    changelog: 'https://example.com/changelog.html',
    other: 'https://example.com/old.zip',
    rom_url: 'https://ultimateota.d.miui.com/OS3.0.303.0.WOCEUXM/dada_eea_global-ota_full-OS3.0.303.0.WOCEUXM.zip?t=1'
  }
  assert.equal(pickDownloadUrl(payload, release), payload.rom_url)
})

test('格式化 OTA 包字节数', () => {
  assert.equal(formatBytes(8304912951), '7.73 GiB')
  assert.equal(formatBytes(undefined), '—')
})

test('从 OTA 网页结果节点提取短期解析令牌', () => {
  const html = '<div class="ota-result" id="resultBox" data-url="" data-ota-key="de2bbcde9ab5d659" data-csrf="b44fd3eeece2e0bcfdb019259bc98ed92a836f6070ea87a4bbc4b64df8e1fc91">'
  assert.deepEqual(parseArchiveTokens(html), {
    key: 'de2bbcde9ab5d659',
    csrf: 'b44fd3eeece2e0bcfdb019259bc98ed92a836f6070ea87a4bbc4b64df8e1fc91'
  })
})

test('按网页中的新版本优先顺序计算版本序号', () => {
  const releases = [
    { id: 'old', device: 'OP 15', region: 'CN', version: 'PLK110_16.0.9.500(CN01)', build_timestamp: '2026-07-01T00:00:00' },
    { id: 'new', device: 'OP 15', region: 'CN', version: 'PLK110_16.0.10.500(CN01)', build_timestamp: '2026-07-30T11:31:00' }
  ]
  assert.equal(archiveVersionIndex(releases[1], releases), 0)
  assert.equal(archiveVersionIndex(releases[0], releases), 1)
})

test('界面将 OP 设备简称展开为 OnePlus 全称', () => {
  assert.equal(fullDeviceName('OP 15'), 'OnePlus 15')
  assert.equal(fullDeviceName('OPPO FIND X8 PRO'), 'OPPO FIND X8 PRO')
})

test('匹配 SmartTool 的 C16 设备名称并推断 OnePlus 数字系列', () => {
  assert.equal(normalizedDeviceName('[C16动态解析]OnePlus 15'), normalizedDeviceName('OP 15'))
  assert.deepEqual(violetParams({ device: 'OP 15', version: 'PLK110_16.0.3.502(CN01)' }), {
    packageType: 'full',
    brand: 'OnePlus',
    series: '数字系列',
    device: 'OP 15',
    version: 'PLK110_16.0.3.502(CN01)'
  })
})

test('SmartTool 机型和版本可反查第三方归档目录记录', () => {
  const release = findArchiveRelease({ device: '[C16动态解析]OnePlus 15', version: 'PLK110_16.0.3.502(CN01)' }, [
    { id: 'eu', device: 'OP 15', region: 'EU', version: 'PLK110_16.0.3.502(CN01)' },
    { id: 'cn', device: 'OP 15', region: 'CN', version: 'PLK110_16.0.3.502(CN01)' }
  ])
  assert.equal(release.id, 'cn')
})

test('HAR 快照覆盖两种包型、六个品牌和 SmartTool 关键入口', () => {
  const snapshot = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'smarttool-catalog.snapshot.json'), 'utf8'))
  assert.deepEqual(Object.keys(snapshot.packages).sort(), ['afterSales', 'full'])
  const brands = new Set(Object.values(snapshot.packages).flatMap((pkg) => Object.keys(pkg)))
  for (const brand of ['OPPO', 'OnePlus', 'Realme', 'Xiaomi', 'Redmi', '魅族']) assert.equal(brands.has(brand), true)
  assert.equal(snapshot.endpointCounts.series, 12)
  assert.equal(snapshot.endpointCounts.devices, 60)
  assert.equal(snapshot.endpointCounts.versions, 57)
  assert.ok(snapshot.packages.full.OnePlus.series['数字系列'].devices['[C16动态解析]OnePlus 15'])
})

test('区分固定链接和包含厂商过期签名的动态链接', () => {
  assert.deepEqual(linkTiming('https://example.com/a.zip'), { dynamic: false, expiresAt: '' })
  assert.deepEqual(linkTiming('https://example.com/a.zip?Expires=1893456000&Signature=x'), { dynamic: true, expiresAt: '2030-01-01T00:00:00.000Z' })
})

test('自有 API 只短路固定链接，动态缓存继续走外部解析顺序', () => {
  assert.equal(isFixedOwnRecord({ url: 'https://cdn.example/rom.zip', dynamic: false }), true)
  assert.equal(isFixedOwnRecord({ url: 'https://cdn.example/rom.zip?sign=x', dynamic: true }), false)
  assert.equal(isFixedOwnRecord({ fixedUrl: 'https://cdn.example/rom.tgz' }), true)
  assert.equal(isFixedOwnRecord({ url: 'http://cdn.example/rom.zip', dynamic: false }), false)
})
