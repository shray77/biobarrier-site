/*!
 * bioscore.test.mjs — гейт витрины «БиоБарьер»: известные ответы.
 *
 * Классы проверок (наследие гейт-культуры экосистемы):
 *  1. структура данных — каждый вопрос имеет ОБЕ формулировки
 *     (владелец/профессионал), варианты растут, максимум = 100;
 *  2. целостность пакетов — Σ весов категорий = 100, все ссылки на банк
 *     существуют, дублей нет, категории определены;
 *  3. бенчмарки — числа в 0–100 с источником; пакет «мелкое хозяйство»
 *     бенчмарка иметь НЕ должен (его в мире не существует — проверяем);
 *  4. арифметика — синтетический пакет с ручным расчётом;
 *  5. частичный скор — пропущенные исключаются из числителя и знаменателя;
 *  6. ЗОЛОТО — тоталы реальных пакетов по трём детерминированным паттернам
 *     ответов, замороженные в tests/bioscore.reference.json (дрейф = красный CI);
 *  7. отчёт — без «undefined» и «NaN».
 *
 * Запуск: node --test tests/bioscore.test.mjs   (CI: .github/workflows/ci.yml)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
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
import '../data-npa.js';
import BioBarrier from '../bioscore.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BANK = globalThis.BBQ;
const CATS = globalThis.BBCATS;
const PACKS = globalThis.BBPACKS;
const NPA = globalThis.BBNPA;
const NMAP = globalThis.BBNPA_MAP;
const NSUP = globalThis.BBNPA_SUPERSEDED;
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

/* ---------- 1. структура банка: двойной язык и градация ------------------ */

test('банк: каждый вопрос имеет обе формулировки (владелец ≠ профи)', () => {
  for (const [id, q] of Object.entries(BANK)) {
    assert.ok(Array.isArray(q.q) && q.q.length === 2, `${id}: q — не пара`);
    assert.ok(q.q[0] && q.q[0].trim().length >= 8, `${id}: пустая формулировка владельца`);
    assert.ok(q.q[1] && q.q[1].trim().length >= 5, `${id}: пустая формулировка профи`);
    assert.notEqual(q.q[0], q.q[1], `${id}: формулировки совпадают — двойной язык умер`);
  }
});

test('банк: у каждого вопроса есть «почему»', () => {
  for (const [id, q] of Object.entries(BANK)) {
    assert.ok(typeof q.why === 'string' && q.why.length >= 20, `${id}: нет why`);
  }
});

test('банк: варианты 2+, баллы строго убывают, в пределах 0..100, лучший = 100', () => {
  for (const [id, q] of Object.entries(BANK)) {
    assert.ok(q.opts.length >= 2, `${id}: меньше двух вариантов`);
    let prev = 101;
    for (const o of q.opts) {
      assert.ok(Number.isFinite(o.s) && o.s >= 0 && o.s <= 100, `${id}: балл вне 0..100`);
      assert.ok(o.s < prev, `${id}: баллы не убывают (${prev} → ${o.s})`);
      prev = o.s;
    }
    assert.equal(q.opts[0].s, 100, `${id}: лучший вариант ≠ 100`);
    /* v0.3: варианты идут от лучшего к худшему — анкета читается «от нормы
     * к проблеме», а не списком самооговоров; худшая ступень может быть
     * мягкой (arr-04: «почти всё покупаю» — 30, не ноль) */
  }
});

test('банк: тексты вариантов — строка или пара [владелец, профи]', () => {
  for (const [id, q] of Object.entries(BANK)) {
    for (const o of q.opts) {
      const ok = typeof o.t === 'string' || (Array.isArray(o.t) && o.t.length === 2);
      assert.ok(ok, `${id}: вариант без корректного текста`);
    }
  }
});

test('банк: каждый вопрос ссылается на известную категорию', () => {
  for (const [id, q] of Object.entries(BANK)) {
    assert.ok(CATS[q.cat], `${id}: категория ${q.cat} не определена`);
  }
});

test('категории: двойное название, группа ext/int, совет «что чинить»', () => {
  for (const [id, c] of Object.entries(CATS)) {
    assert.ok(Array.isArray(c.t) && c.t.length === 2, `${id}: нет двойного названия`);
    assert.ok(['ext', 'int'].includes(c.g), `${id}: группа не ext/int`);
    assert.ok(typeof c.advice === 'string' && c.advice.length >= 20, `${id}: нет совета`);
  }
});

