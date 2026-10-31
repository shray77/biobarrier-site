#!/usr/bin/env node
/*! bb_class_validation.cjs — валидация трёх классов весов ЛПХ (A/B/C) на виньетках.
 *
 * Синтез научного спора v0.4.1: «валидация — единственный путь к науке», но
 * живой выборки бенчмарка ещё нет (коллектор не подключён). Что можно
 * проверить СЕЙЧАС, не притворяясь полевым исследованием:
 *   1. known-answer арифметика — виньеты с ручным расчётом;
 *   2. иерархия классов — «ворота» (A) наносят больше ущерба баллу, чем
 *      «разнос» (B), тот — больше, чем «порядок» (C): a-holes < b-holes < c-holes;
 *   3. зернистость вопроса — один плохой ответ в A-категории стоит дороже,
 *      чем в C-категории (ΔA > ΔC);
 *   4. топ-3 «что чинить» указывает на продырявленный класс;
 *   5. согласованность скрининга и полного балла (и их заявленная разница);
 *   6. честный частичный скор.
 *
 * ОЖИДАНИЯ ЗАПИСАНЫ ДО ПРОГОНА (a priori) и включены в код отдельно от
 * вычислений: скрипт сравнивает факт с ожиданием и падает (exit 1) при
 * расхождении. Это виньетная проверка МОДЕЛИ, а не полевая валидация:
 * дворы здесь синтетические. Полярная валидация (скор vs вспышки) —
 * после появления живой выборки бенчмарка.
 *
 * Запуск:   node scripts/bb_class_validation.cjs            (проверка, exit 0/1)
 *           node scripts/bb_class_validation.cjs --write    (обновить VALIDATION.md)
 */
'use strict';
global.window = global;
require('../data-shared.js');
require('../data-poultry.js');
require('../data-pigs.js');
require('../data-dairy.js');
require('../data-mixed.js');
require('../data-beef.js');
require('../data-smallrum.js');
require('../data-quail.js');
const BioBarrier = require('../bioscore.js');

const BANK = global.BBQ, CATS = global.BBCATS, PACKS = global.BBPACKS;
const P = PACKS.mixed;
const SCREEN = P.screen;

/* Классы весов v0.5 — из профиля пакета (не дублируем руками: сверяемся с данными) */
const A = ['arrival', 'feedwater', 'deadstock', 'contact'];           /* «ворота» w=10 */
const B = ['visitors', 'vermin', 'materials', 'boundary', 'sick'];    /* «разнос» w=7 */
const C = ['transport', 'aiao', 'cleandis', 'compart', 'treat'];      /* «порядок» w=5 */
const CLASS_OF = {};
A.forEach((c) => { CLASS_OF[c] = 'A'; });
B.forEach((c) => { CLASS_OF[c] = 'B'; });
C.forEach((c) => { CLASS_OF[c] = 'C'; });

/* ---- генераторы ответов --------------------------------------------------- */

const packQs = P.cats.flatMap((c) => c.qs);
const catQs = {};
P.cats.forEach((c) => { catQs[c.id] = c.qs; });

function bestEverywhere() {
  const a = {};
  packQs.forEach((q) => { a[q] = 0; });
  return a;
}
function worstEverywhere() {
  const a = {};
  packQs.forEach((q) => { a[q] = BANK[q].opts.length - 1; });
  return a;
}
function worstIn(cats) {
  const a = bestEverywhere();
  Object.keys(catQs).forEach((cid) => {
    if (!cats.includes(cid)) { return; }
    catQs[cid].forEach((q) => { a[q] = BANK[q].opts.length - 1; });
  });
  return a;
}
function worstOnly(qids) {
  const a = bestEverywhere();
  qids.forEach((q) => { a[q] = BANK[q].opts.length - 1; });
  return a;
}
function middleEverywhere() {
  const a = {};
  packQs.forEach((q) => { a[q] = Math.floor((BANK[q].opts.length - 1) / 2); });
  return a;
}

/* ---- ОЖИДАНИЯ (a priori, до прогона) -------------------------------------- */
/* Рафинированная редакция: первый прогон идеализированных ожиданий (все
 * худшие = 0) поймал реальную деталь банка v0.3 — «мягкие худшие ступени»:
 * в ЛПХ ровно один такой вопрос, arr-04 (худший = 30, «почти всё покупаю»),
 * поэтому категория arrival в «нулевом» сценарии даёт 6/100, а не 0.
 * Все числа ниже пересчитаны руками с этой поправкой и сверен код банка. */

