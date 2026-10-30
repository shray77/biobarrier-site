/**
 * collector.gs — БиоБарьер: анонимный коллектор первого русского бенчмарка.
 *
 * КУДА ВСТАВИТЬ: Google-таблица (новая, например «BioBarrier — бенчмарк»)
 * → «Расширения» → «Apps Script» → заменить содержимое Code.gs этим файлом.
 * Полная инструкция с картинками шагов — BENCHMARK.md в корне репозитория.
 *
 * КАК РАБОТАЕТ:
 *  - doPost: принимает ровно один JSON — анонимный итог анкеты
 *    (контракт = белый список в valid(); зеркалит validatePayload
 *    из telemetry.js). Пишет строку в лист «submissions».
 *    Клиент шлёт POST text/plain (no-cors), поэтому ответ — «отправлено
 *    с устройства», а не «проверено сервером»: мусор до таблицы не доходит;
 *  - doGet: считает агрегаты по всей таблице (n, среднее, медиана,
 *    распределение светофора, гистограмма 0–100, разрезы по типам
 *    хозяйств / округам / размерам / категориям) и отдаёт JSON;
 *    с параметром ?callback=Имя — JSONP для ручной проверки в браузере
 *    (имя валидируется регэкспом). Группы с числом записей ниже
 *    порога (n < 3, по категориям n < 5) не публикуются вовсе —
 *    одиночный итог чужого хозяйства — не агрегат; агрегат
 *    кешируется на 60 секунд, чтобы не пересчитывать таблицу
 *    на каждый чих;
 *  - setup(): создаёт лист с заголовками — запустить один раз из редактора
 *    (Run → setup), до Deploy.
 *
 * ПРИВАТНОСТЬ ПО КОНСТРУКЦИИ: в таблице нет ни имени, ни контактов,
 * ни идентификаторов устройства — только округ/размер ПО ЖЕЛАНИЮ
 * заполнившего, итог 0–100 (целый) и баллы категорий. Дата ответа —
 * день без времени. Таблицу видно и можно выгрузить в CSV владельцу;
 * в GET отдаются только агрегаты, никогда — строки.
 *
 * Квоты Apps Script (бесплатный Google-аккаунт): с запасом на витрину —
 * минуты триггерного времени в день и до ~30 одновременных вызовов.
 */

var SHEET = 'submissions';
var CACHE_SEC = 60;
var MIN_N = 3;        /* публиковать группы только от 3 записей: n=1 — чужой итог */
var MIN_CAT_N = 5;    /* по категориям строже: разрез мельче */
var DAY_LIMIT = 500;  /* суточный лимит записей — защита от ботов и выжигания квот */

var PKGS = ['mixed', 'poultry', 'pigs', 'dairy', 'beef', 'smallrum', 'quail'];
var BANDS = ['bad', 'mid', 'good'];
var SCALE_CODES = ['s', 'm', 'l'];
var REGIONS = ['ЦФО', 'СЗФО', 'ЮФО', 'СКФО', 'ПФО', 'УФО', 'СФО', 'ДФО'];
var TS_RE = /^\d{4}-\d{2}-\d{2}$/;
var CAT_ID_RE = /^[a-z][a-z0-9]{1,11}$/;  /* зеркало telemetry.js: без __proto__ */

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET);
  if (!sh) { sh = ss.insertSheet(SHEET); }
  return sh;
}

/** Один раз перед Deploy: лист + заголовки. */
function setup() {
  var sh = sheet_();
  sh.clear();
  sh.appendRow(['received', 'v', 'pkg', 'ts', 'region', 'scale', 'total', 'band', 'ans', 'out', 'cats']);
  sh.getRange('A1:K1').setFontWeight('bold');
  sh.setFrozenRows(1);
}

/** Белый список — зеркало validatePayload из telemetry.js. */
function valid(d) {
  if (!d || typeof d !== 'object') { return false; }
  var keys = Object.keys(d).sort().join(',');
  var want = ['v', 'pkg', 'ts', 'total', 'band', 'region', 'scale', 'cats', 'ans', 'out'].sort().join(',');
  if (keys !== want) { return false; }
  if (d.v !== 1) { return false; }
  if (PKGS.indexOf(d.pkg) < 0) { return false; }
  if (typeof d.ts !== 'string' || !TS_RE.test(d.ts)) { return false; }
  if (typeof d.total !== 'number' || !isFinite(d.total) || d.total < 0 || d.total > 100) { return false; }
  if (BANDS.indexOf(d.band) < 0) { return false; }
  if (d.region !== null && REGIONS.indexOf(d.region) < 0) { return false; }
  if (d.scale !== null && SCALE_CODES.indexOf(d.scale) < 0) { return false; }
  if (!d.cats || typeof d.cats !== 'object' || Array.isArray(d.cats)) { return false; }
  var ids = Object.keys(d.cats);
  if (ids.length < 1 || ids.length > 40) { return false; }
  for (var i = 0; i < ids.length; i++) {
    var v = d.cats[ids[i]];
    if (!CAT_ID_RE.test(ids[i])) { return false; }
    if (typeof v !== 'number' || !isFinite(v) || v < 0 || v > 100) { return false; }
  }
  if (typeof d.ans !== 'number' || !isFinite(d.ans) || d.ans < 0 || Math.floor(d.ans) !== d.ans) { return false; }
  if (typeof d.out !== 'number' || !isFinite(d.out) || d.out < 0 || Math.floor(d.out) !== d.out) { return false; }
  if (d.ans > d.out) { return false; }
  return true;
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    var d = JSON.parse(e && e.postData ? e.postData.contents : 'null');
    if (!valid(d)) { return out_({ ok: false, why: 'payload не прошёл белый список' }); }
    /* v0.4.1: суточный лимит — URL публичен по построению, и без лимита
     * бот с валидной формой выжигает квоты и топит агрегаты мусором. */
    var props = PropertiesService.getScriptProperties();
    var day = Utilities.formatDate(new Date(), 'UTC', 'yyyyMMdd');
    var cnt = Number(props.getProperty('day-' + day) || 0);
    if (cnt >= DAY_LIMIT) { return out_({ ok: false, why: 'суточный лимит отправок' }); }
    lock.waitLock(5000); /* appendRow атомарно при гонке вкладок */
    sheet_().appendRow([
      new Date().toISOString(), d.v, d.pkg, d.ts,
      d.region === null ? '' : d.region, d.scale === null ? '' : d.scale,
      d.total, d.band, d.ans, d.out, JSON.stringify(d.cats)
    ]);
    props.setProperty('day-' + day, String(cnt + 1));
    return out_({ ok: true });
  } catch (err) {
    return out_({ ok: false, why: 'ошибка записи' });
  }
}