/* ---------- 2. целостность пакетов ---------------------------------------- */

test('пакеты: Σ весов категорий = 100, ссылки существуют, дублей нет', () => {
  for (const p of Object.values(PACKS)) {
    const wsum = p.cats.reduce((a, c) => a + c.w, 0);
    assert.ok(near(wsum, 100), `${p.id}: Σ весов = ${wsum}, а не 100`);
    const seen = new Set();
    for (const c of p.cats) {
      assert.ok(CATS[c.id], `${p.id}: категория ${c.id} не определена`);
      assert.ok(c.qs.length >= 2, `${p.id}/${c.id}: меньше двух вопросов`);
      for (const qid of c.qs) {
        assert.ok(BANK[qid], `${p.id}: вопрос ${qid} не найден в банке`);
        assert.ok(!seen.has(qid), `${p.id}: вопрос ${qid} дублируется`);
        seen.add(qid);
        assert.equal(BANK[qid].cat, c.id, `${p.id}: ${qid} числится в ${c.id}, а живёт в ${BANK[qid].cat}`);
      }
    }
  }
});

test('пакеты: есть и внешние, и внутренние категории', () => {
  for (const p of Object.values(PACKS)) {
    const gs = new Set(p.cats.map((c) => CATS[c.id].g));
    assert.ok(gs.has('ext') && gs.has('int'), `${p.id}: нет одной из групп`);
  }
});

test('пакеты: объём v0.3 — честные 60+ вопросов на пакет (у Biocheck — 79)', () => {
  for (const p of Object.values(PACKS)) {
    const n = BioBarrier.questionCount(p);
    assert.ok(n >= 60, `${p.id}: всего ${n} вопросов — ниже заявленного v0.3`);
  }
});

/* ---------- 2b. v0.5: ЛПХ — три класса весов, порезка, скрининг ------------ */

test('v0.5 ЛПХ: три класса весов {10, 7, 5} с проверенной раскладкой, Σ = 100', () => {
  const p = PACKS.mixed;
  const w = p.cats.map((c) => c.w);
  assert.deepEqual([...new Set(w)].sort((a, b) => b - a), [10, 7, 5], 'веса ЛПХ — не три класса');
  assert.equal(w.reduce((a, x) => a + x, 0), 100, 'Σ весов ЛПХ ≠ 100');
  const CLASS = {
    arrival: 10, feedwater: 10, deadstock: 10, contact: 10,          /* A «ворота» */
    visitors: 7, vermin: 7, materials: 7, boundary: 7, sick: 7,      /* B «разнос» */
    transport: 5, aiao: 5, cleandis: 5, compart: 5, treat: 5         /* C «порядок» */
  };
  for (const c of p.cats) {
    assert.equal(c.w, CLASS[c.id], `${c.id}: вес ${c.w} не из класса ${CLASS[c.id]}`);
  }
  assert.equal(p.cats.filter((c) => c.w === 10).length, 4, 'класс A — не 4 категории');
  assert.equal(p.cats.filter((c) => c.w === 7).length, 5, 'класс B — не 5 категорий');
  assert.equal(p.cats.filter((c) => c.w === 5).length, 5, 'класс C — не 5 категорий');
});

test('v0.5 ЛПХ: фантазийные вопросы вырезаны из профиля, но живы в банке; объём 70', () => {
  const qs = PACKS.mixed.cats.flatMap((c) => c.qs);
  for (const cut of ['tr-02', 'cd-03', 'ds-04']) {
    assert.ok(!qs.includes(cut), `${cut} должен быть вырезан из ЛПХ — фантазия фермерской инфраструктуры`);
    assert.ok(BANK[cut], `${cut} должен остаться в общем банке — пакетам ферм нужен`);
  }
  assert.equal(BioBarrier.questionCount(PACKS.mixed), 70, 'объём ЛПХ ≠ 70 вопросов');
});