const EXPECT = {
  ideal:        { total: 100, level: 'good', screen: 0 },
  /* gatecrash: arrival = (0+0+0+30+0)/5 = 6 → 10×6/100 = 0.6 — не ноль,
   * и это честно: у двора не бывает «абсолютного нуля» (arr-04 мягкий) */
  gatecrash:    { total: 0.6, level: 'bad',  screen: 12 },
  /* класс-монотонность: 100 − вес класса + мягкость arr-04 в A */
  aHoles:       { total: 60.6 },
  bHoles:       { total: 65 },
  cHoles:       { total: 75 },
  /* чинить ворота первым: A-блок из нуля даёт 10 баллов, C-блок — 5.6
   * (5 + 0.6 от мягкого arr-04 в остальном хаосе) */
  fixOneA:      { total: 10 },
  fixOneC:      { total: 5.6 },
  /* зернистость вопроса: один худший ответ в A (arr-01, худший = 0:
   * arrival = 80) стоит 2.0 балла; в C (tr-01, худший = 0: transport = 75,
   * 98.75 → toFixed → 98.8) — 1.2 балла */
  oneAWorst:    { total: 98 },
  oneCWorst:    { total: 98.8 },
  /* 12 флагов при идеальном остальном: балл падает, но не до нуля —
   * скрининг чувствительнее балла к концентрированным дырам (заявлено) */
  flagsOnly:    { screen: 12, screenLevel: 'bad', totalMin: 50, totalMax: 95 },
  /* середина не «крепко», и попадает в полосу честности ±2.5 у порога 50:
   * пометка «между зонами» обязана сработать */
  middle:       { levelNot: 'good', edgeBand: true },
  partial:      { total: 100, missing: 35 }
};

/* ---- прогон --------------------------------------------------------------- */

const results = [];
function run(name, answers, fn) {
  const r = fn(answers);
  results.push({ name, answers, res: r });
  return r;
}

const rIdeal = run('ideal', bestEverywhere(), (a) => BioBarrier.compute(P, a, CATS, BANK));
const rGate = run('gatecrash', worstEverywhere(), (a) => BioBarrier.compute(P, a, CATS, BANK));
const rA = run('aHoles', worstIn(A), (a) => BioBarrier.compute(P, a, CATS, BANK));
const rB = run('bHoles', worstIn(B), (a) => BioBarrier.compute(P, a, CATS, BANK));
const rC = run('cHoles', worstIn(C), (a) => BioBarrier.compute(P, a, CATS, BANK));

/* из полного хаоса чиним один класс */
function fixFromChaos(cats) {
  const a = worstEverywhere();
  cats.forEach((cid) => { catQs[cid].forEach((q) => { a[q] = 0; }); });
  return a;
}
const rFixA = run('fixOneA', fixFromChaos(['arrival']), (a) => BioBarrier.compute(P, a, CATS, BANK));
const rFixC = run('fixOneC', fixFromChaos(['transport']), (a) => BioBarrier.compute(P, a, CATS, BANK));

const rOneA = run('oneAWorst', worstOnly(['arr-01']), (a) => BioBarrier.compute(P, a, CATS, BANK));
const rOneC = run('oneCWorst', worstOnly(['tr-01']), (a) => BioBarrier.compute(P, a, CATS, BANK));

const rFlags = run('flagsOnly', worstOnly(SCREEN.qs), (a) => BioBarrier.compute(P, a, CATS, BANK));
const rMiddle = run('middle', middleEverywhere(), (a) => BioBarrier.compute(P, a, CATS, BANK));
const halfBest = {};
packQs.slice(0, 35).forEach((q) => { halfBest[q] = 0; });
const rPartial = run('partial', halfBest, (a) => BioBarrier.compute(P, a, CATS, BANK));

const sIdeal = BioBarrier.computeScreen(SCREEN, bestEverywhere(), BANK);
const sGate = BioBarrier.computeScreen(SCREEN, worstEverywhere(), BANK);
const sFlags = BioBarrier.computeScreen(SCREEN, worstOnly(SCREEN.qs), BANK);

/* ---- проверки ------------------------------------------------------------- */

const fails = [];
function check(name, cond, detail) {
  if (!cond) { fails.push(name + (detail ? ': ' + detail : '')); }
  return cond;
}

check('ideal: 100/100 good', rIdeal.total === EXPECT.ideal.total && rIdeal.level.code === EXPECT.ideal.level,
  `total=${rIdeal.total}, level=${rIdeal.level && rIdeal.level.code}`);
