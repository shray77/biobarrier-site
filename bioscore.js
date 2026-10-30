/*!
 * bioscore.js — математическое ядро витрины «БиоБарьер» (biobarrier-site).
 *
 * Скоринг биобезопасности хозяйства: анкета → 0–100.
 *
 * Один и тот же файл питает онлайн-анкету и тесты
 * (tests/bioscore.test.mjs): известные ответы гейтят математику.
 *
 * Методика (реконструкция подхода Biocheck.UGent, Гентский ун-т):
 *  - каждый вопрос имеет градуированные варианты ответа, 0–100;
 *  - категория = среднее отвеченных вопросов (пропущенные исключаются
 *    из числителя и знаменателя — честный частичный скор);
 *  - итог = взвешенное среднее категорий, веса заданы профилем пакета
 *    (птица/свиньи/КРС/мелкое хозяйство), Σ весов = 100 (гейтится);
 *  - внешний/внутренний блоки — агрегаты своих категорий с ренормировкой
 *    весов по отвеченным;
 *  - бенчмарки — только зарубежные публикации Biocheck.UGent, честно
 *    помечены; для пакета «мелкое хозяйство» бенчмарка в мире нет.
 *
 * UMD: браузер — globalThis.BioBarrier, тесты — export default.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.BioBarrier = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* Двойной язык: q[0] — «владелец», q[1] — «профессионал». */
  var MODE_OWNER = 0, MODE_PRO = 1;

  function text(pairOrString, mode) {
    if (Object.prototype.toString.call(pairOrString) === "[object Array]") {
      return pairOrString[Math.abs(mode) % 2 === 1 ? 1 : 0];
    }
    return pairOrString;
  }

  function questionCount(pack) {
    var n = 0;
    pack.cats.forEach(function (c) { n += c.qs.length; });
    return n;
  }

  function categoryCount(pack) {
    return pack.cats.length;
  }

  /* Скор одной категории по отвеченным вопросам.
   * answers: { qid: индекс варианта }. Пропущенные вопросы исключаются
   * из обеих сторон среднего. Возвращает null, если не отвечено ничего. */
  function categoryScore(cat, answers, bank) {
    var sum = 0, n = 0;
    cat.qs.forEach(function (qid) {
      var q = bank[qid];
      if (!q) { throw new Error("вопрос не найден в банке: " + qid); }
      var idx = answers[qid];
      if (idx === undefined || idx === null) { return; }
      var opt = q.opts[idx];
      if (!opt) { return; }
      sum += opt.s;
      n += 1;
    });
    return n === 0 ? null : sum / n;
  }

  /* Главный расчёт. Возвращает структуру для рендера и золотых тестов. */
  function compute(pack, answers, cats, bank) {
    var answeredCats = [];
    var missing = 0, totalQ = 0;

    pack.cats.forEach(function (c) {
      var sc = categoryScore(c, answers, bank);
      var answeredQ = c.qs.filter(function (qid) {
        return answers[qid] !== undefined && answers[qid] !== null;
      }).length;
      totalQ += c.qs.length;
      missing += c.qs.length - answeredQ;
      if (sc !== null) {
        answeredCats.push({ id: c.id, w: c.w, score: sc, answered: answeredQ, total: c.qs.length });
      }
    });

    var wsum = answeredCats.reduce(function (a, c) { return a + c.w; }, 0);
    var total = wsum === 0 ? null : answeredCats.reduce(function (a, c) {
      return a + c.w * c.score;
    }, 0) / wsum;

    function groupScore(g) {
      var gs = answeredCats.filter(function (c) { return (cats[c.id] || {}).g === g; });
      var gw = gs.reduce(function (a, c) { return a + c.w; }, 0);
      return gw === 0 ? null : gs.reduce(function (a, c) { return a + c.w * c.score; }, 0) / gw;
    }

    var ext = groupScore("ext");
    var int = groupScore("int");

    /* Топ-3 слабых: отвеченные категории по возрастанию скора;
     * при равенстве — больший вес важнее (чинить сначала весомое). */
    var top = answeredCats.slice().sort(function (a, b) {
      if (a.score !== b.score) { return a.score - b.score; }
      return b.w - a.w;
    }).slice(0, 3).map(function (c) {
      return { id: c.id, score: c.score, w: c.w, advice: (cats[c.id] || {}).advice || "" };
    });

    /* Бенчмарк-дельты: наш скор минус зарубежный (только где он есть). */
    var bench = null;
    if (pack.bench) {
      bench = { label: pack.bench.label, src: pack.bench.src, d: {} };
      [["ext", ext], ["int", int], ["total", total]].forEach(function (pair) {
        var k = pair[0], v = pair[1];
        if (pack.bench[k] !== null && pack.bench[k] !== undefined && v !== null) {
          bench.d[k] = +(v - pack.bench[k]).toFixed(1);
        }
      });
    }

    return {
      pack: pack.id,
      total: total === null ? null : +total.toFixed(1),
      ext: ext === null ? null : +ext.toFixed(1),
      int: int === null ? null : +int.toFixed(1),
      cats: answeredCats.map(function (c) {
        return { id: c.id, score: +c.score.toFixed(1), w: c.w, answered: c.answered, total: c.total };
      }),
      top3: top,
      missing: missing,
      totalQuestions: totalQ,
      bench: bench,
      level: total === null ? null : level(total)
    };
  }

  /* Светофор уровней. Пороги — редакционная шкала витрины (не из
   * публикаций): <50 критично, 50–74 есть дыры, ≥75 крепко. */
  var LEVELS = [
    { min: 75, code: "good", label: "крепко", why: "барьеры в основном стоят; следите за слабыми блоками ниже" },
    { min: 50, code: "mid", label: "есть дыры", why: "половина барьеров работает; топ-3 слабых блоков — план работ" },
    { min: 0, code: "bad", label: "критично", why: "барьеров пока мало — топ-3 ниже это самые дешёвые первые шаги" }
  ];

  function level(score) {
    for (var i = 0; i < LEVELS.length; i += 1) {
      if (score >= LEVELS[i].min) { return LEVELS[i]; }
    }
    return LEVELS[LEVELS.length - 1];
  }

  /* Копируемый отчёт: короткий текст без HTML, для заметки/мессенджера. */
  function reportText(pack, res, cats, mode) {
    var m = Math.abs(mode || 0) % 2;
    var lines = [];
    lines.push("БиоБарьер — " + pack.title + " (" + pack.sub + ")");
    var t = res.total === null ? "—" : String(res.total);
    lines.push("Итог: " + t + "/100" + (res.level ? " · " + res.level.label : ""));
    if (res.ext !== null) { lines.push("Внешний (занос): " + res.ext); }
    if (res.int !== null) { lines.push("Внутренний (внутри): " + res.int); }
    if (res.missing > 0) { lines.push("Не отвечено: " + res.missing + " из " + res.totalQuestions + " — не учтены"); }
    if (res.top3.length) {
      lines.push("Чинить первыми:");
      res.top3.forEach(function (c, i) {
        lines.push("  " + (i + 1) + ". " + text((cats[c.id] || { t: [c.id, c.id] }).t, m) + " — " + c.score);
      });
    }
    if (res.bench && res.bench.d && res.bench.d.total !== undefined) {
      lines.push("Зарубежный бенчмарк: " + res.bench.label + " → дельта " + (res.bench.d.total >= 0 ? "+" : "") + res.bench.d.total);
    }
    lines.push("Самооценка, не аудит · https://shray77.github.io/biobarrier-site/");
    return lines.join("\n");
  }

  return {
    MODE_OWNER: MODE_OWNER, MODE_PRO: MODE_PRO,
    text: text, level: level, LEVELS: LEVELS,
    questionCount: questionCount, categoryCount: categoryCount,
    categoryScore: categoryScore, compute: compute, reportText: reportText
  };
});