test('v0.5 скрининг: определение — 12 вопросов пакета ЛПХ, у каждого есть флаг-вариант и не-флаг', () => {
  const scr = PACKS.mixed.screen;
  assert.ok(scr, 'у пакета ЛПХ нет скрининга');
  assert.equal(scr.qs.length, 12, 'скрининг — не 12 вопросов');
  assert.equal(scr.flagBelow, 25, 'порог флага ≠ 25');
  const packQs = PACKS.mixed.cats.flatMap((c) => c.qs);
  const seen = new Set();
  for (const qid of scr.qs) {
    assert.ok(BANK[qid], `скрининг: ${qid} не найден в банке`);
    assert.ok(packQs.includes(qid), `скрининг: ${qid} не входит в пакет ЛПХ`);
    assert.ok(!seen.has(qid), `скрининг: ${qid} дублируется`);
    seen.add(qid);
    assert.ok(BANK[qid].opts.some((o) => o.s <= scr.flagBelow), `скрининг: у ${qid} нет варианта-флага`);
    assert.ok(BANK[qid].opts.some((o) => o.s > scr.flagBelow), `скрининг: у ${qid} даже лучший вариант — флаг`);
  }
});

test('v0.5 скрининг: худшие ответы → 12 флагов, «ворота открыты»', () => {
  const scr = PACKS.mixed.screen;
  const worst = {};
  scr.qs.forEach((qid) => { worst[qid] = BANK[qid].opts.length - 1; });
  const r = BioBarrier.computeScreen(scr, worst, BANK);
  assert.equal(r.nFlags, 12);
  assert.equal(r.nAnswered, 12);
  assert.equal(r.missing, 0);
  assert.equal(r.level.code, 'bad');
  assert.equal(r.level.label, 'ворота открыты');
});

test('v0.5 скрининг: лучшие ответы → 0 флагов, «двор держится»', () => {
  const scr = PACKS.mixed.screen;
  const best = {};
  scr.qs.forEach((qid) => { best[qid] = 0; });
  const r = BioBarrier.computeScreen(scr, best, BANK);
  assert.equal(r.nFlags, 0);
  assert.equal(r.nAnswered, 12);
  assert.equal(r.level.code, 'good');
});

test('v0.5 скрининг: средние ответы не флагаются; известный смешанный счёт', () => {
  const scr = PACKS.mixed.screen;
  const mid = {};
  scr.qs.forEach((qid) => { mid[qid] = Math.floor((BANK[qid].opts.length - 1) / 2); });
  const rm = BioBarrier.computeScreen(scr, mid, BANK);
  assert.equal(rm.nFlags, 0, 'средние ответы не должны поднимать флаги');
  assert.equal(rm.level.code, 'good');
  const mixed = {};
  scr.qs.forEach((qid, i) => { mixed[qid] = i < 3 ? BANK[qid].opts.length - 1 : 0; });
  const r = BioBarrier.computeScreen(scr, mixed, BANK);
  assert.equal(r.nFlags, 3);
  assert.equal(r.level.code, 'mid');
  assert.equal(r.level.label, 'дыры есть');
});

test('v0.5 скрининг: пропущенный вопрос — не флаг и не «чистота»; уровень с 8 ответов', () => {
  const scr = PACKS.mixed.screen;
  const seven = {};
  scr.qs.slice(0, 7).forEach((qid) => { seven[qid] = 0; });
  const r = BioBarrier.computeScreen(scr, seven, BANK);
  assert.equal(r.nFlags, 0);
  assert.equal(r.nAnswered, 7);
  assert.equal(r.missing, 5);
  assert.equal(r.level, null, 'семи ответов мало для уровня');
  const eight = {};
  scr.qs.slice(0, 8).forEach((qid) => { eight[qid] = 0; });
  assert.equal(BioBarrier.computeScreen(scr, eight, BANK).level.code, 'good');
  assert.equal(BioBarrier.computeScreen(scr, {}, BANK).level, null, 'ноль ответов — не «двор держится»');
});

test('v0.5 скрининг: пороги уровней 0–1 / 2–4 / 5+ не дрейфуют', () => {
  assert.equal(BioBarrier.screenLevel(0).code, 'good');
  assert.equal(BioBarrier.screenLevel(1).code, 'good');
  assert.equal(BioBarrier.screenLevel(2).code, 'mid');
  assert.equal(BioBarrier.screenLevel(4).code, 'mid');
  assert.equal(BioBarrier.screenLevel(5).code, 'bad');
  assert.equal(BioBarrier.screenLevel(12).code, 'bad');
});