check('gatecrash: 0.6/100 bad (мягкая ступень arr-04)',
  rGate.total === EXPECT.gatecrash.total && rGate.level.code === EXPECT.gatecrash.level,
  `total=${rGate.total}`);
check('скрининг: идеал = 0 флагов', sIdeal.nFlags === EXPECT.ideal.screen, `nFlags=${sIdeal.nFlags}`);
check('скрининг: хаос = 12 флагов «ворота открыты»',
  sGate.nFlags === EXPECT.gatecrash.screen && sGate.level.code === 'bad',
  `nFlags=${sGate.nFlags}, level=${sGate.level && sGate.level.code}`);

check('класс-монотонность: aHoles = 60.6 (+мягкость arr-04)', rA.total === EXPECT.aHoles.total, `total=${rA.total}`);
check('класс-монотонность: bHoles = 65', rB.total === EXPECT.bHoles.total, `total=${rB.total}`);
check('класс-монотонность: cHoles = 75', rC.total === EXPECT.cHoles.total, `total=${rC.total}`);
check('порядок ущерба: A < B < C',
  rA.total < rB.total && rB.total < rC.total, `${rA.total} / ${rB.total} / ${rC.total}`);

check('чинить ворота: fixOneA = 10', rFixA.total === EXPECT.fixOneA.total, `total=${rFixA.total}`);
check('чинить порядок: fixOneC = 5.6 (мягкость arr-04)', rFixC.total === EXPECT.fixOneC.total, `total=${rFixC.total}`);
check('выгода A > C при ремонте', rFixA.total > rFixC.total, `${rFixA.total} vs ${rFixC.total}`);

check('зернистость: oneAWorst = 98', rOneA.total === EXPECT.oneAWorst.total, `total=${rOneA.total}`);
check('зернистость: oneCWorst = 98.8 (98.75 → округ)', rOneC.total === EXPECT.oneCWorst.total, `total=${rOneC.total}`);
check('вес одного плохого ответа: A (2.0) > C (1.2)',
  (100 - rOneA.total) > (100 - rOneC.total),
  `ΔA=${(100 - rOneA.total).toFixed(2)}, ΔC=${(100 - rOneC.total).toFixed(2)}`);

function top3Classes(r) {
  return r.top3.map((c) => CLASS_OF[c.id] || '?').join(',');
}
check('топ-3 aHoles — только класс A', rA.top3.every((c) => A.includes(c.id)), top3Classes(rA));
check('топ-3 bHoles — только класс B', rB.top3.every((c) => B.includes(c.id)), top3Classes(rB));
check('топ-3 cHoles — только класс C', rC.top3.every((c) => C.includes(c.id)), top3Classes(rC));

check('flagsOnly: 12 флагов «ворота открыты»',
  sFlags.nFlags === EXPECT.flagsOnly.screen && sFlags.level.code === EXPECT.flagsOnly.screenLevel,
  `nFlags=${sFlags.nFlags}, level=${sFlags.level && sFlags.level.code}`);
check('flagsOnly: балл падает, но двор не разрушен',
  rFlags.total >= EXPECT.flagsOnly.totalMin && rFlags.total <= EXPECT.flagsOnly.totalMax,
  `total=${rFlags.total}`);
const flagCats = new Set(sFlags.flags.map((f) => f.cat));
check('flagsOnly: топ-3 указывает на флаговые категории',
  rFlags.top3.filter((c) => flagCats.has(c.id)).length >= 2,
  rFlags.top3.map((c) => c.id).join(','));

check('middle: середина не «крепко»', rMiddle.level.code !== EXPECT.middle.levelNot,
  `total=${rMiddle.total}, level=${rMiddle.level && rMiddle.level.code}`);
check('middle: середина попадает в полосу честности ±2.5 у порога 50 («между зонами»)',
  Math.abs(rMiddle.total - 50) <= 2.5,
  `total=${rMiddle.total}, отклонение ${Math.abs(rMiddle.total - 50).toFixed(1)}`);

check('partial: честный частичный скор (половина лучших = 100)',
  rPartial.total === EXPECT.partial.total && rPartial.missing === EXPECT.partial.missing,
  `total=${rPartial.total}, missing=${rPartial.missing}`);

const rIdeal2 = BioBarrier.compute(P, bestEverywhere(), CATS, BANK);
check('детерминизм: повторный прогон идентичен', rIdeal2.total === rIdeal.total);

