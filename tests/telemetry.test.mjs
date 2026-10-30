/*!
 * telemetry.test.mjs — гейт v0.4 «БиоБарьер»: анонимный opt-in бенчмарк.
 *
 * Классы проверок:
 *  1. ФОРМА ДАННЫХ: payload — ровно десять полей белого списка, ничего
 *     личного: ни ответов, ни режима, ни идентификаторов вопроса;
 *  2. ЗНАЧЕНИЯ: итог округлён до целого, band совпадает со светофором,
 *     ts — дата без времени, регион/размер по желанию (null по умолчанию);
 *  3. ВАЛИДАЦИЯ: validatePayload принимает честный payload и отвергает
 *     мусор — чужой пакет, лишнее поле, итог вне 0–100, «Москва» вместо
 *     округа, отрицательные категории, ans > out;
 *  4. ИСТОРИЯ ПРОГОНОВ: дубли ререндера не пишутся, кэп 30, стирается;
 *  5. «БОЛЬШЕ НЕ ПРЕДЛАГАТЬ»: mute/unmute;
 *  6. КОНТРАКТ ВИТРИНЫ: карточка opt-in и секция «Бенчмарк России» в
 *     index.html, в печать они не попадают, коллектор с doPost/doGet/JSONP
 *     лежит в scripts/collector.gs;
 *  7. ЧЕСТНОСТЬ КОПИРАЙТА: ушедшие из v0.3 обещания «отправки нет»
 *     заменены на opt-in формулировки «по умолчанию».
 *
 * Запуск: node --test tests/   (вместе с bioscore.test.mjs; CI: .github/workflows/ci.yml)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/* Датафайлы — сайд-эффект модули: наполняют globalThis.BBQ/BBCATS/BBPACKS */
import '../data-shared.js';
import '../data-poultry.js';
import '../data-pigs.js';
import '../data-dairy.js';
import '../data-mixed.js';
import '../data-beef.js';
import '../data-smallrum.js';
import '../data-quail.js';
import BioBarrier from '../bioscore.js';
import BBTelemetry from '../telemetry.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const CATS = globalThis.BBCATS;
const BANK = globalThis.BBQ;
const PACKS = globalThis.BBPACKS;

/* seeded-разнобой — тот же детерминированный паттерн, что в золоте тоталов */
function seeded(p) {
  const answers = {};
  let i = 0;
  for (const c of p.cats) {
    for (const qid of c.qs) {
      answers[qid] = (i * 7 + 3) % BANK[qid].opts.length;
      i += 1;
    }
  }
  return answers;
}

const res = BioBarrier.compute(PACKS.mixed, seeded(PACKS.mixed), CATS, BANK);

/* ---------- 1. форма данных: белый список полей --------------------------- */

test('payload: ровно 10 полей белого списка — и ни одного лишнего', () => {
  const p = BBTelemetry.buildPayload(PACKS.mixed, res, { region: 'ЦФО', scale: 's' });
  assert.deepEqual(
    Object.keys(p).sort(),
    ['ans', 'band', 'cats', 'out', 'pkg', 'region', 'scale', 'total', 'ts', 'v']
  );
});

test('payload: ничего личного — ни ответов, ни режима, ни id вопросов', () => {
  const p = BBTelemetry.buildPayload(PACKS.mixed, res, {});
  const txt = JSON.stringify(p);
  assert.ok(!txt.includes('"q"'), 'в payload попали формулировки вопросов');
  assert.ok(!/(?:mx|arr|tr|fw|mat|vis|ver|bd|ds|aiao|cd|cmp|sk|tt|pg|dr|ck|sr|ql|bf)-\d/.test(txt),
    'в payload попали идентификаторы вопросов');
  assert.ok(!('mode' in p) && !('answers' in p) && !('uid' in p) && !('ua' in p),
    'в payload есть служебные/личные поля');
});

/* ---------- 2. значения ----------------------------------------------------- */