function doGet(e) {
  try {
    var cache = CacheService.getScriptCache();
    var cached = cache && cache.get('agg');
    if (cached) {
      return respond_(cached, e);
    }
    var agg = JSON.stringify(aggregate_());
    if (cache) { cache.put('agg', agg, CACHE_SEC); }
    return respond_(agg, e);
  } catch (err) {
    return out_({ v: 1, n: 0, error: 'агрегация не удалась' });
  }
}

/* JSON или JSONP (?callback=имя) — страховка от CORS-обид. */
function respond_(aggJson, e) {
  var cb = e && e.parameter && e.parameter.callback;
  if (cb && /^[A-Za-z_$][\w$]*$/.test(cb)) {
    return ContentService.createTextOutput(cb + '(' + aggJson + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return out_(JSON.parse(aggJson));
}

function aggregate_() {
  var sh = sheet_();
  var values = sh.getLastRow() > 1 ? sh.getDataRange().getValues() : [];
  var recs = [];
  for (var i = 1; i < values.length; i++) { /* строка 1 — заголовки */
    var r = values[i];
    if (!r[2]) { continue; }
    var cats = {};
    try { cats = JSON.parse(r[10] || '{}'); } catch (e) { cats = {}; }
    recs.push({
      pkg: String(r[2]), ts: String(r[3]), region: String(r[4] || ''), scale: String(r[5] || ''),
      total: Number(r[6]), band: String(r[7]), cats: cats
    });
  }

  var n = recs.length;
  var tots = recs.map(function (r) { return r.total; });
  var mean_ = n ? tots.reduce(function (a, b) { return a + b; }, 0) / n : null;
  var median_ = null;
  if (n) {
    var s = tots.slice().sort(function (a, b) { return a - b; });
    var m = Math.floor(s.length / 2);
    median_ = s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  var dist = { bad: 0, mid: 0, good: 0 };
  var hist = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  recs.forEach(function (r) {
    if (dist[r.band] !== undefined) { dist[r.band] += 1; }
    var b = Math.min(9, Math.max(0, Math.floor(r.total / 10)));
    hist[b] += 1;
  });

  function group(field) {
    var acc = {};
    recs.forEach(function (r) {
      var k = r[field];
      if (!k) { return; }
      if (!acc[k]) { acc[k] = { n: 0, sum: 0 }; }
      acc[k].n += 1; acc[k].sum += r.total;
    });
    var out = {};
    Object.keys(acc).forEach(function (k) {
      if (acc[k].n < MIN_N) { return; } /* n=1/2 — чужие одиночные итоги, не агрегат */
      out[k] = { n: acc[k].n, mean: +(acc[k].sum / acc[k].n).toFixed(1) };
    });
    return out;
  }

  /* Средние по категориям: «самые тонкие барьеры страны». */
  var catAcc = {};
  recs.forEach(function (r) {
    Object.keys(r.cats).forEach(function (cid) {
      if (!catAcc[cid]) { catAcc[cid] = { n: 0, sum: 0 }; }
      catAcc[cid].n += 1; catAcc[cid].sum += Number(r.cats[cid]);
    });
  });
  var byCat = {};
  Object.keys(catAcc).forEach(function (cid) {
    if (catAcc[cid].n < MIN_CAT_N) { return; }
    byCat[cid] = { n: catAcc[cid].n, mean: +(catAcc[cid].sum / catAcc[cid].n).toFixed(1) };
  });

  return {
    v: 1,
    n: n,
    updated: new Date().toISOString(),
    mean: mean_ === null ? null : +mean_.toFixed(1),
    median: median_ === null ? null : +median_.toFixed(1),
    dist: dist,
    hist: hist,
    byPkg: group('pkg'),
    byRegion: group('region'),
    byScale: group('scale'),
    byCat: byCat
  };
}

/** Отладка из редактора: посмотреть агрегат без Deployment. */
function debugAggregates() {
  Logger.log(JSON.stringify(aggregate_(), null, 2));
}