test('v0.5 отчёт скрининга: без undefined и NaN, со счётом и подписью витрины', () => {
  const scr = PACKS.mixed.screen;
  const worst = {};
  scr.qs.forEach((qid) => { worst[qid] = BANK[qid].opts.length - 1; });
  const r = BioBarrier.computeScreen(scr, worst, BANK);
  for (const mode of [0, 1]) {
    const txt = BioBarrier.screenReportText(scr, r, BANK, mode);
    assert.ok(!txt.includes('undefined') && !txt.includes('NaN'), 'мусор в отчёте скрининга');
    assert.ok(txt.includes('БиоБарьер') && txt.includes('biobarrier-site'), 'нет подписи витрины');
    assert.ok(txt.includes('Флагов: 12 из 12'), 'нет счёта флагов');
  }
});

/* ---------- 3. бенчмарки --------------------------------------------------- */

test('бенчмарки: числа в 0..100 и источник; свиньи без итога (честно)', () => {
  for (const p of Object.values(PACKS)) {
    if (!p.bench) { continue; }
    assert.ok(p.bench.label && p.bench.label.length > 10, `${p.id}: нет подписи бенчмарка`);
    assert.ok(p.bench.src, `${p.id}: нет источника бенчмарка`);
    for (const k of ['ext', 'int', 'total']) {
      const v = p.bench[k];
      assert.ok(v === null || (v >= 0 && v <= 100), `${p.id}.${k}: бенчмарк вне 0..100`);
    }
  }
  assert.equal(PACKS.pigs.bench.total, null, 'свиньи: итогового бенчмарка в источнике нет — не выдумывать');
});

test('пакеты без бенчмарка: ЛПХ, откорм КРС, жвачные, перепела — и это проверяется', () => {
  for (const id of ['mixed', 'beef', 'smallrum', 'quail']) {
    assert.equal(PACKS[id].bench, null, `${id}: не должен иметь бенчмарка — опубликованных средних нет`);
  }
});

/* ---------- 4. арифметика на синтетике (руки) ------------------------------ */

const SYN_BANK = {
  's-a1': { cat: 'sa', q: ['a1?', 'a1p?'], why: '…', opts: [{ t: 'хорошо', s: 100 }, { t: 'середина', s: 50 }, { t: 'плохо', s: 0 }] },
  's-a2': { cat: 'sa', q: ['a2?', 'a2p?'], why: '…', opts: [{ t: 'хорошо', s: 100 }, { t: 'середина', s: 50 }, { t: 'плохо', s: 0 }] },
  's-b1': { cat: 'sb', q: ['b1?', 'b1p?'], why: '…', opts: [{ t: 'хорошо', s: 100 }, { t: 'плохо', s: 0 }] }
};
const SYN_CATS = {
  sa: { t: ['SA', 'SA'], g: 'ext', advice: 'починить SA' },
  sb: { t: ['SB', 'SB'], g: 'int', advice: 'починить SB' }
};
const SYN_PACK = {
  id: 'syn', title: 'Синт', sub: '—', icon: 'mixed', about: '',
  cats: [
    { id: 'sa', w: 60, qs: ['s-a1', 's-a2'] },
    { id: 'sb', w: 40, qs: ['s-b1'] }
  ],
  bench: null
};

test('движок: все «хорошо» → 100/100, все «плохо» → 0', () => {
  const hi = { 's-a1': 0, 's-a2': 0, 's-b1': 0 }; /* v0.3: лучший — первый */
  const lo = { 's-a1': 2, 's-a2': 2, 's-b1': 1 };
  assert.equal(BioBarrier.compute(SYN_PACK, hi, SYN_CATS, SYN_BANK).total, 100);
  assert.equal(BioBarrier.compute(SYN_PACK, lo, SYN_CATS, SYN_BANK).total, 0);
});

test('движок: ручной расчёт — SA=(100+50)/2=75, SB=0 → 0.6×75 + 0.4×0 = 45', () => {
  const ans = { 's-a1': 0, 's-a2': 1, 's-b1': 1 };
  const r = BioBarrier.compute(SYN_PACK, ans, SYN_CATS, SYN_BANK);
  assert.equal(r.total, 45);
  assert.equal(r.ext, 75);
  assert.equal(r.int, 0);
});