test('payload: итог целый, band совпадает со светофором, ts — день без времени', () => {
  const p = BBTelemetry.buildPayload(PACKS.mixed, res, {});
  assert.equal(p.total, Math.round(res.total));
  assert.equal(p.band, res.level.code);
  assert.match(p.ts, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(p.pkg, 'mixed');
  assert.equal(p.v, 1);
});

test('payload: категории — {id: целый балл}, ans/out сходятся с расчётом', () => {
  const p = BBTelemetry.buildPayload(PACKS.mixed, res, {});
  assert.ok(Object.keys(p.cats).length >= 10, 'категорий подозрительно мало');
  for (const [cid, v] of Object.entries(p.cats)) {
    assert.ok(Number.isInteger(v) && v >= 0 && v <= 100, `${cid}: балл категории не целый/вне 0..100`);
  }
  assert.equal(p.ans, res.totalQuestions - res.missing);
  assert.equal(p.out, res.totalQuestions);
});

test('payload: регион и размер не указаны → null (оба поля опциональные)', () => {
  const p = BBTelemetry.buildPayload(PACKS.mixed, res, {});
  assert.equal(p.region, null);
  assert.equal(p.scale, null);
});

test('payload: чужой регион/размер тихо выпадают в null, а не летят на сервер', () => {
  const p = BBTelemetry.buildPayload(PACKS.mixed, res, { region: 'Москва', scale: 'xl' });
  assert.equal(p.region, null);
  assert.equal(p.scale, null);
});

/* ---------- 3. валидация: зеркало коллектора ------------------------------- */

test('validate: честный payload проходит, мусор отвергается', () => {
  const ok = BBTelemetry.buildPayload(PACKS.poultry, BioBarrier.compute(
    PACKS.poultry, seeded(PACKS.poultry), CATS, BANK), { region: 'СФО', scale: 'm' });
  assert.equal(BBTelemetry.validatePayload(ok), true);

  const bad = [
    { ...ok, pkg: 'horses' },                       /* чужой пакет */
    { ...ok, extra: 'x' },                          /* лишнее поле */
    (({ v, ...rest }) => ({ ...rest }))(ok),        /* недостающее поле */
    { ...ok, v: 2 },                                /* другая версия контракта */
    { ...ok, total: 101 },                          /* итог вне шкалы */
    { ...ok, total: -1 },
    { ...ok, band: 'sosisko' },                     /* несуществующий уровень */
    { ...ok, region: 'Москва' },                    /* не округ */
    { ...ok, scale: 'xl' },                         /* не s/m/l */
    { ...ok, cats: { arrival: -5 } },               /* категория вне 0..100 */
    { ...ok, cats: {} },                            /* категорий нет */
    { ...ok, ans: ok.out + 5 },                     /* отвечено больше, чем есть */
    { ...ok, ts: '31.10.2026' },                    /* не ISO-день */
    null, 'строка', 42                              /* вообще не объект */
  ];
  for (const b of bad) {
    assert.equal(BBTelemetry.validatePayload(b), false, `мусор прошёл: ${JSON.stringify(b)}`);
  }
});

/* ---------- 4. история прогонов: локальная динамика ------------------------ */

test('история: ререндер того же прогона не пишет дубль', () => {
  BBTelemetry.clearHistory();
  const run = { ts: '2026-10-31', pkg: 'mixed', total: 62, band: 'mid' };
  BBTelemetry.pushRun(run);
  BBTelemetry.pushRun(run);
  const h = BBTelemetry.pushRun(run);
  assert.equal(h.length, 1);
});

test('история: разные прогоны пишутся, кэп 30, мусор не читается', () => {
  BBTelemetry.clearHistory();
  for (let i = 0; i < 40; i += 1) {
    BBTelemetry.pushRun({ ts: '2026-10-31', pkg: 'poultry', total: 40 + i, band: 'mid' });
  }
  let h = BBTelemetry.getHistory();
  assert.equal(h.length, 30, 'кэп 30 не держится');
  assert.ok(h.every((r) => r.total >= 50), 'отсохли старые, а не новые');
  BBTelemetry.pushRun({ ts: '2026-10-31', pkg: 'horses', total: 50, band: 'mid' }); /* мусор */
  h = BBTelemetry.getHistory();
  assert.equal(h.length, 30, 'мусорный прогон попал в историю');
  BBTelemetry.clearHistory();
  assert.equal(BBTelemetry.getHistory().length, 0);
});

/* ---------- 5. «больше не предлагать» --------------------------------------- */

test('mute: отказ уважается и снимается', () => {
  BBTelemetry.unmute();
  assert.equal(BBTelemetry.isMuted(), false);
  BBTelemetry.mute();
  assert.equal(BBTelemetry.isMuted(), true);
  BBTelemetry.unmute();
  assert.equal(BBTelemetry.isMuted(), false);
});

/* ---------- 6. сеть: без URL модуль молчит ---------------------------------- */

test('сеть: submit без URL и с мусором не отправляет ничего', async () => {
  const p = BBTelemetry.buildPayload(PACKS.mixed, res, {});
  let called = false;
  BBTelemetry.submit('', p, (ok) => { called = true; assert.equal(ok, false); });
  assert.ok(called, 'пустой URL: колбэк не вызван');
  let called2 = false;
  BBTelemetry.submit('https://example.invalid/exec', { ...p, total: 999 }, (ok) => {
    called2 = true; assert.equal(ok, false);
  });
  assert.ok(called2, 'мусорный payload: колбэк не вызван');
});

test('сеть: валидный submit ДОХОДИТ до fetch (мусорный порт → reject → false)', async () => {
  /* Репрессия бага UMD: фабрика ссылалась на неопределённый root и падала
   * ReferenceError ДО fetch — ранние return в тестах выше это не ловили. */
  const p = BBTelemetry.buildPayload(PACKS.mixed, res, {});
  const ok = await new Promise((resolve) => {
    BBTelemetry.submit('http://127.0.0.1:9/exec', p, resolve);
  });
  assert.equal(ok, false, 'недоступный порт обязан дать false, а не исключение');
});

test('сеть: fetchStats без URL возвращает null, не бросая', async () => {
  const v = await new Promise((resolve) => BBTelemetry.fetchStats('', resolve));
  assert.equal(v, null);
});

test('сеть: fetchStats с недоступным URL честно отдаёт null (JSONP в node нет)', async () => {
  const v = await new Promise((resolve) => BBTelemetry.fetchStats('http://127.0.0.1:9/exec', resolve));
  assert.equal(v, null);
});

/* ---------- 7. справочники: вилки и округа ---------------------------------- */

test('справочники: вилки размера есть у всех пакетов, округа — 8 уникальных', () => {
  for (const id of Object.keys(PACKS)) {
    const sc = BBTelemetry.SCALES[id];
    assert.ok(sc && sc.s && sc.m && sc.l, `${id}: нет вилки размера поголовья`);
  }
  assert.equal(new Set(BBTelemetry.REGIONS).size, 8);
  /* одинаковые множества пакетов: справочник телеметрии и реестр витрины */
  assert.deepEqual([...BBTelemetry.PKG_IDS].sort(), Object.keys(PACKS).sort());
});

/* ---------- 8. контракт витрины: UI и печать --------------------------------- */

test('витрина: секция «Бенчмарк России», карточка opt-in и конфиг на месте', () => {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  assert.ok(html.includes('id="bench"'), 'нет секции «Бенчмарк России»');
  assert.ok(html.includes('id="bench-body"'), 'нет тела секции бенчмарка');
  assert.ok(html.includes('bb-share'), 'нет карточки opt-in отправки');
  assert.ok(html.includes('share-host'), 'нет хоста карточки в результате');
  assert.ok(html.includes('src="./telemetry-config.js"'), 'конфиг коллектора не подключён');
  assert.ok(html.includes('src="./telemetry.js"'), 'модуль телеметрии не подключён');
  assert.ok(html.includes('renderBench()'), 'рендер бенчмарка не вызывается');
});

test('витрина: opt-in карточка и секция бенчмарка не печатаются в PDF', () => {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const print = html.match(/@media\s+print\s*\{[\s\S]*?\n  \}/);
  assert.ok(print, 'нет print-блока');
  const block = print[0];
  assert.ok(/\.bb-share/.test(block), 'карточка opt-in уйдёт в печать');
  assert.ok(/#bench/.test(block), 'секция бенчмарка уйдёт в печать');
});

test('коллектор: scripts/collector.gs — doPost, doGet, JSONP и setup', () => {
  const gs = readFileSync(join(ROOT, 'scripts', 'collector.gs'), 'utf8');
  assert.ok(/function doPost/.test(gs), 'нет doPost');
  assert.ok(/function doGet/.test(gs), 'нет doGet');
  assert.ok(gs.includes('callback'), 'нет JSONP-страховки');
  assert.ok(/function setup/.test(gs), 'нет setup() для создания листа');
  assert.ok(gs.includes('submissions'), 'коллектор пишет не в тот лист');
});

/* ---------- 9. честность копирайта: opt-in назван opt-in -------------------- */

test('копирайт: «отправки нет» из v0.2 ушло, вместо него — «по умолчанию»', () => {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  assert.ok(!html.includes('отправки нет, никто не увидит'),
    'старое обещание «никто не увидит» живёт — а opt-in уже есть');
  assert.ok(!html.includes('и никуда не отправлялись'), 'печать всё ещё обещает «никуда не отправлялось»');
  assert.ok((html.match(/по умолчанию/g) || []).length >= 2,
    'нет opt-in формулировки «по умолчанию» (анкета и методология)');
  const terms = readFileSync(join(ROOT, 'terms.html'), 'utf8');
  assert.ok(terms.includes('анонимн') && terms.includes('v0.4'),
    'условия не рассказывают про анонимную отправку v0.4');
});
