const assert = require('node:assert/strict')
const test = require('node:test')

function loadModule(tapp) {
  const path = require.resolve('../main.js')
  delete require.cache[path]
  if (tapp) global.Tapp = tapp
  else delete global.Tapp
  return require('../main.js')
}

const parser = loadModule()
const {
  collectUrls,
  pickDownloadUrl,
  parseArchiveTokens,
  archiveVersionIndex,
  fullDeviceName,
  normalizeVersion,
  versionsEquivalent,
  findArchiveRelease
} = parser

test('递归提取并去重 HTTP 与 HTTPS 地址，供结果明确提示传输安全性', () => {
  const output = []
  collectUrls({ a: 'https://example.com/a', b: ['http://unsafe.test/a.zip', 'https://example.com/a'] }, output, {})
  assert.deepEqual(output, ['https://example.com/a', 'http://unsafe.test/a.zip'])
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

test('从 OTA 网页结果节点提取短期解析令牌', () => {
  const html = '<div class="ota-result" id="resultBox" data-url="" data-ota-key="de2bbcde9ab5d659" data-csrf="b44fd3eeece2e0bcfdb019259bc98ed92a836f6070ea87a4bbc4b64df8e1fc91">'
  assert.deepEqual(parseArchiveTokens(html), {
    key: 'de2bbcde9ab5d659',
    csrf: 'b44fd3eeece2e0bcfdb019259bc98ed92a836f6070ea87a4bbc4b64df8e1fc91'
  })
})

test('按第三方网页中的新版本优先顺序计算版本序号', () => {
  const releases = [
    { id: 'old', device: 'OP 15', region: 'CN', version: 'PLK110_16.0.9.500(CN01)', build_timestamp: '2026-07-01T00:00:00' },
    { id: 'new', device: 'OP 15', region: 'CN', version: 'PLK110_16.0.10.500(CN01)', build_timestamp: '2026-07-30T11:31:00' }
  ]
  assert.equal(archiveVersionIndex(releases[1], releases), 0)
  assert.equal(archiveVersionIndex(releases[0], releases), 1)
})

test('界面将设备简称和目录标签展开为完整 OnePlus 名称', () => {
  assert.equal(fullDeviceName('OP 15'), 'OnePlus 15')
  assert.equal(fullDeviceName('[普通]一加9'), 'OnePlus 9')
  assert.equal(fullDeviceName('[C16动态解析]OnePlus 15'), 'OnePlus 15')
  assert.equal(fullDeviceName('OPPO FIND X8 PRO'), 'OPPO FIND X8 PRO')
})

test('版本归一化可匹配目录展示名和实际 OTA 版本号', () => {
  assert.equal(normalizeVersion('ColorOS 11.2 A.03'), '11.2a.03')
  assert.ok(versionsEquivalent('PLK110_16.0.10.500(CN01)', 'OnePlus 15 · PLK110_16.0.10.500(CN01)'))
  const release = findArchiveRelease(
    { device: '[C16动态解析]OnePlus 15', version: 'PLK110_16.0.10.500(CN01)' },
    [{ device: 'OP 15', version: 'PLK110_16.0.10.500(CN01)', build_timestamp: '2026-07-30T11:31:00' }]
  )
  assert.equal(release.device, 'OP 15')
})

test('自有固定缓存命中时不请求第三方目录或 VioletTool', async () => {
  const calls = []
  const module = loadModule({
    api: async (name) => {
      calls.push(name)
      if (name === 'fixedLink') return { found: true, url: 'https://cdn.example.test/ota.zip', dynamic: false }
      throw new Error('不应调用后续来源')
    }
  })
  const result = await module.resolveTask({ packageType: 'full', brand: 'OnePlus', series: '数字系列', device: 'OP 15', version: 'PLK110_16.0.10.500(CN01)' }, [])
  assert.equal(result.source, 'self-cache')
  assert.deepEqual(calls, ['fixedLink'])
})

test('缓存未命中且第三方目录无匹配时回退 VioletTool', async () => {
  const calls = []
  const module = loadModule({
    api: async (name) => {
      calls.push(name)
      if (name === 'fixedLink') return { found: false }
      if (name === 'violetResolve') return { url: 'https://cdn.example.test/violet.zip' }
      throw new Error('不应调用该接口')
    }
  })
  const result = await module.resolveTask({ packageType: 'full', brand: 'OnePlus', series: '数字系列', device: 'OP 15', version: 'PLK110_16.0.10.500(CN01)' }, [])
  assert.equal(result.source, 'violettool')
  assert.deepEqual(calls, ['fixedLink', 'violetResolve'])
})

test('VioletTool 返回 HTTP ZIP 时保留结果且不终止解析', async () => {
  const module = loadModule({
    api: async (name) => {
      if (name === 'fixedLink') return { found: false }
      if (name === 'violetResolve') return { url: 'http://download.h2os.com/OnePlus9/MP/LE2110_11_A_OTA_0031_all_7bf6d3_10010111.zip' }
      throw new Error('不应调用该接口')
    }
  })
  const result = await module.resolveTask({ packageType: 'full', brand: 'OnePlus', series: '数字系列', device: '[普通]一加9', version: 'ColorOS 11.2 A.03' }, [])
  assert.equal(result.resolved, true)
  assert.equal(result.source, 'violettool')
  assert.match(result.note, /HTTP/)
})

test('VioletTool 返回落地页时作为非标准地址展示而非抛错', async () => {
  const landing = 'https://xiaomirom.com/download/redmi-k70-ultra-rothko-stable-OS1.0.12.0.UNNCNXM/'
  const module = loadModule({
    api: async (name) => {
      if (name === 'fixedLink') return { found: false }
      if (name === 'violetResolve') return { url: landing }
      throw new Error('不应调用该接口')
    }
  })
  const result = await module.resolveTask({ packageType: 'afterSales', brand: 'Redmi', series: 'K系列', device: '红米 K70 至尊版 rothko', version: 'OS1.0.12.0.UNNCNXM' }, [])
  assert.equal(result.resolved, false)
  assert.equal(result.url, landing)
  assert.match(result.note, /落地页|非标准地址/)
})
