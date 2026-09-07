// СГЕНЕРИРОВАНО tools/gen_dictionaries.py — РУКАМИ НЕ ПРАВИТЬ.
// Источник: КОД БЭКЕНДА — _TAXATION_TYPES (app/parsers/fns_parser.py).
// Коды СНО ПРОДАВЦА из чека: тег 1055 ФФД, маска, младший бит побеждает.
// Порядок — по значению бита, он и есть порядок ФНС.
// ⚠️ ЭТО НЕ РЕЖИМЫ ОРГАНИЗАЦИИ. Те в tax_systems.js, их шесть.
// `envd` живёт только здесь: ЕНВД отменён с 2021 года, но печатается
// в чеках прошлых лет, и разбор обязан их понимать.
// Подписи — решение экрана (ReceiptDetailModal), сверяет их сторож
// check-fns-tax-codes.mjs.
// ШТАМП-ИСТОЧНИКА sha256: 3d0f7068375f92d156df968bc89ed60738451931e83c27e8a5837cb55eae7827

export const FNS_TAX_CODES = [
  "osno",
  "usn_income",
  "usn_income_minus_expense",
  "envd",
  "eshn",
  "psn",
  "npd",
];