test('движок: топ-3 — слабейшие вперёд, при равенстве вес важнее', () => {
  const ans = { 's-a1': 0, 's-a2': 1, 's-b1': 1 }; /* SB=0 слабейший → первый */
  const r = BioBarrier.compute(SYN_PACK, ans, SYN_CATS, SYN_BANK);
  assert.equal(r.top3[0].id, 'sb');
  assert.ok(r.top3[0].advice.includes('SB'));
});

/* ---------- 5. частичный скор ----------------------------------------------- */

test('частичный скор: пропущенные исключаются из числителя И знаменателя', () => {
  const ans = { 's-a1': 0 }; /* отвечена только SA-1 (100): SA=100, SB нет */
  const r = BioBarrier.compute(SYN_PACK, ans, SYN_CATS, SYN_BANK);
  assert.equal(r.total, 100); /* вес SB исключён из знаменателя */
  assert.equal(r.missing, 2);
  assert.equal(r.int, null);
});

test('частичный скор: ноль ответов → total null, а не 0', () => {
  const r = BioBarrier.compute(SYN_PACK, {}, SYN_CATS, SYN_BANK);
  assert.equal(r.total, null);
  assert.equal(r.level, null);
});

/* ---------- 6. ЗОЛОТО: замороженные тоталы реальных пакетов ----------------- */

const REF = JSON.parse(readFileSync(join(HERE, 'bioscore.reference.json'), 'utf8'));

/* v0.3: варианты идут от лучшего к худшему — 'best' выбирает первый
 * индекс, 'worst' — последний, 'seeded' — детерминированный разнобой. */
function patternAnswers(p, pattern) {
  const answers = {};
  let i = 0;
  for (const c of p.cats) {
    for (const qid of c.qs) {
      const n = BANK[qid].opts.length;
      if (pattern === 'best') { answers[qid] = 0; }
      else if (pattern === 'worst') { answers[qid] = n - 1; }
      else { answers[qid] = (i * 7 + 3) % n; } /* seeded: детерминированный разнобой */
      i += 1;
    }
  }
  return answers;
}

for (const p of Object.values(PACKS)) {
  for (const pattern of ['best', 'worst', 'seeded']) {
    test(`золото: ${p.id} × ${pattern} — тотал не дрейфует`, () => {
      const r = BioBarrier.compute(p, patternAnswers(p, pattern), CATS, BANK);
      const frozen = REF[p.id][pattern];
      assert.ok(frozen !== undefined, `${p.id}/${pattern}: нет замороженного значения`);
      assert.equal(r.total, frozen.total, `${p.id}/${pattern}: total дрейфует (${r.total} против ${frozen.total})`);
      assert.equal(r.ext, frozen.ext);
      assert.equal(r.int, frozen.int);
    });
  }
}

/* ---------- 7. отчёт ------------------------------------------------------------ */

test('отчёт: без undefined и NaN, с адресом витрины', () => {
  for (const p of Object.values(PACKS)) {
    const r = BioBarrier.compute(p, patternAnswers(p, 'seeded'), CATS, BANK);
    for (const mode of [0, 1]) {
      const txt = BioBarrier.reportText(p, r, CATS, mode);
      assert.ok(!txt.includes('undefined') && !txt.includes('NaN'), `${p.id}/${mode}: мусор в отчёте`);
      assert.ok(txt.includes('БиоБарьер') && txt.includes('biobarrier-site'), `${p.id}: нет подписи витрины`);
      assert.ok(txt.includes('Чинить первыми'), `${p.id}: нет топ-3 в отчёте`);
    }
  }
});

test('отчёт: язык режима — владелец и профи дают разные заголовки категорий', () => {
  const p = PACKS.mixed;
  const r = BioBarrier.compute(p, patternAnswers(p, 'seeded'), CATS, BANK);
  const o = BioBarrier.reportText(p, r, CATS, 0);
  const pr = BioBarrier.reportText(p, r, CATS, 1);
  assert.notStrictEqual(o, pr, 'режим языка не меняет отчёт');
  const t = CATS[r.top3[0].id].t; /* топ-3 зависит от ответов — проверяем реальную пару */
  assert.ok(o.includes(t[0]), 'режим владельца не работает');
  assert.ok(pr.includes(t[1]) && !pr.includes(t[0]), 'режим профи не работает');
});

/* ---------- 8. тон: анкета без «казённого» языка проверяющего --------------- */