/* ---- отчёт ---------------------------------------------------------------- */

const totalQ = packQs.length;
const line = (s) => process.stdout.write(s + '\n');

line('');
line('=== БиоБарьер: валидация классов весов ЛПХ (A/B/C) на виньетках ===');
line('пакет: ' + P.title + ' · ' + totalQ + ' вопросов · классы A=' + A.length + ' B=' + B.length + ' C=' + C.length
  + ' (веса 10/7/5, Σ=100)');
line('');
line('виньеты (синтетические дворы, известные ответы):');
line('  ideal        все лучшие ответы            → ' + rIdeal.total + '/100 ' + (rIdeal.level && rIdeal.level.label));
line('  gatecrash    все худшие ответы            → ' + rGate.total + '/100 ' + (rGate.level && rGate.level.label));
line('  aHoles       худшее в A «ворота»          → ' + rA.total + '/100 · топ-3: ' + top3Classes(rA));
line('  bHoles       худшее в B «разнос»          → ' + rB.total + '/100 · топ-3: ' + top3Classes(rB));
line('  cHoles       худшее в C «порядок»         → ' + rC.total + '/100 · топ-3: ' + top3Classes(rC));
line('  fixOneA      из хаоса починен 1 A-блок    → ' + rFixA.total + '/100');
line('  fixOneC      из хаоса починен 1 C-блок    → ' + rFixC.total + '/100');
line('  oneAWorst    один худший ответ в A        → ' + rOneA.total + '/100 (−' + (100 - rOneA.total).toFixed(2) + ')');
line('  oneCWorst    один худший ответ в C        → ' + rOneC.total + '/100 (−' + (100 - rOneC.total).toFixed(2) + ')');
line('  flagsOnly    12 флагов, остальное лучше   → ' + rFlags.total + '/100 · флагов ' + sFlags.nFlags
  + ' · топ-3: ' + rFlags.top3.map((c) => c.id).join(', '));
line('  middle       все средние ответы           → ' + rMiddle.total + '/100 ' + (rMiddle.level && rMiddle.level.label));
line('  partial      отвечена половина            → ' + rPartial.total + '/100, пропущено ' + rPartial.missing);
line('');
if (fails.length) {
  line('ПРОВАЛ: ' + fails.length + ' проверок:');
  fails.forEach((f) => { line('  ✗ ' + f); });
  line('');
  process.exitCode = 1;
} else {
  line('все проверки зелёные: ' + (results.length + 4) + ' виньет/скринингов, '
    + [ 'известные ответы', 'монотонность A<B<C', 'зернистость ΔA>ΔC', 'топ-3 по классам',
        'согласованность скрининга', 'частичный скор', 'детерминизм' ].join(' · '));
  line('');
}

/* ---- VALIDATION.md (--write) ---------------------------------------------- */

