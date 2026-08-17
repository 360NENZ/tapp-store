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
      option.value = typeof value === 'string' ? value : value.id;
      option.textContent = labeler ? labeler(value) : value;
      select.appendChild(option);
    });
    select.disabled = values.length === 0;
    select.value = '';
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

  async function resolveRelease(release) {
    var source = clean(release.source_url);
    if (!source) return { url: '', resolved: false, note: '目录未提供源地址' };
    if (/\.(zip|ozip|bin|tgz|gz|img)(\?|$)/i.test(source)) {
      return { url: source, resolved: true, note: '目录已提供直接下载链接' };
    }
    var parsed;
    try { parsed = new URL(source); } catch (error) {
      return { url: source, resolved: false, note: '源地址格式无法识别' };
    }
    var apiName = RESOLVER_BY_HOST[parsed.hostname.toLowerCase()];
    if (!apiName) return { url: source, resolved: false, note: '暂不支持解析该厂商入口，已保留源地址' };
    var archiveError = '';
    if (/^resolveOplus/.test(apiName)) {
      try {
        var signed = await resolveViaArchive(release);
        return { url: signed, resolved: true, note: '已通过 OTA 网页生成带签名的临时下载直链' };
      } catch (error) {
        archiveError = error && error.message ? error.message : String(error);
      }
    }
    try {
      var payload = unwrap(await callResolver(apiName, parsed.search.slice(1)));
      var resolved = pickDownloadUrl(payload, release);
      if (resolved) return { url: resolved, resolved: true, note: '已从厂商响应提取固件包地址' };
      var errorCode = payload && (payload.errMsg || payload.responseCode || payload.code);
      return { url: source, resolved: false, note: (archiveError ? '网页签名服务暂不可用；' : '') + '厂商入口暂未返回下载链接' + (errorCode ? '（代码 ' + errorCode + '）' : '') };
    } catch (error) {
      return { url: source, resolved: false, note: (archiveError ? '网页签名服务暂不可用；' : '') + '解析请求失败，已回退到官方源地址' };
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
    text(card.querySelector('.download-url'), link.url, '无可用地址');
    var note = card.querySelector('.resolve-note');
    text(note, link.note);
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
    $('catalog-mode-btn').classList.toggle('active', !manual);
    $('manual-mode-btn').classList.toggle('active', manual);
    $('catalog-fields').hidden = manual;
    $('catalog-actions').hidden = manual;
    $('manual-fields').hidden = !manual;
    $('manual-actions').hidden = !manual;
    $('status').className = 'status';
    $('status').textContent = manual ? '手动输入至少一个主要条件，再查询匹配版本' : '请选择设备、地区和固件版本';
    resetResults(manual ? '手动查询后选择匹配版本。' : '依次选择设备、地区和固件版本。');
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
      status.textContent = resolved.resolved ? '下载链接解析完成' : '已返回官方源地址，请留意回退提示';
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
    await loadCatalog();
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { buildCatalog: buildCatalog, collectUrls: collectUrls, scoreUrl: scoreUrl, pickDownloadUrl: pickDownloadUrl, parseArchiveTokens: parseArchiveTokens, archiveVersionIndex: archiveVersionIndex, fullDeviceName: fullDeviceName, formatBytes: formatBytes };
  }
  if (typeof window !== 'undefined' && (window._TAPP_MODE === 'page' || window._TAPP_HAS_HTML)) Tapp.lifecycle.onReady(init);
})();
