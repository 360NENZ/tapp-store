(function () {
  var RESOLVER_BY_HOST = {
    'component-ota-sg.allawnos.com': 'resolveOplusSg',
    'component-ota-eu.allawnos.com': 'resolveOplusEu',
    'component-ota-in.allawnos.com': 'resolveOplusIn',
    'component-ota-cn.allawntech.com': 'resolveOplusCn',
    'sgp-api.buy.mi.com': 'resolveXiaomi'
  };
  var catalogReleases = [];
  var releaseById = {};
  var manualReleaseById = {};
  var SMART_BRANDS = { full: ['OPPO', 'OnePlus', 'Realme', 'Xiaomi', 'Redmi', '魅族'], afterSales: ['OPPO', 'OnePlus', 'Realme', 'Xiaomi', 'Redmi'] };

  function $(id) { return document.getElementById(id); }
  function clean(value) { return String(value || '').trim(); }
  function unwrap(value) {
    return value && value.success === true && Object.prototype.hasOwnProperty.call(value, 'data') ? value.data : value;
  }
  function encode(value) { return encodeURIComponent(clean(value)); }
  function text(node, value, fallback) { node.textContent = clean(value) || fallback || '—'; }
  function fullDeviceName(value) {
    var device = clean(value);
    return /^OP(?:\s|$)/i.test(device) ? device.replace(/^OP(?=\s|$)/i, 'OnePlus') : device;
  }

  function sourceLabel(source) {
    return ({ fixed: '自有 API 固定地址', archive: '第三方 OTA 归档站', violettool: 'VioletTool 动态解析', vendor: '厂商接口', manual: '目录原始地址' })[source] || source || '目录原始地址';
  }

  function linkTiming(url) {
    var result = { dynamic: false, expiresAt: '' };
    try {
      var parsed = new URL(clean(url));
      var expires = Number(parsed.searchParams.get('Expires'));
      if (Number.isFinite(expires) && expires > 0) result.expiresAt = new Date(expires * 1000).toISOString();
      result.dynamic = Boolean(result.expiresAt || parsed.searchParams.get('Signature') || parsed.searchParams.get('sign'));
    } catch (error) {}
    return result;
  }

  function normalizedDeviceName(value) {
    return fullDeviceName(clean(value).replace(/^\[[^\]]+\]/, '')).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '');
  }

  function naturalCompare(a, b) {
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
  }

  function releaseTime(release) {
    var built = Date.parse(release.build_timestamp || '');
    if (Number.isFinite(built)) return built;
    var published = Number(release.published);
    return Number.isFinite(published) ? published : 0;
  }

  function buildCatalog(releases) {
    var catalog = {};
    (Array.isArray(releases) ? releases : []).forEach(function (release) {
      var device = clean(release.device);
      var region = clean(release.region);
      if (!device || !region || !release.id) return;
      if (!catalog[device]) catalog[device] = {};
      if (!catalog[device][region]) catalog[device][region] = [];
      catalog[device][region].push(release);
    });
    Object.keys(catalog).forEach(function (device) {
      Object.keys(catalog[device]).forEach(function (region) {
        catalog[device][region].sort(function (a, b) {
          return releaseTime(b) - releaseTime(a) || naturalCompare(b.version, a.version);
        });
      });
    });
    return catalog;
  }

  function fillSelect(select, values, placeholder, labeler) {
    select.replaceChildren();
    var empty = document.createElement('option');
    empty.value = '';
    empty.textContent = placeholder;
    select.appendChild(empty);
    values.forEach(function (value) {
      var option = document.createElement('option');
      option.value = typeof value === 'string' ? value : clean(value.id || value.value || value.name || value.device || value.version);
      option.textContent = labeler ? labeler(value) : value;
      select.appendChild(option);
    });
    select.disabled = values.length === 0;
    select.value = '';
  }

  function payloadItems(payload, key) {
    var value = unwrap(payload);
    var items = value && (value.items || value[key] || value.data || value);
    return Array.isArray(items) ? items : [];
  }

  function applyTheme(theme) {
    var dark = theme === true || theme === 'dark' || theme === 'Dark';
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.classList.toggle('light', !dark);
  }

  async function bindTheme() {
    try {
      var current = Tapp.ui.getTheme();
      applyTheme(current && typeof current.then === 'function' ? await current : current);
      Tapp.ui.onThemeChange(applyTheme);
    } catch (error) {
      applyTheme(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    }
  }

  async function notify(message, type) {
    try {
      await Tapp.ui.showNotification({
        title: type === 'error' ? '操作失败' : type === 'warning' ? '请注意' : '操作成功',
        message: message,
        type: type || 'success',
        duration: 3200
      });
    } catch (error) {}
  }

  async function copy(value, label) {
    var copied = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(value);
        copied = true;
      }
    } catch (error) {}
    if (!copied) {
      var box = document.createElement('textarea');
      box.value = value;
      box.style.position = 'fixed';
      box.style.opacity = '0';
      document.body.appendChild(box);
      box.select();
      try { copied = document.execCommand('copy'); } catch (error) {}
      box.remove();
    }
    await notify(copied ? label + '已复制' : '复制失败，请手动选择链接', copied ? 'success' : 'error');
  }

  function collectUrls(value, output, seen) {
    if (typeof value === 'string') {
      if (/^https:\/\//i.test(value) && !seen[value]) { seen[value] = true; output.push(value); }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(function (item) { collectUrls(item, output, seen); });
      return;
    }
    if (value && typeof value === 'object') {
      Object.keys(value).forEach(function (key) { collectUrls(value[key], output, seen); });
    }
  }

  function scoreUrl(url, release) {
    var score = 0;
    var lower = url.toLowerCase();
    if (/\.(zip|ozip|bin|tgz|gz|img)(\?|$)/i.test(url)) score += 100;
    if (/download|ota|rom|package/.test(lower)) score += 20;
    if (release.ota_version && lower.indexOf(String(release.ota_version).toLowerCase()) !== -1) score += 40;
    if (release.version && lower.indexOf(String(release.version).toLowerCase()) !== -1) score += 30;
    if (/changelog|\.html?(\?|$)/i.test(url)) score -= 100;
    return score;
  }

  function pickDownloadUrl(payload, release) {
    var urls = [];
    collectUrls(payload, urls, {});
    urls.sort(function (a, b) { return scoreUrl(b, release) - scoreUrl(a, release); });
    return urls.length && scoreUrl(urls[0], release) > 0 ? urls[0] : '';
  }

  function parseArchiveTokens(html) {
    var source = typeof html === 'string' ? html : '';
    var resultTag = source.match(/<[^>]*\bid=["']resultBox["'][^>]*>/i);
    if (!resultTag) return { key: '', csrf: '' };
    var key = resultTag[0].match(/\bdata-ota-key=["']([^"']+)["']/i);
    var csrf = resultTag[0].match(/\bdata-csrf=["']([^"']+)["']/i);
    return { key: key ? key[1] : '', csrf: csrf ? csrf[1] : '' };
  }

  function archiveVersionIndex(release, releases) {
    var matching = (Array.isArray(releases) ? releases : []).filter(function (item) {
      return clean(item.device) === clean(release.device) && clean(item.region) === clean(release.region);
    });
    if (!matching.some(function (item) { return clean(item.version) === clean(release.version); })) matching.push(release);
    matching.sort(function (a, b) {
      return releaseTime(b) - releaseTime(a) || naturalCompare(b.version, a.version);
    });
    return matching.findIndex(function (item) { return clean(item.version) === clean(release.version); });
  }

  function findArchiveRelease(release, releases) {
    var version = clean(release && release.version);
    var device = normalizedDeviceName(release && release.device);
    if (!version || !device) return null;
    var matches = (Array.isArray(releases) ? releases : []).filter(function (item) {
      return clean(item.version) === version && normalizedDeviceName(item.device) === device;
    });
    if (!matches.length) return null;
    var preferredRegion = clean(release.region);
    return matches.find(function (item) { return preferredRegion && clean(item.region) === preferredRegion; }) || matches.find(function (item) { return clean(item.region) === 'CN'; }) || matches[0];
  }

  function createSessionId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, '');
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      var bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      return Array.from(bytes, function (value) { return value.toString(16).padStart(2, '0'); }).join('');
    }
    return String(Date.now()) + Math.random().toString(16).slice(2).padEnd(19, '0').slice(0, 19);
  }

  async function resolveViaArchive(release) {
    var versionIndex = archiveVersionIndex(release, catalogReleases);
    if (versionIndex < 0) throw new Error('无法确定网页目录中的版本序号');
    var sessionId = createSessionId();
    var page = unwrap(await Tapp.api('prepareArchiveOta', {
      sessionId: sessionId,
      device: clean(release.device),
      region: clean(release.region),
      versionIndex: String(versionIndex)
    }));
    var tokens = parseArchiveTokens(page);
    if (!tokens.key || !tokens.csrf) throw new Error('OTA 网页没有返回有效的解析令牌');
    var payload = unwrap(await Tapp.api('resolveArchiveOta', {
      sessionId: sessionId,
      key: tokens.key,
      csrf: tokens.csrf
    }));
    var resolved = payload && /^https:\/\//i.test(clean(payload.url)) ? clean(payload.url) : pickDownloadUrl(payload, release);
    if (!resolved || !payload || payload.ok === false) {
      throw new Error(payload && payload.message ? payload.message : 'OTA 网页未返回签名下载链接');
    }
    return resolved;
  }

  async function callResolver(apiName, query) {
    if (apiName === 'resolveOplusSg') return Tapp.api('resolveOplusSg', { query: query });
    if (apiName === 'resolveOplusEu') return Tapp.api('resolveOplusEu', { query: query });
    if (apiName === 'resolveOplusIn') return Tapp.api('resolveOplusIn', { query: query });
    if (apiName === 'resolveOplusCn') return Tapp.api('resolveOplusCn', { query: query });
    if (apiName === 'resolveXiaomi') return Tapp.api('resolveXiaomi', { query: query });
    throw new Error('不支持的厂商解析入口');
  }

  function violetParams(release) {
    var deviceName = String(release.device || '');
    var lower = deviceName.toLowerCase();
    var brand = clean(release.brand);
    if (!brand) {
      if (/oppo|find|reno|a9|a5|pad 3/i.test(deviceName)) brand = 'OPPO';
      else if (/realme|真我|gt neo|gt7/i.test(deviceName)) brand = 'Realme';
      else if (/redmi/i.test(deviceName)) brand = 'Redmi';
      else if (/xiaomi|小米|civi|mix/i.test(deviceName)) brand = 'Xiaomi';
      else if (/魅族|meizu/i.test(deviceName)) brand = '魅族';
      else brand = 'OnePlus';
    }
    var series = clean(release.series);
    if (!series && brand === 'OnePlus') series = /pad/i.test(lower) ? 'Pad系列' : /ace/i.test(lower) ? 'ACE系列' : /turbo/i.test(lower) ? 'Turbo系列' : '数字系列';
    return {
      packageType: clean(release.package_type || release.packageType) || 'full',
      brand: brand,
      series: series,
      device: clean(release.device),
      version: clean(release.version)
    };
  }

  async function resolveViaVioletTool(release) {
    var p = violetParams(release);
    var series = p.series;
    if (!series) {
      var seriesPayload = unwrap(await Tapp.api('violetSeries', { packageType: encode(p.packageType), brand: encode(p.brand) }));
      var seriesList = seriesPayload && (seriesPayload.items || seriesPayload.series || seriesPayload.data || seriesPayload);
      if (Array.isArray(seriesList)) series = seriesList.find(function (x) { return clean(x.name || x) === clean(release.series); });
      series = typeof series === 'string' ? series : clean(release.series);
    }
    if (!series) throw new Error('VioletTool 未确定设备系列');
    var devicePayload = unwrap(await Tapp.api('violetDevices', { packageType: encode(p.packageType), brand: encode(p.brand), series: encode(series) }));
    var deviceList = devicePayload && (devicePayload.items || devicePayload.devices || devicePayload.data || devicePayload);
    var dynamicDevice = clean(release.device);
    if (Array.isArray(deviceList)) {
      var match = deviceList.find(function (x) { return normalizedDeviceName(x.name || x.device || x) === normalizedDeviceName(dynamicDevice); });
      if (match) dynamicDevice = clean(match.name || match.device || match);
    }
    var versionPayload = unwrap(await Tapp.api('violetVersions', { packageType: encode(p.packageType), brand: encode(p.brand), series: encode(series), device: encode(dynamicDevice) }));
    var versions = versionPayload && (versionPayload.items || versionPayload.versions || versionPayload.data || versionPayload);
    if (Array.isArray(versions) && versions.length && !versions.some(function (x) { return clean(x.version || x.name || x) === p.version; })) throw new Error('VioletTool 未收录该版本');
    var payload = unwrap(await Tapp.api('violetDownload', { packageType: p.packageType, brand: p.brand, series: series, device: dynamicDevice, version: p.version }));
    var resolved = pickDownloadUrl(payload, release);
    if (!resolved) throw new Error(payload && (payload.errorMessage || payload.message) || 'VioletTool 未返回下载链接');
    return resolved;
  }

  async function resolveRelease(release) {
    var source = clean(release.source_url);
    try {
      var ownParams = violetParams(release);
      var own = unwrap(await Tapp.api('otaOwnResolve', { brand: encode(ownParams.brand), packageType: encode(ownParams.packageType), series: encode(ownParams.series), device: encode(release.device), version: encode(release.version), region: encode(release.region), id: encode(release.id) }));
      var ownUrl = own && (own.url || own.fixedUrl);
      if (ownUrl && /^https:\/\//i.test(clean(ownUrl))) return { url: clean(ownUrl), resolved: true, source: 'fixed', dynamic: Boolean(own.dynamic), expiresAt: own.expiresAt || '', note: sourceLabel('fixed') + (own.dynamic ? '（短期缓存）' : '') };
    } catch (error) {}
    if (!source) return { url: '', resolved: false, note: '目录未提供源地址' };
    if (/\.(zip|ozip|bin|tgz|gz|img)(\?|$)/i.test(source)) {
      return { url: source, resolved: true, source: 'vendor', note: '目录已提供直接下载链接' };
    }
    var parsed;
    try { parsed = new URL(source); } catch (error) {
      return { url: source, resolved: false, note: '源地址格式无法识别' };
    }
    var apiName = RESOLVER_BY_HOST[parsed.hostname.toLowerCase()];
    if (!apiName) {
      try {
        var unknownArchiveRelease = findArchiveRelease(release, catalogReleases);
        if (unknownArchiveRelease) {
          var unknownArchiveUrl = await resolveViaArchive(unknownArchiveRelease);
          var unknownArchiveTiming = linkTiming(unknownArchiveUrl);
          return { url: unknownArchiveUrl, resolved: true, source: 'archive', dynamic: unknownArchiveTiming.dynamic, expiresAt: unknownArchiveTiming.expiresAt, note: '已通过 Daniel Springer 第三方归档站取得下载链接' };
        }
      } catch (archiveUnknownError) {}
      try {
        var violetUnknown = await resolveViaVioletTool(release);
        return { url: violetUnknown, resolved: true, source: 'violettool', dynamic: true, note: '目录入口未匹配，已由 VioletTool 生成临时下载链接（过期后请重新解析）' };
      } catch (unknownError) {
        return { url: source, resolved: false, source: 'manual', note: '未匹配第三方解析入口，已回退到目录原始地址' };
      }
    }
    var archiveError = '';
    try {
      var archived = await resolveViaArchive(release);
      var archiveTiming = linkTiming(archived);
      return { url: archived, resolved: true, source: 'archive', dynamic: archiveTiming.dynamic, expiresAt: archiveTiming.expiresAt, note: archiveTiming.dynamic ? '已通过 Daniel Springer 第三方归档站生成带签名的临时下载直链（过期后请重新解析）' : '已通过 Daniel Springer 第三方归档站取得固定下载链接' };
    } catch (error) {
      archiveError = error && error.message ? error.message : String(error);
    }
    try {
      var violetBeforeVendor = await resolveViaVioletTool(release);
      var violetTiming = linkTiming(violetBeforeVendor);
      return { url: violetBeforeVendor, resolved: true, source: 'violettool', dynamic: violetTiming.dynamic, expiresAt: violetTiming.expiresAt, note: violetTiming.dynamic ? '归档站解析失败，已由 VioletTool 生成临时下载链接（过期后请重新解析）' : '归档站未返回结果，已由 VioletTool 取得固定下载链接' };
    } catch (violetBeforeVendorError) {}
    try {
      var payload = unwrap(await callResolver(apiName, parsed.search.slice(1)));
      var resolved = pickDownloadUrl(payload, release);
      if (resolved) return { url: resolved, resolved: true, source: 'vendor', note: '已从厂商响应提取固件包地址' };
      var errorCode = payload && (payload.errMsg || payload.responseCode || payload.code);
      try {
        var violetAfterEmpty = await resolveViaVioletTool(release);
        return { url: violetAfterEmpty, resolved: true, source: 'violettool', dynamic: true, note: '第三方归档站未返回结果，已由 VioletTool 生成临时下载链接（过期后请重新解析）' };
      } catch (violetEmptyError) {
        return { url: source, resolved: false, source: 'manual', note: (archiveError ? '归档站签名服务暂不可用；' : '') + '第三方归档站与 VioletTool 均未返回链接' + (errorCode ? '（代码 ' + errorCode + '）' : '') + '，已回退到目录原始地址' };
      }
    } catch (error) {
      try {
        var violet = await resolveViaVioletTool(release);
        return { url: violet, resolved: true, source: 'violettool', dynamic: true, note: '归档站解析失败，已由 VioletTool 生成临时下载链接（过期后请重新解析）' };
      } catch (violetError) {
        return { url: source, resolved: false, source: 'manual', note: (archiveError ? '归档站签名服务暂不可用；' : '') + '第三方归档站与 VioletTool 均未返回链接，已回退到目录原始地址' };
      }
    }
  }

  function formatBytes(value) {
    var bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes <= 0) return '—';
    var units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
    var index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return (bytes / Math.pow(1024, index)).toFixed(index > 2 ? 2 : 1) + ' ' + units[index];
  }

  function renderRelease(release, link) {
    var card = $('release-template').content.firstElementChild.cloneNode(true);
    text(card.querySelector('.device'), fullDeviceName(release.device));
    text(card.querySelector('.region'), release.region);
    text(card.querySelector('.version'), release.version);
    text(card.querySelector('.ota-version'), release.ota_version);
    text(card.querySelector('.model'), release.model);
    text(card.querySelector('.patch'), release.security_patch);
    text(card.querySelector('.build-time'), release.build_timestamp);
    text(card.querySelector('.size'), formatBytes(release.size));
    text(card.querySelector('.md5'), release.md5);
    text(card.querySelector('.release-id-value'), release.id);
    card.querySelector('.latest-badge').hidden = !release.is_latest;
    text(card.querySelector('.source-badge'), sourceLabel(link.source));
    text(card.querySelector('.download-url'), link.url, '无可用地址');
    var note = card.querySelector('.resolve-note');
    text(note, (link.source ? sourceLabel(link.source) + ' · ' : '') + link.note);
    note.classList.toggle('fallback', !link.resolved);
    card.querySelector('.copy-btn').disabled = !link.url;
    card.querySelector('.copy-btn').onclick = function () { copy(link.url, '下载链接'); };
    card.querySelector('.source-btn').disabled = !release.source_url;
    card.querySelector('.source-btn').onclick = function () { copy(release.source_url, '源地址'); };
    return card;
  }

  function resetResults(message) {
    $('results').innerHTML = '<div class="empty"><b>尚未选择版本</b><span>' + message + '</span></div>';
  }

  function selectDevice(catalog) {
    var regions = $('device').value && catalog[$('device').value] ? Object.keys(catalog[$('device').value]).sort(naturalCompare) : [];
    fillSelect($('region'), regions, regions.length ? '请选择地区' : '请先选择设备');
    fillSelect($('release'), [], '请先选择地区');
    $('search-btn').disabled = true;
    resetResults('请选择地区和固件版本。');
  }

  function selectRegion(catalog) {
    var device = $('device').value;
    var region = $('region').value;
    var releases = device && region && catalog[device] ? catalog[device][region] || [] : [];
    fillSelect($('release'), releases, releases.length ? '请选择固件版本' : '请先选择地区', function (release) {
      return release.version + (release.model ? ' · ' + release.model : '') + (release.is_latest ? ' · 最新' : '');
    });
    $('search-btn').disabled = true;
    resetResults('请选择需要解析的固件版本。');
  }

  function selectRelease() {
    $('search-btn').disabled = !$('release').value;
    var selected = releaseById[$('release').value];
    $('status').className = 'status';
    $('status').textContent = selected ? '已选择 ' + fullDeviceName(selected.device) + ' / ' + selected.region + ' / ' + selected.version : '请选择固件版本';
  }

  function setMode(mode) {
    var manual = mode === 'manual';
    var smart = mode === 'smart';
    $('catalog-mode-btn').classList.toggle('active', !manual && !smart);
    $('smart-mode-btn').classList.toggle('active', smart);
    $('manual-mode-btn').classList.toggle('active', manual);
    $('catalog-fields').hidden = manual || smart;
    $('catalog-actions').hidden = manual || smart;
    $('smart-fields').hidden = !smart;
    $('smart-actions').hidden = !smart;
    $('manual-fields').hidden = !manual;
    $('manual-actions').hidden = !manual;
    $('status').className = 'status';
    $('status').textContent = manual ? '手动输入至少一个主要条件，再查询匹配版本' : smart ? '请选择包类型、品牌、系列、机型和版本' : '请选择设备、地区和固件版本';
    resetResults(manual ? '手动查询后选择匹配版本。' : smart ? 'SmartTool 目录实时来自 VioletTool。' : '依次选择设备、地区和固件版本。');
  }

  async function smartLoadSeries() {
    fillSelect($('smart-series'), [], '正在加载系列…'); fillSelect($('smart-device'), [], '请先选择系列'); fillSelect($('smart-version'), [], '请先选择机型'); $('smart-resolve-btn').disabled = true;
    if (!$('smart-brand').value) return fillSelect($('smart-series'), [], '请先选择品牌');
    try { var items = payloadItems(await Tapp.api('violetSeries', { packageType: encode($('smart-package').value), brand: encode($('smart-brand').value) }), 'series'); fillSelect($('smart-series'), items, items.length ? '请选择系列' : '没有可用系列', function (x) { return clean(x.name || x); }); }
    catch (error) { fillSelect($('smart-series'), [], '系列加载失败'); await notify('无法加载 SmartTool 系列', 'error'); }
  }

  function smartPackageChanged() {
    var brands = SMART_BRANDS[$('smart-package').value] || SMART_BRANDS.full;
    fillSelect($('smart-brand'), brands, '请选择品牌');
    fillSelect($('smart-series'), [], '请先选择品牌');
    fillSelect($('smart-device'), [], '请先选择系列');
    fillSelect($('smart-version'), [], '请先选择机型');
    $('smart-resolve-btn').disabled = true;
  }

  async function smartLoadDevices() {
    fillSelect($('smart-device'), [], '正在加载机型…'); fillSelect($('smart-version'), [], '请先选择机型'); $('smart-resolve-btn').disabled = true;
    if (!$('smart-series').value) return fillSelect($('smart-device'), [], '请先选择系列');
    try { var items = payloadItems(await Tapp.api('violetDevices', { packageType: encode($('smart-package').value), brand: encode($('smart-brand').value), series: encode($('smart-series').value) }), 'devices'); fillSelect($('smart-device'), items, items.length ? '请选择机型' : '没有可用机型', function (x) { return fullDeviceName(clean(x.name || x).replace(/^\[[^\]]+\]/, '')); }); }
    catch (error) { fillSelect($('smart-device'), [], '机型加载失败'); await notify('无法加载 SmartTool 机型', 'error'); }
  }

  async function smartLoadVersions() {
    fillSelect($('smart-version'), [], '正在加载版本…'); $('smart-resolve-btn').disabled = true;
    if (!$('smart-device').value) return fillSelect($('smart-version'), [], '请先选择机型');
    try { var items = payloadItems(await Tapp.api('violetVersions', { packageType: encode($('smart-package').value), brand: encode($('smart-brand').value), series: encode($('smart-series').value), device: encode($('smart-device').value) }), 'versions'); fillSelect($('smart-version'), items, items.length ? '请选择固件版本' : '没有可用版本', function (x) { return clean(x.version || x.name || x); }); }
    catch (error) { fillSelect($('smart-version'), [], '版本加载失败'); await notify('无法加载 SmartTool 版本', 'error'); }
  }

  async function resolveSmart() {
    var release = { id: 'smarttool', brand: $('smart-brand').value, package_type: $('smart-package').value, series: $('smart-series').value, device: $('smart-device').value, version: $('smart-version').value, region: '—', source_url: 'https://violettool.top/rom-api' };
    var button = $('smart-resolve-btn'); button.disabled = true; button.textContent = '正在解析…'; $('status').textContent = '正在请求自有缓存与 VioletTool…';
    try {
      var ownParams = violetParams(release);
      var result;
      try {
        var own = unwrap(await Tapp.api('otaOwnResolve', { brand: encode(ownParams.brand), packageType: encode(ownParams.packageType), series: encode(ownParams.series), device: encode(release.device), version: encode(release.version), region: '', id: '' }));
        if (own && /^https:\/\//i.test(clean(own.url || own.fixedUrl))) result = { url: clean(own.url || own.fixedUrl), resolved: true, source: 'fixed', dynamic: Boolean(own.dynamic), expiresAt: own.expiresAt || '', note: '自有 API 已命中' };
      } catch (error) {}
      if (!result) {
        var archiveRelease = findArchiveRelease(release, catalogReleases);
        if (archiveRelease) {
          try { var archiveUrl = await resolveViaArchive(archiveRelease); var archiveTiming = linkTiming(archiveUrl); result = { url: archiveUrl, resolved: true, source: 'archive', dynamic: archiveTiming.dynamic, expiresAt: archiveTiming.expiresAt, note: archiveTiming.dynamic ? '已优先通过 Daniel Springer 第三方归档站生成临时签名链接' : '已优先通过 Daniel Springer 第三方归档站取得固定链接' }; } catch (error) {}
        }
      }
      if (!result) { var violetUrl = await resolveViaVioletTool(release); var violetTiming = linkTiming(violetUrl); result = { url: violetUrl, resolved: true, source: 'violettool', dynamic: violetTiming.dynamic, expiresAt: violetTiming.expiresAt, note: violetTiming.dynamic ? '归档站未命中，已生成厂商临时签名链接（过期后请重新解析）' : '归档站未命中，已由 VioletTool 取得固定下载链接' }; }
      $('results').replaceChildren(renderRelease(release, result));
      $('status').className = 'status success';
      $('status').textContent = 'SmartTool 下载链接解析完成';
    }
    catch (error) { $('status').className = 'status error'; $('status').textContent = 'SmartTool 解析失败：' + (error.message || error); await notify('无法解析 SmartTool 下载链接', 'error'); }
    finally { button.disabled = false; button.textContent = '解析下载链接'; }
  }

  function manualParams() {
    return {
      device: encode($('manual-device').value),
      region: encode($('manual-region').value),
      model: encode($('manual-model').value),
      id: encode($('manual-id').value)
    };
  }

  async function searchManualReleases() {
    var params = manualParams();
    if (!params.device && !params.model && !params.id) {
      $('status').className = 'status error';
      $('status').textContent = '请至少填写设备名称、型号代码或发布 ID';
      return notify('请先填写主要查询条件', 'warning');
    }
    var button = $('manual-search-btn');
    button.disabled = true;
    button.textContent = '正在查询…';
    $('manual-resolve-btn').disabled = true;
    try {
      var payload = unwrap(await Tapp.api('otaSearch', params));
      var releases = payload && Array.isArray(payload.releases) ? payload.releases.slice() : [];
      releases.sort(function (a, b) { return releaseTime(b) - releaseTime(a) || naturalCompare(b.version, a.version); });
      manualReleaseById = {};
      releases.forEach(function (release) { manualReleaseById[release.id] = release; });
      fillSelect($('manual-release'), releases, releases.length ? '请选择匹配版本' : '没有匹配版本', function (release) {
        return fullDeviceName(release.device) + ' · ' + release.region + ' · ' + release.version + (release.model ? ' · ' + release.model : '');
      });
      $('status').className = releases.length ? 'status success' : 'status';
      $('status').textContent = releases.length ? '找到 ' + releases.length + ' 个匹配版本，请选择后解析' : '没有匹配的 OTA 版本';
      $('catalog-time').textContent = payload && payload.catalog_updated_at ? '目录更新：' + payload.catalog_updated_at : '';
    } catch (error) {
      fillSelect($('manual-release'), [], '查询失败');
      $('status').className = 'status error';
      $('status').textContent = '手动查询失败：' + (error && error.message ? error.message : String(error));
      await notify('无法查询匹配版本', 'error');
    } finally {
      button.disabled = false;
      button.textContent = '查询匹配版本';
    }
  }

  function selectManualRelease() {
    $('manual-resolve-btn').disabled = !$('manual-release').value;
    var selected = manualReleaseById[$('manual-release').value];
    if (selected) {
      $('status').className = 'status';
      $('status').textContent = '已选择 ' + fullDeviceName(selected.device) + ' / ' + selected.region + ' / ' + selected.version;
    }
  }

  async function loadCatalog() {
    var status = $('status');
    $('reload-btn').disabled = true;
    $('search-btn').disabled = true;
    fillSelect($('device'), [], '正在加载设备目录…');
    fillSelect($('region'), [], '请先选择设备');
    fillSelect($('release'), [], '请先选择地区');
    status.className = 'status';
    status.textContent = '正在加载 OTA 目录…';
    try {
      var payload = unwrap(await Tapp.api('otaCatalog', {}));
      catalogReleases = payload && Array.isArray(payload.releases) ? payload.releases : [];
      releaseById = {};
      catalogReleases.forEach(function (release) { releaseById[release.id] = release; });
      var catalog = buildCatalog(catalogReleases);
      fillSelect($('device'), Object.keys(catalog).sort(naturalCompare), '请选择设备', fullDeviceName);
      $('device').onchange = function () { selectDevice(catalog); };
      $('region').onchange = function () { selectRegion(catalog); };
      $('release').onchange = selectRelease;
      $('catalog-time').textContent = payload && payload.catalog_updated_at ? '目录更新：' + payload.catalog_updated_at : '';
      status.className = 'status success';
      status.textContent = '目录已加载：' + Object.keys(catalog).length + ' 台设备，' + catalogReleases.length + ' 条 OTA 记录';
    } catch (error) {
      status.className = 'status error';
      status.textContent = '目录加载失败：' + (error && error.message ? error.message : String(error));
      fillSelect($('device'), [], '目录加载失败');
      await notify('无法加载 OTA 目录，请稍后重试', 'error');
    } finally {
      $('reload-btn').disabled = false;
    }
  }

  async function resolveSelected(release, button) {
    if (!release) return notify('请先选择固件版本', 'warning');
    var status = $('status');
    button.disabled = true;
    button.textContent = '正在解析…';
    status.className = 'status';
    status.textContent = '正在生成签名下载直链…';
    try {
      var results = $('results');
      results.replaceChildren();
      var resolved = await resolveRelease(release);
      results.appendChild(renderRelease(release, resolved));
      status.className = 'status success';
      status.textContent = resolved.resolved ? '下载链接解析完成' : '已返回目录原始地址，请留意回退提示';
    } catch (error) {
      $('results').innerHTML = '<div class="empty"><b>解析失败</b><span>请稍后重试，或重新加载 OTA 目录。</span></div>';
      status.className = 'status error';
      status.textContent = '解析失败：' + (error && error.message ? error.message : String(error));
      await notify('无法解析下载链接', 'error');
    } finally {
      button.disabled = false;
      button.textContent = '解析下载链接';
    }
  }

  function search() {
    return resolveSelected(releaseById[$('release').value], $('search-btn'));
  }

  function searchManual() {
    return resolveSelected(manualReleaseById[$('manual-release').value], $('manual-resolve-btn'));
  }

  async function init() {
    await bindTheme();
    $('search-btn').onclick = search;
    $('manual-search-btn').onclick = searchManualReleases;
    $('manual-resolve-btn').onclick = searchManual;
    $('manual-release').onchange = selectManualRelease;
    $('catalog-mode-btn').onclick = function () { setMode('catalog'); };
    $('manual-mode-btn').onclick = function () { setMode('manual'); };
    $('smart-mode-btn').onclick = function () { setMode('smart'); };
    $('smart-package').onchange = smartPackageChanged;
    $('smart-brand').onchange = smartLoadSeries;
    $('smart-series').onchange = smartLoadDevices;
    $('smart-device').onchange = smartLoadVersions;
    $('smart-version').onchange = function () { $('smart-resolve-btn').disabled = !$('smart-version').value; };
    $('smart-resolve-btn').onclick = resolveSmart;
    $('smart-clear-btn').onclick = function () { $('smart-brand').value = ''; fillSelect($('smart-series'), [], '请先选择品牌'); fillSelect($('smart-device'), [], '请先选择系列'); fillSelect($('smart-version'), [], '请先选择机型'); $('smart-resolve-btn').disabled = true; };
    $('clear-btn').onclick = function () {
      $('device').value = '';
      fillSelect($('region'), [], '请先选择设备');
      fillSelect($('release'), [], '请先选择地区');
      $('search-btn').disabled = true;
      $('status').className = 'status';
      $('status').textContent = '选择已重置';
      resetResults('依次选择设备、地区和固件版本。');
    };
    $('reload-btn').onclick = loadCatalog;
    $('manual-clear-btn').onclick = function () {
      ['manual-device', 'manual-region', 'manual-model', 'manual-id'].forEach(function (id) { $(id).value = ''; });
      manualReleaseById = {};
      fillSelect($('manual-release'), [], '请先查询匹配版本');
      $('manual-resolve-btn').disabled = true;
      $('status').className = 'status';
      $('status').textContent = '手动条件已清空';
      resetResults('手动查询后选择匹配版本。');
    };
    $('docs-btn').onclick = async function () {
      try { await Tapp.ui.openUrl({ id: 'ota-api-docs' }); }
      catch (error) { await notify('无法打开 API 文档', 'error'); }
    };
    smartPackageChanged();
    await loadCatalog();
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { buildCatalog: buildCatalog, collectUrls: collectUrls, scoreUrl: scoreUrl, pickDownloadUrl: pickDownloadUrl, parseArchiveTokens: parseArchiveTokens, archiveVersionIndex: archiveVersionIndex, findArchiveRelease: findArchiveRelease, fullDeviceName: fullDeviceName, normalizedDeviceName: normalizedDeviceName, violetParams: violetParams, linkTiming: linkTiming, formatBytes: formatBytes };
  }
  if (typeof window !== 'undefined' && (window._TAPP_MODE === 'page' || window._TAPP_HAS_HTML)) Tapp.lifecycle.onReady(init);
})();
