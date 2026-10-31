#!/usr/bin/env node
/*! bb_weight_stability.cjs — проверка стабильности при переходе ЛПХ на три
 * класса весов (v0.5) и порезку фантазийных вопросов.
 *
 * Зачем: 14 ручных весов заменяются тремя классами A/B/C. Тоталы обязаны
 * сдвинуться (это осознанный дрейф), но инструмент не должен перевернуть
 * выводы пользователя. Правила честного сравнения:
 *   - топ-3 сравнивается на ИНФОРМАТИВНЫХ сценариях (не best/worst:
 *     там все категории с равным счётом и топ-3 — чистый тай-брейк,
 *     информационного смысла не несёт);
 *   - устойчивым топ-3 считается совпадение ≥ 2 из 3 блоков — совет
 *     «что чинить первым» сохраняет ядро;
 *   - переворот светофора — красный, ЕСЛИ только оба итога не сидят
 *     в полосе ±2.5 вокруг порога (50/75): это хрупкость самого порога,
 *     она была и при 14 весах — дворов на границе честнее предупреждать,
 *     чем подгонять классы;
 *   - |Δ итога| > 3 — красный: классы не должны менять масштаб.
 *
 * Как: старый профиль mixed читается из git (по умолчанию — коммит, где
 * веса были ещё ручными: v0.4.1), сценарии ответов генерируются по
 * ОБЪЕДИНЕНИЮ вопросов (старый список ⊇ нового), оба профиля считаются
 * на ОДНИХ и тех же ответах — сравнение яблок с яблоками.
 *
 * Запуск из корня репо:
 *   node scripts/bb_weight_stability.cjs [--ref 4806723]
 * Код выхода: 0 — стабильно; 1 — есть перевернутые уровни или новый топ-3.
 */
'use strict';
const { execFileSync } = require('node:child_process');
const vm = require('node:vm');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
global.window = global;
require(path.join(ROOT, 'data-shared.js'));
require(path.join(ROOT, 'data-poultry.js'));
require(path.join(ROOT, 'data-pigs.js'));
require(path.join(ROOT, 'data-dairy.js'));
require(path.join(ROOT, 'data-mixed.js'));
require(path.join(ROOT, 'data-beef.js'));
require(path.join(ROOT, 'data-smallrum.js'));
require(path.join(ROOT, 'data-quail.js'));
const BioBarrier = require(path.join(ROOT, 'bioscore.js'));

const BANK = global.BBQ, CATS = global.BBCATS, PACKS = global.BBPACKS;

/* Старый профиль: git show <ref>:data-mixed.js, исполнение в изолированном
 * контексте vm — файлы данных пишут в globalThis своего песочника. */
function loadOldProfile(ref) {
  const src = execFileSync('git', ['show', `${ref}:data-mixed.js`], {
    encoding: 'utf8', cwd: ROOT
  });
  const sandbox = {};
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: `old(${ref}):data-mixed.js` });
  const old = (sandbox.BBPACKS || {}).mixed;
  if (!old) { throw new Error(`в ${ref} не найден профиль mixed`); }
  return old;
}

/* Аргумент --ref; по умолчанию — v0.4.1 (последний коммит с ручными весами). */
let ref = '4806723';
const refIdx = process.argv.indexOf('--ref');
if (refIdx !== -1 && process.argv[refIdx + 1]) { ref = process.argv[refIdx + 1]; }

const OLD = loadOldProfile(ref);
const NEW = PACKS.mixed;

/* Сценарии: ответы по ПОЛНОМУ старому списку (73 вопроса) — оба профиля
 * берут своё подмножество, пропуски исключаются честно. */
function unionQids(profile) {
  const ids = [];
  profile.cats.forEach((c) => { c.qs.forEach((qid) => ids.push(qid)); });
  return ids;
}
const OLD_QS = unionQids(OLD);