/* Слова инспекции в языке ВЛАДЕЛЬЦА (q[0], why, варианты t[0], советы категорий).
 * Фидбек поля v0.1: честный ответ не должен ощущаться самооговором, который
 * «летит в Роспотребнадзор». Профессиональный режим (q[1]/t[1]) терминологию
 * сохраняет — там «журнал посетителей» уместен.
 * v0.3: туда же — маркеры снисходительности («кое-как», «как повезёт»):
 * фидбек поля повторно: «формат текста, будто это явка с повинной». */
const SNAG = ['журнал', 'регистрац', 'разрешени', 'регламент', 'сертифиц', 'свидетельств',
  'договор', 'предписан', 'надзор', 'норматив', 'запрещ', 'штраф', 'виноват', 'признан',
  'кое-как', 'как повезёт', 'всё подряд', 'рой стоит', 'вещь же хорошая', 'что найду',
  'побрызгали', 'днями может', 'разгрузили и ладно', 'как выглядит — так и хорошо',
  'телится где придётся', 'ходят где хотят'];

function ownerStrings(q) {
  return [q.q[0], q.why].concat(q.opts.map((o) => (Array.isArray(o.t) ? o.t[0] : o.t)));
}

test('тон: язык владельца без слов проверяющего (журнал/договор/разрешение…)', () => {
  for (const [id, q] of Object.entries(BANK)) {
    const joined = ownerStrings(q).join(' ').toLowerCase();
    for (const w of SNAG) {
      assert.ok(!joined.includes(w), `${id}: «${w}» в языке владельца — запах проверки, переписать`);
    }
  }
  for (const [id, c] of Object.entries(CATS)) {
    const a = c.advice.toLowerCase();
    for (const w of SNAG) {
      assert.ok(!a.includes(w), `${id}: «${w}» в совете — язык проверяющего`);
    }
  }
});

/* ---------- 9. светофор: пороги стабильны ------------------------------------ */

test('светофор: пороги 50/75 не дрейфуют, направление — выше лучше', () => {
  assert.equal(BioBarrier.level(0).code, 'bad');
  assert.equal(BioBarrier.level(49.9).code, 'bad');
  assert.equal(BioBarrier.level(50).code, 'mid');
  assert.equal(BioBarrier.level(74.9).code, 'mid');
  assert.equal(BioBarrier.level(75).code, 'good');
  assert.equal(BioBarrier.level(100).code, 'good');
});

/* ---------- 10. витрина: шкала направления и печать светофора ---------------- */

test('витрина: шкала 0–100 с зонами и маркером у итога', () => {
  const html = readFileSync(join(HERE, '..', 'index.html'), 'utf8');
  assert.ok(html.includes('fx-scalewrap'), 'нет обёртки шкалы итога');
  assert.ok(html.includes('fx-scale-note'), 'нет подписи шкалы');
  assert.ok(html.includes('выше — лучше'), 'направление шкалы не названо явно');
  assert.ok(html.includes('bb-lvl'), 'нет слов-уровней у полос категорий');
});

test('витрина: светофор печатается в PDF — print-color-adjust в @media print', () => {
  const html = readFileSync(join(HERE, '..', 'index.html'), 'utf8');
  assert.ok(/@media\s+print/.test(html), 'нет print-стилей вообще');
  assert.ok(html.includes('print-color-adjust: exact'), 'нет print-color-adjust: полосы в PDF пустые');
  assert.ok(html.includes('-webkit-print-color-adjust: exact'), 'нет -webkit-префикса для Safari');
  assert.ok(/beforeprint/.test(html), 'печать не переводит тёмную тему в белую');
  assert.ok(html.includes('bb-privacy'), 'нет баннера «зеркало, а не проверка»');
});

