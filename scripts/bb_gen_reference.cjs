#!/usr/bin/env node
/*! bb_gen_reference.cjs — регенерация ЗОЛОТА тоталов (tests/bioscore.reference.json).
 *
 * Золото — замороженные тоталы каждого пакета по трём детерминированным
 * паттернам ответов: best (везде первый, лучший вариант), worst (везде
 * последний, худший), seeded (детерминированный разнобой (i*7+3)%n).
 *
 * Порядок вариантов (v0.3): от лучшего к худшему, s убывает, первый = 100.
 *
 * Запуск из корня репо: node scripts/bb_gen_reference.cjs
 * После любого изменения банка/весов — перегенерировать и коммитить вместе:
 * дрейф тоталов обязан быть осознанным, а не случайным.
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
const { writeFileSync } = require('node:fs');
const { join, dirname } = require('node:path');

const BANK = global.BBQ, CATS = global.BBCATS, PACKS = global.BBPACKS;

function patternAnswers(p, pattern) {
  const answers = {};
  let i = 0;
  for (const c of p.cats) {
    for (const qid of c.qs) {
      const n = BANK[qid].opts.length;
      if (pattern === 'best') { answers[qid] = 0; }
      else if (pattern === 'worst') { answers[qid] = n - 1; }
      else { answers[qid] = (i * 7 + 3) % n; }
      i += 1;
    }
  }
  return answers;
}

const ref = {};
for (const [id, p] of Object.entries(PACKS)) {
  ref[id] = {};
  for (const pattern of ['best', 'worst', 'seeded']) {
    const r = BioBarrier.compute(p, patternAnswers(p, pattern), CATS, BANK);
    ref[id][pattern] = { total: r.total, ext: r.ext, int: r.int };
  }
}

const out = join(__dirname, '..', 'tests', 'bioscore.reference.json');
writeFileSync(out, JSON.stringify(ref, null, 2) + '\n');
console.log('золото перегенерировано: ' + out);
for (const [id, v] of Object.entries(ref)) {
  console.log('  ' + id + ': best=' + v.best.total + ' worst=' + v.worst.total + ' seeded=' + v.seeded.total);
}