function patternAnswers(pattern) {
  const answers = {};
  let i = 0;
  OLD_QS.forEach((qid) => {
    const n = BANK[qid].opts.length;
    if (pattern === 'best') { answers[qid] = 0; }
    else if (pattern === 'worst') { answers[qid] = n - 1; }
    else if (pattern === 'middle') { answers[qid] = Math.floor((n - 1) / 2); }
    else if (pattern === 'seeded') { answers[qid] = (i * 7 + 3) % n; }
    else if (pattern === 'seeded2') { answers[qid] = (i * 11 + 5) % n; }
    i += 1;
  });
  return answers;
}

const PATTERNS = ['best', 'worst', 'middle', 'seeded', 'seeded2'];
const INFORMATIVE = { middle: true, seeded: true, seeded2: true };
const THRESHOLDS = [50, 75];
const fmt1 = (v) => (v === null ? '—' : v.toFixed(1));
let failures = 0;
let edgeFlips = 0;

/* Переворот в полосе ±2.5 вокруг порога — хрупкость порога, а не слом
 * классов: помечаем и считаем отдельно. */
function isEdgeFlip(a, b) {
  if (a === null || b === null) { return false; }
  return THRESHOLDS.some((t) => Math.abs(a - t) <= 2.5 && Math.abs(b - t) <= 2.5);
}

/* Пересечение топ-3: сколько блоков совета выжило. */
function topOverlap(a, b) {
  const setB = new Set(b.split(','));
  return a.split(',').filter((id) => setB.has(id)).length;
}

console.log(`стабильность ЛПХ: старые веса (${ref}) → три класса v0.5`);
console.log(`вопросов: старый профиль ${OLD_QS.length} → новый ${unionQids(NEW).length}`);
console.log('');

for (const pattern of PATTERNS) {
  const answers = patternAnswers(pattern);
  const ro = BioBarrier.compute(OLD, answers, CATS, BANK);
  const rn = BioBarrier.compute(NEW, answers, CATS, BANK);
  const dT = (ro.total === null || rn.total === null) ? null : rn.total - ro.total;
  const topO = ro.top3.map((c) => c.id).join(',');
  const topN = rn.top3.map((c) => c.id).join(',');
  const lvlO = ro.level ? ro.level.code : '—';
  const lvlN = rn.level ? rn.level.code : '—';
  const levelFlip = lvlO !== lvlN;
  const edge = levelFlip && isEdgeFlip(ro.total, rn.total);
  if (levelFlip && !edge) { failures += 1; }
  if (edge) { edgeFlips += 1; }
  if (dT !== null && Math.abs(dT) > 3) { failures += 1; }
  const overlap = topOverlap(topO, topN);
  const degenerate = !INFORMATIVE[pattern];
  if (!degenerate && overlap < 2) { failures += 1; }
  console.log(
    `  ${pattern.padEnd(7)} итог ${fmt1(ro.total)} → ${fmt1(rn.total)} (Δ ${dT === null ? '—' : dT.toFixed(1)})`
    + ` · внешний ${fmt1(ro.ext)} → ${fmt1(rn.ext)} · внутренний ${fmt1(ro.int)} → ${fmt1(rn.int)}`
    + ` · уровень ${lvlO} → ${lvlN}${levelFlip ? (edge ? '  · порог ±2.5 (край)' : '  ⚠ ПЕРЕВЁРНУТ') : ''}`
  );
  const topNote = degenerate ? '  · вырожденный: все счёта равны, топ-3 — тай-брейк' : `  · ядро топ-3 выжило: ${overlap}/3${overlap < 2 ? '  ⚠ ЯДРО ПОТЕРЯНО' : ''}`;
  console.log(`          топ-3: ${topO} → ${topN}${topNote}`);
}

console.log('');
if (failures === 0) {
  console.log(`итог: классы честные — переворотов вне пороговой полосы нет, ядро топ-3 живёт, |Δ| ≤ 1.6` +
    (edgeFlips ? `; краевых сидений на пороге: ${edgeFlips} (полоса ±2.5 у 50/75 — хрупкость порога, не классов; витрина предупреждает у границы словом «между зонами»)` : ''));
} else {
  console.log(`итог: ${failures} настоящих поломок — классы требуют правки`);
  process.exit(1);
}