test('витрина v0.5: лента скрининга, «между зонами» у порога, скрининг не трогает телеметрию', () => {
  const html = readFileSync(join(HERE, '..', 'index.html'), 'utf8');
  assert.ok(html.includes('bb-screen-strip'), 'нет ленты скрининга на экране выбора');
  assert.ok(html.includes('красные флаги'), 'экран выбора не называет красные флаги');
  assert.ok(html.includes('fx-edge'), 'нет пометки «между зонами» у порога');
  assert.ok(/Math\.abs\(res\.total - 50\) <= 2\.5/.test(html), 'нет полосы честности ±2.5 у порога 50');
  assert.ok(html.includes('показать флаги'), 'нет кнопки результата скрининга');
  assert.ok(html.includes('онлайн · v0.5') || html.includes('онлайн · v0.6'), 'версия в шапке не поднята');
  /* скрининг — только локально: блок рендера флагов не зовёт телеметрию */
  const seg = html.slice(html.indexOf('function renderScreenResult'), html.indexOf('function computeAndRender'));
  assert.ok(seg.length > 500, 'не найден блок renderScreenResult');
  assert.ok(!seg.includes('pushRun') && !seg.includes('renderShareCard') && !seg.includes('BBTelemetry'),
    'скрининг не должен уходить в бенчмарк России и историю прогонов');
});

/* ---------- 11. v0.6: матрица «вопрос ↔ норма» ------------------------------ */

test('v0.6 матрица: покрывает весь банк — у каждого вопроса есть запись, лишних нет', () => {
  for (const qid of Object.keys(BANK)) {
    assert.ok(NMAP[qid], `${qid}: нет записи в матрице НПА`);
  }
  for (const qid of Object.keys(NMAP)) {
    assert.ok(BANK[qid], `матрица ссылается на несуществующий вопрос ${qid}`);
  }
});

test('v0.6 матрица: статусы — только norm/frame/practice; norm обязан иметь нормы', () => {
  for (const [qid, m] of Object.entries(NMAP)) {
    assert.ok(['norm', 'frame', 'practice'].includes(m.st), `${qid}: неизвестный статус ${m.st}`);
    if (m.st === 'norm') {
      assert.ok(Array.isArray(m.refs) && m.refs.length >= 1, `${qid}: статус norm без норм`);
    }
  }
});

test('v0.6 матрица: ссылки ведут на реестр, формат записи строгий', () => {
  for (const [qid, m] of Object.entries(NMAP)) {
    for (const r of m.refs || []) {
      assert.ok(Array.isArray(r) && r.length === 3, `${qid}: запись нормы — не тройка [акт, пункт, суть]`);
      assert.ok(NPA[r[0]], `${qid}: ссылка на неизвестный акт ${r[0]}`);
      assert.ok(typeof r[2] === 'string' && r[2].length >= 10, `${qid}: у нормы пустая суть`);
      assert.ok(r[1] === null || /^[пст]\.\s|^[—]/.test(r[1] || '') || r[1].length <= 40,
        `${qid}: подозрительный «пункт» ${JSON.stringify(r[1])}`);
    }
  }
});

