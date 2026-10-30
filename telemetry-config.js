/*!
 * telemetry-config.js — БиоБарьер: адреса коллектора бенчмарка России.
 *
 * Пока оба адреса пусты — витрина полностью офлайн: карточки «отправить
 * анонимный итог» нет, секция «Бенчмарк России» показывает только личную
 * динамику (она хранится в браузере и никуда не уходит).
 *
 * Как включить сбор — пошагово за ~5 минут: BENCHMARK.md в корне репо.
 * Коротко: Google-таблица + Apps Script из scripts/collector.gs →
 * «Развернуть как веб-приложение» → скопировать URL /exec сюда:
 *
 *   window.BB_TELEMETRY = {
 *     submitUrl: "https://script.google.com/macros/s/…/exec",
 *     statsUrl:  "https://script.google.com/macros/s/…/exec"
 *   };
 *
 * Один и тот же URL: POST уходит в таблицу, GET возвращает агрегаты.
 * Любой совместимый эндпоинт подойдёт — контракт описан в BENCHMARK.md.
 */
(function (g) {
  "use strict";
  g.BB_TELEMETRY = {
    submitUrl: "",
    statsUrl: ""
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
