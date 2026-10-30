/*!
 * telemetry.js — БиоБарьер: анонимный opt-in бенчмарк России (v0.4).
 *
 * Принципы (гейтится tests/telemetry.test.mjs):
 *  - МОЛЧАНИЕ ПО УМОЛЧАНИЮ: пока человек не нажал кнопку «отправить
 *    анонимный итог», модуль ничего не отправляет; без настроенного
 *    BB_TELEMETRY.submitUrl (telemetry-config.js) карточки отправки нет;
 *  - АНОНИМНОСТЬ КОНСТРУКЦИЕЙ: в payload нет ни одного поля, способного
 *    идентифицировать хозяйство или человека, — только тип хозяйства,
 *    округ и размер (по желанию), итог 0–100 и баллы категорий. Итог
 *    округляется до целого, дата — до дня (бакетинг ради k-анонимности);
 *    сами ответы, режим языка и тексты анкеты не отправляются вовсе;
 *  - ЧЕСТНЫЙ КОНТРАКТ: validatePayload — белый список ключей и значений;
 *    та же проверка продублирована на коллекторе (scripts/collector.gs),
 *    откуда данные читает витрина «Бенчмарк России»;
 *  - ИСТОРИЯ ПРОГОНОВ — локальная (localStorage, только итоги, без
 *    ответов): «ваша динамика» никуда не уходит и стирается одной кнопкой.
 *
 * Хранилище: localStorage; в средах без localStorage (node --test) —
 * памятиный шим, чтобы гейты гоняли те же ветки кода.
 *
 * UMD: браузер — globalThis.BBTelemetry, тесты — export default.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.BBTelemetry = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* Глобал для fetch/JSONP: в фабрике UMD параметр внешней обёртки не виден,
   * берём globalThis явно (браузеры 2019+, Node 12+). Гейтится тестом,
   * который реально доходит до root.fetch. */
  var root = typeof globalThis !== "undefined" ? globalThis : this;

  var VERSION = 1;

  /* Белые списки — единый контракт клиента и коллектора. */
  var PKG_IDS = ["mixed", "poultry", "pigs", "dairy", "beef", "smallrum", "quail"];
  var BANDS = ["bad", "mid", "good"];
  var SCALE_CODES = ["s", "m", "l"];
  /* Федеральные округа (8): достаточно грубо, чтобы не сужать выборку
   * до одиночных хозяйств, и достаточно точно, чтобы видеть географию. */
  var REGIONS = ["ЦФО", "СЗФО", "ЮФО", "СКФО", "ПФО", "УФО", "СФО", "ДФО"];
  /* Размер поголовья: вилки по типу хозяйства, коды s/m/l. */
  var SCALES = {
    mixed:    { s: "до 10 животных", m: "10–50",    l: "больше 50" },
    poultry:  { s: "до 100 голов",   m: "100–1000", l: "больше 1000" },
    pigs:     { s: "до 25 голов",    m: "25–500",   l: "больше 500" },
    dairy:    { s: "до 10 коров",    m: "10–100",   l: "больше 100" },
    beef:     { s: "до 10 голов",    m: "10–100",   l: "больше 100" },
    smallrum: { s: "до 30 голов",    m: "30–300",   l: "больше 300" },
    quail:    { s: "до 100 голов",   m: "100–1000", l: "больше 1000" }
  };

  var KEYS = ["v", "pkg", "ts", "total", "band", "region", "scale", "cats", "ans", "out"];

  /* ---- хранилище: браузер или памятиный шим (тесты) ---------------------- */

  var MEM = {};
  function store() {
    try {
      if (typeof localStorage !== "undefined") { return localStorage; }
    } catch (e) { /* приватный режим: живём в памяти */ }
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(MEM, k) ? MEM[k] : null; },
      setItem: function (k, v) { MEM[k] = String(v); },
      removeItem: function (k) { delete MEM[k]; }
    };
  }

  var HKEY = "biobarrier-history-v1", HCAP = 30;
  var MKEY = "biobarrier-share-v1";

  /* ---- payload: единственное, что покидает браузер, — и по кнопке --------- */

  function todayISO(d) {
    d = d || new Date();
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + "-" + (m < 10 ? "0" + m : m) + "-" + (day < 10 ? "0" + day : day);
  }

  function r1(x) { return Math.round(x); }

  /* buildPayload(pack, res, opts):
   *   pack — пакет из BBPACKS, res — результат BB.compute, opts —
   *   { region: "ЦФО"|null, scale: "s"|"m"|"l"|null } по выбору человека. */
  function buildPayload(pack, res, opts) {
    opts = opts || {};
    var cats = {};
    (res && res.cats ? res.cats : []).forEach(function (c) {
      cats[c.id] = r1(c.score);
    });
    var region = opts.region && REGIONS.indexOf(opts.region) >= 0 ? opts.region : null;
    var scale = opts.scale && SCALE_CODES.indexOf(opts.scale) >= 0 ? opts.scale : null;
    return {
      v: VERSION,
      pkg: pack.id,
      ts: todayISO(),
      total: r1(res.total),
      band: res.level ? res.level.code : null,
      region: region,
      scale: scale,
      cats: cats,
      ans: res.totalQuestions - res.missing,
      out: res.totalQuestions
    };
  }

  function isPlainObject(x) {
    return Object.prototype.toString.call(x) === "[object Object]";
  }

  /* Белый список: ключи точно KEYS, значения точно в диапазонах.
   * Всё, что не описано контрактом, — отвергается и не уходит. */
  function validatePayload(p) {
    if (!isPlainObject(p)) { return false; }
    var keys = Object.keys(p).sort().join(",");
    if (keys !== KEYS.slice().sort().join(",")) { return false; }
    if (p.v !== VERSION) { return false; }
    if (PKG_IDS.indexOf(p.pkg) < 0) { return false; }
    if (typeof p.ts !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(p.ts)) { return false; }
    if (typeof p.total !== "number" || !isFinite(p.total) || p.total < 0 || p.total > 100) { return false; }
    if (BANDS.indexOf(p.band) < 0) { return false; }
    if (p.region !== null && REGIONS.indexOf(p.region) < 0) { return false; }
    if (p.scale !== null && SCALE_CODES.indexOf(p.scale) < 0) { return false; }
    if (!isPlainObject(p.cats) || Object.keys(p.cats).length < 1 || Object.keys(p.cats).length > 40) { return false; }
    var catIds = Object.keys(p.cats);
    for (var i = 0; i < catIds.length; i += 1) {
      var v = p.cats[catIds[i]];
      if (typeof v !== "number" || !isFinite(v) || v < 0 || v > 100) { return false; }
    }
    if (typeof p.ans !== "number" || !isFinite(p.ans) || p.ans < 0 || Math.floor(p.ans) !== p.ans) { return false; }
    if (typeof p.out !== "number" || !isFinite(p.out) || p.out < 0 || Math.floor(p.out) !== p.out) { return false; }
    if (p.ans > p.out) { return false; }
    return true;
  }

  /* ---- отправка: fire-and-forget, no-cors POST текстом -------------------- */

  function submit(url, payload, done) {
    done = done || function () {};
    if (!url || !validatePayload(payload)) { done(false); return; }
    if (typeof root.fetch !== "function") { done(false); return; }
    /* text/plain + no-cors — простые запросы без предпроверки: доходит
     * до Google Apps Script и любых статичных коллекторов. Ответ непрозрачен,
     * поэтому «отправлено» честно означает «ушло с устройства». */
    root.fetch(url, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    }).then(function () { done(true); }, function () { done(false); });
  }

  /* ---- чтение агрегатов: fetch, при CORS-обиде — JSONP --------------------- */

  function fetchStats(url, done) {
    done = done || function () {};
    if (!url) { done(null); return; }
    if (typeof root.fetch === "function") {
      root.fetch(url, { cache: "no-store" }).then(function (r) {
        if (!r.ok) { throw new Error("http " + r.status); }
        return r.json();
      }).then(function (j) { done(j); }, function () { jsonp(url, done); });
      return;
    }
    jsonp(url, done);
  }

  function jsonp(url, done) {
    if (typeof document === "undefined") { done(null); return; }
    var cb = "bbtb" + Date.now() + Math.floor(Math.random() * 1e6);
    var s = document.createElement("script");
    var clean = function () { try { s.remove(); } catch (e) {} };
    root[cb] = function (data) {
      try { delete root[cb]; } catch (e) { root[cb] = undefined; }
      clean(); done(data);
    };
    s.onerror = function () { try { delete root[cb]; } catch (e) { root[cb] = undefined; } clean(); done(null); };
    s.src = url + (url.indexOf("?") >= 0 ? "&" : "?") + "callback=" + cb;
    document.head.appendChild(s);
  }

  /* ---- история прогонов: локальная динамика, без ответов ------------------- */

  function validRun(r) {
    return isPlainObject(r)
      && typeof r.ts === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.ts)
      && PKG_IDS.indexOf(r.pkg) >= 0
      && typeof r.total === "number" && isFinite(r.total) && r.total >= 0 && r.total <= 100
      && BANDS.indexOf(r.band) >= 0;
  }

  function getHistory() {
    var raw = null;
    try { raw = store().getItem(HKEY); } catch (e) {}
    var h = [];
    try { h = JSON.parse(raw || "[]"); } catch (e) { h = []; }
    if (!Array.isArray(h)) { h = []; }
    return h.filter(validRun);
  }

  /* Ререндер того же прогона (снова нажали «показать результат») — не дублируем. */
  function pushRun(run) {
    if (!validRun(run)) { return getHistory(); }
    var h = getHistory();
    var last = h.length ? h[h.length - 1] : null;
    var same = last && last.pkg === run.pkg && r1(last.total) === r1(run.total) && last.ts === run.ts;
    if (same) { return h; }
    h.push({ ts: run.ts, pkg: run.pkg, total: r1(run.total), band: run.band });
    if (h.length > HCAP) { h = h.slice(h.length - HCAP); }
    try { store().setItem(HKEY, JSON.stringify(h)); } catch (e) {}
    return h;
  }

  function clearHistory() {
    try { store().removeItem(HKEY); } catch (e) {}
    return [];
  }

  /* ---- «больше не предлагать» — уважение к отказу -------------------------- */

  function isMuted() {
    var v = null;
    try { v = store().getItem(MKEY); } catch (e) {}
    return v === "mute";
  }
  function mute() { try { store().setItem(MKEY, "mute"); } catch (e) {} }
  function unmute() { try { store().removeItem(MKEY); } catch (e) {} }

  return {
    VERSION: VERSION,
    PKG_IDS: PKG_IDS, BANDS: BANDS, SCALE_CODES: SCALE_CODES,
    REGIONS: REGIONS, SCALES: SCALES,
    todayISO: todayISO,
    buildPayload: buildPayload, validatePayload: validatePayload,
    submit: submit, fetchStats: fetchStats,
    getHistory: getHistory, pushRun: pushRun, clearHistory: clearHistory,
    isMuted: isMuted, mute: mute, unmute: unmute
  };
});
