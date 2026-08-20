(function () {
  var BRANDS = {
    full: ['OPPO', 'OnePlus', 'Realme', 'Xiaomi', 'Redmi', '魅族'],
    afterSales: ['OPPO', 'OnePlus', 'Realme', 'Xiaomi', 'Redmi']
  };
  var VENDOR_API = {
    'component-ota-sg.allawnos.com': 'resolveOplusSg',
    'component-ota-eu.allawnos.com': 'resolveOplusEu',
    'component-ota-in.allawnos.com': 'resolveOplusIn',
    'component-ota-cn.allawntech.com': 'resolveOplusCn',
    'sgp-api.buy.mi.com': 'resolveXiaomi'
  };
  var archiveReleases = [];
  var listCache = {};

  function $(id) { return typeof document === 'undefined' ? null : document.getElementById(id); }
  function clean(value) { return String(value || '').trim(); }
  function encode(value) { return encodeURIComponent(clean(value)); }
  function unwrap(value) { return value && value.success === true && Object.prototype.hasOwnProperty.call(value, 'data') ? value.data : value; }
  function text(node, value, fallback) { if (node) node.textContent = clean(value) || fallback || '—'; }
  function naturalCompare(a, b) { return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' }); }
  function fullDeviceName(value) {
    var device = clean(value).replace(/^\[[^\]]+\]/, '').trim();
    return device.replace(/^OP(?=\s|$)/i, 'OnePlus').replace(/^一加\s*/i, 'OnePlus ').replace(/\s+/g, ' ').trim();
  }
  function normalizeDevice(value) {
    return fullDeviceName(value).toLowerCase().replace(/[（）]/g, function (char) { return char === '（' ? '(' : ')'; }).replace(/[^a-z0-9\u4e00-\u9fff]+/g, '');
  }
  function normalizeVersion(value) {
    var version = clean(value);
    if (version.indexOf('·') !== -1) version = version.split('·').pop();
    return version.toLowerCase().replace(/(?:coloros|realmeui|miui|hyperos|oxygenos|flyme)\s*/g, '').replace(/\s+(?:稳定版|降级包|补丁.*)$/u, '').replace(/[^a-z0-9()._-]+/g, '');
  }
  function versionTokens(value) {
    return normalizeVersion(value).match(/[a-z]{2,}\d{2,}[_-][a-z0-9.]+(?:\([a-z0-9]+\))?|(?:os|v)\d+(?:\.\d+){2,}/g) || [];
  }
  function versionsEquivalent(left, right) {
    var a = normalizeVersion(left);
    var b = normalizeVersion(right);
    if (!a || !b) return false;
    if (a === b || a.indexOf(b) !== -1 || b.indexOf(a) !== -1) return true;
    var other = versionTokens(b);
    return versionTokens(a).some(function (token) { return other.indexOf(token) !== -1; });
  }
  function isWebUrl(value) { return /^https?:\/\//i.test(clean(value)); }
  function isSecureUrl(value) { return /^https:\/\//i.test(clean(value)); }
  function isArchiveUrl(value) {
    try { return /\.(zip|ozip|bin|tgz|gz|img|7z|rar|tar\.gz)(?:$|[?#])/i.test(new URL(value).href); } catch (error) { return false; }
  }
  function collectUrls(value, output, seen) {
    if (typeof value === 'string') {
      if (isWebUrl(value) && !seen[value]) { seen[value] = true; output.push(value); }
    } else if (Array.isArray(value)) {
      value.forEach(function (item) { collectUrls(item, output, seen); });
    } else if (value && typeof value === 'object') {
      Object.keys(value).forEach(function (key) { collectUrls(value[key], output, seen); });
    }
  }
  function scoreUrl(url, release) {
    var score = isArchiveUrl(url) ? 100 : 0;
    var lower = url.toLowerCase();
    if (isSecureUrl(url)) score += 12;
    if (/download|ota|rom|package/.test(lower)) score += 20;
    if (release && release.ota_version && lower.indexOf(String(release.ota_version).toLowerCase()) !== -1) score += 40;
    if (release && release.version && lower.indexOf(String(release.version).toLowerCase()) !== -1) score += 30;
    if (/changelog|\.html?(\?|$)/i.test(url)) score -= 100;
    return score;
  }
  function pickDownloadUrl(payload, release) {
    var urls = [];
    collectUrls(payload, urls, {});
    urls.sort(function (a, b) { return scoreUrl(b, release) - scoreUrl(a, release); });
    return urls.length && scoreUrl(urls[0], release) > 0 ? urls[0] : '';
  }
  function releaseTime(release) {
    var built = Date.parse(release && release.build_timestamp || '');
    if (Number.isFinite(built)) return built;
    var published = Number(release && release.published);
    return Number.isFinite(published) ? published : 0;
  }
  function findArchiveRelease(task, releases) {
    var taskDevice = normalizeDevice(task.device);
    var candidates = (Array.isArray(releases) ? releases : []).filter(function (release) {
      var releaseDevice = normalizeDevice(release.device);
      var sameVersion = versionsEquivalent(task.version, release.version) || versionsEquivalent(task.version, release.ota_version);
      var sameDevice = taskDevice && releaseDevice && (taskDevice === releaseDevice || taskDevice.indexOf(releaseDevice) !== -1 || releaseDevice.indexOf(taskDevice) !== -1);
      return sameVersion && sameDevice;
    });
    candidates.sort(function (a, b) { return releaseTime(b) - releaseTime(a); });
    return candidates[0] || null;
  }
  function taskParams(task) {
    return {
      packageType: clean(task.packageType), brand: clean(task.brand), series: clean(task.series), device: clean(task.device), version: clean(task.version), region: clean(task.region), id: clean(task.id),
      packageTypeQuery: encode(task.packageType), brandQuery: encode(task.brand), seriesQuery: encode(task.series), deviceQuery: encode(task.device), versionQuery: encode(task.version), regionQuery: encode(task.region), idQuery: encode(task.id)
    };
  }
  function parseArchiveTokens(html) {
    var source = typeof html === 'string' ? html : '';
    var tag = source.match(/<[^>]*\bid=["']resultBox["'][^>]*>/i);
    if (!tag) return { key: '', csrf: '' };
    var key = tag[0].match(/\bdata-ota-key=["']([^"']+)["']/i);
    var csrf = tag[0].match(/\bdata-csrf=["']([^"']+)["']/i);
    return { key: key ? key[1] : '', csrf: csrf ? csrf[1] : '' };
  }
  function archiveVersionIndex(release, releases) {
    var matching = (Array.isArray(releases) ? releases : []).filter(function (item) { return clean(item.device) === clean(release.device) && clean(item.region) === clean(release.region); });
    if (!matching.some(function (item) { return clean(item.version) === clean(release.version); })) matching.push(release);
    matching.sort(function (a, b) { return releaseTime(b) - releaseTime(a) || naturalCompare(b.version, a.version); });
    return matching.findIndex(function (item) { return clean(item.version) === clean(release.version); });
  }
  function createSessionId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, '');
    return String(Date.now()) + Math.random().toString(16).slice(2).padEnd(19, '0').slice(0, 19);
  }

  async function resolveFixed(task) {
    try {
      var payload = unwrap(await Tapp.api('fixedLink', taskParams(task)));
      if (payload && payload.found && isArchiveUrl(payload.url)) {
        return { url: clean(payload.url), resolved: true, source: 'self-cache', dynamic: Boolean(payload.dynamic), note: payload.dynamic ? '命中自有 API 的有效临时缓存' : '命中自有 API 固定链接缓存' };
      }
    } catch (error) {}
    return null;
  }
  async function resolveViaArchiveWeb(release) {
    var index = archiveVersionIndex(release, archiveReleases);
    if (index < 0) throw new Error('无法确定第三方网页目录中的版本序号');
    var sessionId = createSessionId();
    var page = unwrap(await Tapp.api('prepareArchiveOta', { sessionId: sessionId, device: clean(release.device), region: clean(release.region), versionIndex: String(index) }));
    var tokens = parseArchiveTokens(page);
    if (!tokens.key || !tokens.csrf) throw new Error('第三方网页没有返回解析令牌');
    var payload = unwrap(await Tapp.api('resolveArchiveOta', { sessionId: sessionId, key: tokens.key, csrf: tokens.csrf }));
    var resolved = payload && isWebUrl(payload.url) ? clean(payload.url) : pickDownloadUrl(payload, release);
    if (!resolved || !isArchiveUrl(resolved)) throw new Error('第三方网页未返回固件包地址');
    return resolved;
  }
  async function vendorCall(name, query) {
    if (name === 'resolveOplusSg') return Tapp.api('resolveOplusSg', { query: query });
    if (name === 'resolveOplusEu') return Tapp.api('resolveOplusEu', { query: query });
    if (name === 'resolveOplusIn') return Tapp.api('resolveOplusIn', { query: query });
    if (name === 'resolveOplusCn') return Tapp.api('resolveOplusCn', { query: query });
    if (name === 'resolveXiaomi') return Tapp.api('resolveXiaomi', { query: query });
    throw new Error('不支持的厂商入口');
  }
  async function resolveArchive(release) {
    var source = clean(release && release.source_url);
    if (!source) return null;
    if (isArchiveUrl(source)) return { url: source, resolved: true, source: 'daniel-fixed', dynamic: false, note: 'Daniel Springer 第三方目录已提供固定包地址' };
    var parsed;
    try { parsed = new URL(source); } catch (error) { return null; }
    var apiName = VENDOR_API[parsed.hostname.toLowerCase()];
    if (!apiName) return null;
    if (/^resolveOplus/.test(apiName)) {
      try {
        var signed = await resolveViaArchiveWeb(release);
        return { url: signed, resolved: true, source: 'daniel-signed', dynamic: true, note: 'Daniel Springer 第三方站已生成临时签名直链' };
      } catch (error) {}
    }
    try {
      var payload = unwrap(await vendorCall(apiName, parsed.search.slice(1)));
      var url = pickDownloadUrl(payload, release);
      return url && isArchiveUrl(url) ? { url: url, resolved: true, source: 'vendor', dynamic: false, note: '从第三方目录指向的厂商接口提取包地址' } : null;
    } catch (error) { return null; }
  }
  async function resolveViolet(task) {
    try {
      var payload = unwrap(await Tapp.api('violetResolve', taskParams(task)));
      var url = pickDownloadUrl(payload, task);
      if (url && isArchiveUrl(url)) return { url: url, resolved: true, source: 'violettool', dynamic: /[?&](?:sign|signature|auth_key|expires|x-amz-signature)=/i.test(url), note: isSecureUrl(url) ? '由 VioletTool 动态解析返回' : 'VioletTool 返回明文 HTTP 包地址，请谨慎核对' };
      var fallback = [];
      collectUrls(payload, fallback, {});
      if (fallback.length) return { url: fallback[0], resolved: false, source: 'violettool', dynamic: false, note: 'VioletTool 仅返回落地页或非标准地址' };
    } catch (error) {}
    return null;
  }
  async function resolveTask(task, releases) {
    var fixed = await resolveFixed(task);
    if (fixed) return fixed;
    var release = findArchiveRelease(task, releases || archiveReleases);
    if (release) {
      var archive = await resolveArchive(release);
      if (archive) return archive;
    }
    return await resolveViolet(task) || { url: '', resolved: false, source: 'none', dynamic: false, note: '自有缓存、Daniel Springer 第三方站和 VioletTool 均未返回可用包地址' };
  }

  function fillSelect(select, values, placeholder, labeler) {
    if (!select) return;
    select.replaceChildren();
    var empty = document.createElement('option'); empty.value = ''; empty.textContent = placeholder; select.appendChild(empty);
    values.forEach(function (value) {
      var option = document.createElement('option');
      option.value = typeof value === 'string' ? value : value.value;
      option.textContent = labeler ? labeler(value) : (typeof value === 'string' ? value : value.label);
      select.appendChild(option);
    });
    select.disabled = values.length === 0;
  }
  function setStatus(message, state) { $('status').className = 'status' + (state ? ' ' + state : ''); $('status').textContent = message; }
  function clearSelects(ids, message) { ids.forEach(function (id) { fillSelect($(id), [], message); }); $('resolve-btn').disabled = true; }
  async function notify(message, type) {
    try { await Tapp.ui.showNotification({ title: type === 'error' ? '操作失败' : type === 'warning' ? '请注意' : '操作成功', message: message, type: type || 'success', duration: 3200 }); } catch (error) {}
  }
  async function copy(value) {
    var copied = false;
    try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(value); copied = true; } } catch (error) {}
    if (!copied) {
      var box = document.createElement('textarea'); box.value = value; box.style.position = 'fixed'; box.style.opacity = '0'; document.body.appendChild(box); box.select();
      try { copied = document.execCommand('copy'); } catch (error) {} box.remove();
    }
    notify(copied ? '下载链接已复制' : '复制失败，请手动选择链接', copied ? 'success' : 'error');
  }
  function applyTheme(theme) {
    var dark = theme === true || theme === 'dark' || theme === 'Dark';
    document.documentElement.classList.toggle('dark', dark); document.documentElement.classList.toggle('light', !dark);
  }
  async function bindTheme() {
    try {
      var current = Tapp.ui.getTheme();
      applyTheme(current && typeof current.then === 'function' ? await current : current);
      Tapp.ui.onThemeChange(function (theme) { applyTheme(theme); });
    } catch (error) {
      applyTheme(typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    }
  }
  async function cachedApi(key, name, params) {
    if (listCache[key]) return listCache[key];
    var request;
    if (name === 'violetSeries') request = Tapp.api('violetSeries', params);
    else if (name === 'violetDevices') request = Tapp.api('violetDevices', params);
    else if (name === 'violetVersions') request = Tapp.api('violetVersions', params);
    else throw new Error('不支持的目录接口');
    var payload = unwrap(await request);
    return (listCache[key] = payload && Array.isArray(payload.items) ? payload.items : []);
  }
  function selectedTask() { return { packageType: $('package-type').value, brand: $('brand').value, series: $('series').value, device: $('device').value, version: $('version').value, region: '', id: '' }; }
  function manualTask() { return { packageType: $('manual-package-type').value, brand: clean($('manual-brand').value), series: clean($('manual-series').value), device: clean($('manual-device').value), version: clean($('manual-version').value), region: '', id: '' }; }
  function validateTask(task) { return ['packageType', 'brand', 'series', 'device', 'version'].filter(function (field) { return !clean(task[field]); }); }

  async function choosePackage() {
    var type = $('package-type').value;
    fillSelect($('brand'), BRANDS[type] || [], type ? '请选择品牌' : '请先选择包类型');
    clearSelects(['series', 'device', 'version'], '请按顺序选择');
    setStatus(type ? '请选择品牌' : '请选择包类型');
  }
  async function chooseBrand() {
    var task = selectedTask(); clearSelects(['series', 'device', 'version'], '正在加载系列…'); if (!task.brand) return;
    setStatus('正在从 VioletTool 加载系列…');
    try { var items = await cachedApi(['series', task.packageType, task.brand].join('|'), 'violetSeries', taskParams(task)); fillSelect($('series'), items, items.length ? '请选择系列' : '该品牌暂无系列'); setStatus(items.length ? '请选择系列' : '该品牌暂无可用系列，可切换手动输入'); }
    catch (error) { setStatus('系列加载失败，可切换手动输入', 'error'); }
  }
  async function chooseSeries() {
    var task = selectedTask(); clearSelects(['device', 'version'], '正在加载机型…'); if (!task.series) return;
    setStatus('正在从 VioletTool 加载机型…');
    try { var items = await cachedApi(['devices', task.packageType, task.brand, task.series].join('|'), 'violetDevices', taskParams(task)); fillSelect($('device'), items.sort(naturalCompare), items.length ? '请选择机型' : '该系列暂无机型', fullDeviceName); setStatus(items.length ? '请选择机型' : '该系列暂无机型'); }
    catch (error) { setStatus('机型加载失败，可切换手动输入', 'error'); }
  }
  async function chooseDevice() {
    var task = selectedTask(); clearSelects(['version'], '正在加载版本…'); if (!task.device) return;
    setStatus('正在从 VioletTool 加载版本…');
    try {
      var items = await cachedApi(['versions', task.packageType, task.brand, task.series, task.device].join('|'), 'violetVersions', taskParams(task));
      var versions = items.map(function (item) { return typeof item === 'string' ? item : item && item.name; }).filter(Boolean);
      fillSelect($('version'), versions, versions.length ? '请选择版本' : '该机型暂无版本'); setStatus(versions.length ? '请选择固件版本' : '该机型暂无版本');
    } catch (error) { setStatus('版本加载失败，可切换手动输入', 'error'); }
  }
  function chooseVersion() { $('resolve-btn').disabled = !$('version').value; setStatus($('version').value ? '已选择 ' + fullDeviceName($('device').value) + ' / ' + $('version').value : '请选择固件版本'); }
  function sourceLabel(source) { return { 'self-cache': '自有 API', 'daniel-fixed': 'Daniel 固定目录', 'daniel-signed': 'Daniel 动态签名', vendor: '厂商接口', violettool: 'VioletTool', none: '未命中' }[source] || source; }
  function renderResult(task, result) {
    var card = $('release-template').content.firstElementChild.cloneNode(true);
    text(card.querySelector('.device'), fullDeviceName(task.device)); text(card.querySelector('.brand'), task.brand); text(card.querySelector('.series'), task.series);
    text(card.querySelector('.package-type-value'), task.packageType === 'afterSales' ? '售后包' : '全量包'); text(card.querySelector('.version'), task.version);
    text(card.querySelector('.source-value'), sourceLabel(result.source)); text(card.querySelector('.security-value'), result.url ? (isSecureUrl(result.url) ? 'HTTPS' : 'HTTP（需谨慎）') : '—'); text(card.querySelector('.dynamic-value'), result.dynamic ? '是' : '否');
    text(card.querySelector('.download-url'), result.url, '无可用地址'); text(card.querySelector('.resolve-note'), result.note);
    card.querySelector('.resolve-note').classList.toggle('fallback', !result.resolved || (result.url && !isSecureUrl(result.url)));
    card.querySelector('.copy-btn').disabled = !result.url; card.querySelector('.copy-btn').onclick = function () { copy(result.url); };
    return card;
  }
  async function runResolve(task, button) {
    if (validateTask(task).length) return notify('请补全包类型、品牌、系列、机型和版本', 'warning');
    button.disabled = true; button.textContent = '正在依次查询…'; setStatus('正在查询自有固定缓存…');
    try {
      $('results').replaceChildren(); var result = await resolveTask(task, archiveReleases); $('results').appendChild(renderResult(task, result));
      var state = result.resolved ? (result.url && !isSecureUrl(result.url) ? 'warning' : 'success') : 'error';
      setStatus(result.resolved ? '解析完成，来源：' + sourceLabel(result.source) : result.note, state);
    } catch (error) { setStatus('解析失败：' + (error && error.message ? error.message : String(error)), 'error'); notify('无法解析下载链接', 'error'); }
    finally { button.disabled = false; button.textContent = '解析下载链接'; }
  }
  function setMode(mode) {
    var manual = mode === 'manual'; $('catalog-mode-btn').classList.toggle('active', !manual); $('manual-mode-btn').classList.toggle('active', manual);
    $('catalog-fields').hidden = manual; $('catalog-actions').hidden = manual; $('manual-fields').hidden = !manual; $('manual-actions').hidden = !manual;
    setStatus(manual ? '手动填写完整目录条件后解析' : '请按顺序选择目录条件');
  }
  async function loadArchiveCatalog() {
    try {
      var payload = unwrap(await Tapp.api('otaCatalog', {}));
      archiveReleases = Array.isArray(payload) ? payload : (payload && Array.isArray(payload.releases) ? payload.releases : []);
      text($('archive-state'), 'Daniel 目录：' + archiveReleases.length + ' 条');
    }
    catch (error) { text($('archive-state'), 'Daniel 目录暂不可用'); }
  }
  async function init() {
    await bindTheme();
    fillSelect($('package-type'), [{ value: 'full', label: '全量包' }, { value: 'afterSales', label: '售后包' }], '请选择包类型');
    $('package-type').onchange = choosePackage; $('brand').onchange = chooseBrand; $('series').onchange = chooseSeries; $('device').onchange = chooseDevice; $('version').onchange = chooseVersion;
    $('resolve-btn').onclick = function () { return runResolve(selectedTask(), $('resolve-btn')); }; $('manual-resolve-btn').onclick = function () { return runResolve(manualTask(), $('manual-resolve-btn')); };
    $('catalog-mode-btn').onclick = function () { setMode('catalog'); }; $('manual-mode-btn').onclick = function () { setMode('manual'); };
    $('clear-btn').onclick = function () { $('package-type').value = ''; fillSelect($('brand'), [], '请先选择包类型'); clearSelects(['series', 'device', 'version'], '请按顺序选择'); setStatus('选择已重置'); };
    $('reload-btn').onclick = async function () { listCache = {}; await loadArchiveCatalog(); return choosePackage(); };
    $('manual-clear-btn').onclick = function () { ['manual-brand', 'manual-series', 'manual-device', 'manual-version'].forEach(function (id) { $(id).value = ''; }); $('manual-package-type').value = 'full'; setStatus('手动条件已清空'); };
    $('docs-btn').onclick = async function () { try { await Tapp.ui.openUrl({ id: 'ota-api-docs' }); } catch (error) { notify('无法打开 API 文档', 'error'); } };
    loadArchiveCatalog();
  }

  if (typeof document !== 'undefined') { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init(); }
  if (typeof module !== 'undefined' && module.exports) module.exports = { collectUrls: collectUrls, scoreUrl: scoreUrl, pickDownloadUrl: pickDownloadUrl, parseArchiveTokens: parseArchiveTokens, archiveVersionIndex: archiveVersionIndex, fullDeviceName: fullDeviceName, normalizeDevice: normalizeDevice, normalizeVersion: normalizeVersion, versionsEquivalent: versionsEquivalent, findArchiveRelease: findArchiveRelease, isArchiveUrl: isArchiveUrl, taskParams: taskParams, resolveTask: resolveTask };
})();