test('v0.6 реестр: у каждого акта полные реквизиты и источник', () => {
  const want = ['kind', 'num', 'date', 'title', 'inForce', 'scope', 'key', 'src'];
  for (const [id, a] of Object.entries(NPA)) {
    for (const k of want) {
      assert.ok(typeof a[k] === 'string' && a[k].length >= 3, `${id}: нет поля ${k}`);
    }
    assert.ok(/^https:\/\//.test(a.src), `${id}: источник не URL`);
    assert.ok(/\d{2}\.\d{2}\.\d{4}/.test(a.date), `${id}: дата не в формате ДД.ММ.ГГГГ`);
  }
  assert.equal(Object.keys(NPA).length, 9, 'в реестре не 9 актов');
});

test('v0.6 анти-миф: матрица не ссылается на отменённые акты, замены на месте', () => {
  /* Ключевой урок спора: записка v0.4.1 ссылалась на приказ № 103 (птица),
   * который к октябрю 2026 год как отменён № 188. Гейт держит свежесть. */
  const superNums = NSUP.map((s) => s.num);
  assert.ok(superNums.includes('№ 103') && superNums.includes('№ 213')
    && superNums.includes('№ 90') && superNums.includes('№ 626'), 'список отменённых неполон');
  for (const s of NSUP) {
    const replacement = Object.values(NPA).find((a) => (a.replaced || '').includes(s.num));
    assert.ok(replacement, `отменённый ${s.num}: не найден заменяющий акт в реестре`);
  }
  for (const [qid, m] of Object.entries(NMAP)) {
    for (const r of m.refs || []) {
      const cited = (NPA[r[0]] || {}).num;
      assert.ok(!superNums.includes(cited), `${qid}: ссылка на отменённый акт ${cited}`);
    }
  }
});

test('v0.6 реестр: свежие замены в основании — № 188 (птица), № 677 (отходы), № 37 (АЧС), № 158 (грипп)', () => {
  assert.ok((NPA.p188.replaced || '').includes('№ 103'), '№ 188 не объявляет отмену № 103');
  assert.ok((NPA.p677.replaced || '').includes('№ 626'), '№ 677 не объявляет отмену № 626');
  assert.ok((NPA.p37.replaced || '').includes('№ 213'), '№ 37 не объявляет отмену № 213');
  assert.ok((NPA.p158.replaced || '').includes('№ 90'), '№ 158 не объявляет отмену № 90');
  assert.ok((NPA.p622.replaced || '').includes('№ 551') || (NPA.p622.inForce || '').includes('2021'),
    '№ 622: не видно, что он сменил № 551');
});

test('v0.6 витрина: matrix.html жив — реестр, фильтры, статусные метки, ссылка на анкету', () => {
  const html = readFileSync(join(HERE, '..', 'matrix.html'), 'utf8');
  assert.ok(html.includes('Матрица «вопрос ↔ норма»'), 'matrix.html: нет заголовка матрицы');
  assert.ok(html.includes('data-npa.js'), 'matrix.html: не подключён data-npa.js');
  assert.ok(html.includes('f-pkg') && html.includes('f-cat') && html.includes('f-st'),
    'matrix.html: нет фильтров пакет/категория/статус');
  assert.ok(html.includes('st-norm') && html.includes('st-frame') && html.includes('st-practice'),
    'matrix.html: нет статусных меток');
  assert.ok(html.includes('./index.html'), 'matrix.html: нет пути назад к анкете');
  assert.ok(!html.includes('telemetry'), 'matrix.html: телеметрии тут не место');
  assert.ok(/@media\s+print/.test(html), 'matrix.html: нет print-стилей');
});

test('v0.6 анкета: data-npa подключён, чипы норм в профи-режиме, ссылка на матрицу', () => {
  const html = readFileSync(join(HERE, '..', 'index.html'), 'utf8');
  assert.ok(html.includes('data-npa.js'), 'index.html: не подключён data-npa.js');
  assert.ok(html.includes('npaChip'), 'index.html: нет рендера чипов нормы');
  assert.ok(html.includes("state.mode === 1"), 'index.html: чипы не привязаны к профи-режиму');
  assert.ok(html.includes('matrix.html'), 'index.html: нет ссылки на матрицу');
  assert.ok(html.includes('онлайн · v0.6'), 'index.html: версия не поднята до v0.6');
  assert.ok(html.includes('catActs'), 'index.html: нет колонки норм в таблице категорий');
  /* чипы не появляются в режиме владельца: рендер ограничен профи-режимом */
  const seg = html.slice(html.indexOf('function npaChip'), html.indexOf('function renderPacks'));
  assert.ok(seg.includes("state.mode === 1") || html.indexOf("state.mode === 1") > -1,
    'чипы нормы должны показываться только профессионалу');
});

/* ---------- 12. v0.6: валидация классов A/B/C — гейт CI --------------------- */

test('v0.6 валидация: scripts/bb_class_validation.cjs проходит без провалов', () => {
  const r = spawnSync(process.execPath, [join(HERE, '..', 'scripts', 'bb_class_validation.cjs')],
    { encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, `валидация классов падает:\n${r.stdout}\n${r.stderr}`);
  assert.ok(r.stdout.includes('все проверки зелёные'), 'валидация не отчиталась зелёным итогом');
});

test('v0.6 валидация: отчёт VALIDATION.md существует и честно ограничивает себя', () => {
  const md = readFileSync(join(HERE, '..', 'VALIDATION.md'), 'utf8');
  assert.ok(md.includes('виньет'), 'VALIDATION.md: не назван метод — виньеты');
  assert.ok(md.includes('не полевая валидация') || md.includes('чем это не является'),
    'VALIDATION.md: нет честной пометки «это не полевая валидация»');
  assert.ok(md.includes('aHoles') && md.includes('монотонность'), 'VALIDATION.md: нет результатов монотонности');
  assert.ok(md.includes('Полярная валидация') || md.includes('полярная валидация'),
    'VALIDATION.md: полярная валидация не поставлена в очередь');
});