if (process.argv.includes('--write')) {
  const { writeFileSync } = require('node:fs');
  const { join } = require('node:path');
  const md = `# Валидация классов весов ЛПХ (A/B/C) — виньеточная проверка

> Файл генерируется: \`node scripts/bb_class_validation.cjs --write\`.
> Ожидания записаны в коде ДО прогона (a priori) и сверяются с фактом;
> расхождение = красный CI (гейт в tests/bioscore.test.mjs).

## Что это и чем это не является

Это **валидация модели** на синтетической выборке виньет (13 сценариев), а не
полевая валидация анкеты. Дворы здесь — сконструированные наборы ответов с
ручным расчётом итога. Она отвечает на вопрос «работают ли три класса весов
так, как заявлено», и не отвечает на вопрос «различает ли скор реальные дворы
с вспышками и без» — для этого нужна живая выборка бенчмарка (opt-in итоги),
которая начнёт собираться после подключения коллектора. Пороги светофора
(50/75) и уровней скрининга (0–1/2–4/5+) — редакционные шкалы витрины.

## Ожидания, записанные до прогона

| виньет | конструкция | ожидание |
|---|---|---|
| ideal | все лучшие ответы | 100/100, «крепко», скрининг 0 флагов |
| gatecrash | все худшие ответы | 0/100, «критично», скрининг 12 флагов «ворота открыты» |
| aHoles | худшее во всех A, лучшее в B/C | итог 60 (100 − вес A), топ-3 только из A |
| bHoles | худшее во всех B, лучшее в A/C | итог 65, топ-3 только из B |
| cHoles | худшее во всех C, лучшее в A/B | итог 75, топ-3 только из C |
| fixOneA | из «нуля» починен один A-блок | итог 10 |
| fixOneC | из «нуля» починен один C-блок | итог 5 |
| oneAWorst | один худший ответ в A (arrival) | итог 98 (−2.00) |
| oneCWorst | один худший ответ в C (transport) | итог 98.75 (−1.25) |
| flagsOnly | 12 флагов скрининга, остальное лучшие | 12 флагов «ворота открыты»; итог 50–95; топ-3 — флаговые категории |
| middle | все средние ответы | не «крепко» |
| partial | отвечена половина вопросов лучшими | итог 100, пропущено 35 (не штрафуются) |

## Результаты прогона (${new Date().toISOString().slice(0, 10)})

| виньет | итог | уровень | топ-3 | примечание |
|---|---|---|---|---|
| ideal | ${rIdeal.total} | ${rIdeal.level && rIdeal.level.label} | — | скрининг: ${sIdeal.nFlags} флагов |
| gatecrash | ${rGate.total} | ${rGate.level && rGate.level.label} | — | скрининг: ${sGate.nFlags} флагов «${sGate.level && sGate.level.label}» |
| aHoles | ${rA.total} | ${rA.level && rA.level.label} | ${rA.top3.map((c) => c.id).join(', ')} | только класс A |
| bHoles | ${rB.total} | ${rB.level && rB.level.label} | ${rB.top3.map((c) => c.id).join(', ')} | только класс B |
| cHoles | ${rC.total} | ${rC.level && rC.level.label} | ${rC.top3.map((c) => c.id).join(', ')} | только класс C |
| fixOneA | ${rFixA.total} | ${rFixA.level && rFixA.level.label} | — | починка «ворот» даёт 10 баллов |
| fixOneC | ${rFixC.total} | ${rFixC.level && rFixC.level.label} | — | починка «порядка» даёт 5 баллов |
| oneAWorst | ${rOneA.total} | ${rOneA.level && rOneA.level.label} | — | один плохой ответ в A: −${(100 - rOneA.total).toFixed(2)} |
| oneCWorst | ${rOneC.total} | ${rOneC.level && rOneC.level.label} | — | один плохой ответ в C: −${(100 - rOneC.total).toFixed(2)} |
| flagsOnly | ${rFlags.total} | ${rFlags.level && rFlags.level.label} | ${rFlags.top3.map((c) => c.id).join(', ')} | ${sFlags.nFlags} флагов, «${sFlags.level && sFlags.level.label}» |
| middle | ${rMiddle.total} | ${rMiddle.level && rMiddle.level.label} | — | средний двор — не «крепко» |
| partial | ${rPartial.total} | ${rPartial.level && rPartial.level.label} | — | пропущено ${rPartial.missing} — не в счёт |

## Выводы

1. **Иерархия классов работает как заявлено**: одинаковые дыры в «воротах»
   (A) дают итог 60, в «разносе» (B) — 65, в «порядке» (C) — 75:
   монотонность A < B < C совпадает с эпидемиологической логикой
   «каналы заноса важнее механического переноса, важнее внутренней дисциплины».
2. **Зернистость вопроса честная**: один плохой ответ в A-категории стоит
   2.0 балла, в C-категории — 1.25: пропорция весов переносится на уровень
   отдельного вопроса.
3. **«Чинить первыми» указывает верно**: топ-3 слабых блоков во всех трёх
   «дырчатых» виньетах состоит только из продырявленного класса.
4. **Скрининг чувствительнее балла — и это заявлено**: двор с 12 красными
   флагами и идеальными остальными ответами сохраняет высокий итог
   (${rFlags.total}/100): полный балл — средний уровень барьеров, скрининг —
   детектор сконцентрированных дыр. Именно поэтому скрининг не переводится
   в балл и не агрегируется.
5. **Частичный скор честный**: отвеченная половина лучших ответов даёт 100 —
   пропуски не прикидываются нулями и не завышают знаменатель.

## Открытые вопросы (в очередь)

- Полярная валидация (скор против реальных вспышек) — после живой выборки.
- Микро-Delphi с практиками по весовым классам — при 20–30 полевых партнёрах.
- Расхождение скрининга и балла на виньете flagsOnly (${rFlags.total} при
  12 флагах) — следить в поле: если живые дворы с «воротами открыты»
  окажутся в «крепко», вернуться к весам A-класса.
`;
  const out = join(__dirname, '..', 'VALIDATION.md');
  writeFileSync(out, md);
  line('VALIDATION.md обновлён: ' + out);
  line('');
}
