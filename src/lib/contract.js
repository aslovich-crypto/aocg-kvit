// СГЕНЕРИРОВАНО tools/gen_dictionaries.py — РУКАМИ НЕ ПРАВИТЬ.
// Источник: КОД БЭКЕНДА — Literal StatusIn (reports.py) и SOURCES
// (receipts.py). Не JSON: второй источник того же смысла заводить
// нельзя, копия обязана порождаться из того, по чему сервер решает.
// ШТАМП-ИСТОЧНИКА sha256: 39cdd85addf90e84ce307d844f02082c9bcad6c54e1d76ab99e2aef687e3ca04
// Правка руками будет потеряна при следующей генерации и КРАСНЕЕТ
// у сторожа scripts/check-contract.mjs.

// Статусы отчёта. ⚠️ В базе они лежат РУССКИМИ СЛОВАМИ, поэтому
// переименование — миграция данных, а не правка словаря.
export const REPORT_STATUSES = [
  "Черновик",
  "На проверке",
  "Одобрен",
  "Отклонён",
];

// Каналы, которыми чек попадает в систему.
export const RECEIPT_SOURCES = ["manual", "qr_scan", "photo_ocr", "fns"];

export const DEFAULT_RECEIPT_SOURCE = "manual";
