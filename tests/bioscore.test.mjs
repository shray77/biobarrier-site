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

const HERE = dirname(fileURLToPath(import.meta.url));
const BANK = globalThis.BBQ;
const CATS = globalThis.BBCATS;
const PACKS = globalThis.BBPACKS;
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
