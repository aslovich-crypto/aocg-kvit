#!/usr/bin/env node
// ⚠️ СТОРОЖ №2 ИЗ ДВУХ: КОДЫ СНО ИЗ ЧЕКА (T39, заход 2).
//
// ЗАЧЕМ. Тег 1055 ФФД — маска систем налогообложения ПРОДАВЦА, её разбирает
// `_TAXATION_TYPES` (app/parsers/fns_parser.py) и кладёт в колонку
// `receipts.tax_system`. Карточка чека показывает это русскими словами
// (TAX_LABELS_RECEIPT в ReceiptDetailModal.jsx). Разойдутся — код из чека
// покажется пустым местом, и это увидит бухгалтер, а не прибор.
//
// ⚠️ ЭТО ДРУГОЙ НАБОР, ЧЕМ РЕЖИМЫ ОРГАНИЗАЦИИ, И СТОРОЖ ПОЭТОМУ ОТДЕЛЬНЫЙ.
// Четыре кода общие (osno, eshn, psn, npd) — на них сведённая проверка
// приняла бы один набор за другой. Разводит их `envd`: ЕНВД отменён с 2021
// года, организации он недоступен, а в чеках прошлых лет печатается.
//
// ЧТО ПРОВЕРЯЕТСЯ:
//   ① копия src/lib/fns_tax_codes.js на месте, разбирается, несёт штамп;
//   ② штамп сходится с содержимым;
//   ③ подписи TAX_LABELS_RECEIPT покрывают набор ТОЧНО — забытый код
//      показался бы в карточке пустой строкой;
//   ④ второй карты кодов чека во фронте нет.
//
// ⚠️ ГРАНИЦА. Третья копия этого набора живёт НА БЭКЕНДЕ — в тексте промпта
// распознавания (app/routers/ocr.py:57), и там кодов ШЕСТЬ: `envd` нет.
// Расхождение намеренное (нейросети незачем предлагать отменённый режим),
// но сторож на фронте про python не знает и знать не может. Сверять промпт
// с разбором — работа для python-половины, не для этой.
//
// ЗАПУСК: node scripts/check-fns-tax-codes.mjs (входит в npm run lint).
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ключиКарты,
  исходники,
  прочитатьНабор,
  сверитьКлючи,
} from "./lib-nabor.mjs";

const КОРЕНЬ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const КОПИЯ = path.join(КОРЕНЬ, "src/lib/fns_tax_codes.js");
const ПОДПИСИ = path.join(КОРЕНЬ, "src/components/ReceiptDetailModal.jsx");
const ЧУЖАЯ = path.join(КОРЕНЬ, "src/lib/tax_systems.js");
const ПОЧИНКА =
  "\n  Починка: правится ИСТОЧНИК на бэке (_TAXATION_TYPES в fns_parser.py),\n" +
  "  затем ./venv/bin/python tools/gen_dictionaries.py — копия порождается.\n";

const беды = [];
console.log("\nКОДЫ СНО ИЗ ЧЕКА (тег 1055 ФФД: бэк ↔ карточка)");

const { набор, штамп, посчитан, беда } = прочитатьНабор(КОПИЯ, "FNS_TAX_CODES");
if (беда) {
  console.log(`  ✗ ${беда}`);
  console.log(ПОЧИНКА);
  process.exit(1);
}
console.log(`  копия: ${набор.length} кодов · штамп ${штамп.slice(0, 12)}…`);

if (посчитан === штамп) {
  console.log("  ✓ штамп сходится с содержимым копии");
} else {
  беды.push("штамп копии не отвечает её содержимому — правили руками");
  console.log(
    `  ✗ ШТАМП НЕ СХОДИТСЯ: в файле ${штамп.slice(0, 12)}…, ` +
      `посчитан ${посчитан.slice(0, 12)}…`,
  );
}

const текстПодписей = readFileSync(ПОДПИСИ, "utf8");
const ключи = ключиКарты(текстПодписей, "TAX_LABELS_RECEIPT");
if (!ключи) {
  беды.push("в ReceiptDetailModal.jsx нет карты TAX_LABELS_RECEIPT");
  console.log("  ✗ карта подписей TAX_LABELS_RECEIPT не найдена");
} else {
  const свои = сверитьКлючи("подписи", ключи, набор);
  беды.push(...свои);
  if (свои.length) свои.forEach((б) => console.log(`  ✗ ${б}`));
  else console.log(`  ✓ подписи покрывают набор точно (${ключи.length})`);
}

const чужой = прочитатьНабор(ЧУЖАЯ, "TAX_SYSTEMS").набор || [];
const различающие = набор.filter((к) => !чужой.includes(к));
const вторые = исходники(КОРЕНЬ, [
  "src/components/ReceiptDetailModal.jsx",
  "src/lib/fns_tax_codes.js",
]).filter(
  ([, т]) =>
    различающие.filter((к) => new RegExp(`^\\s*${к}\\s*:`, "m").test(т))
      .length >= 2,
);
if (вторые.length === 0) {
  console.log(
    `  ✓ второй карты кодов нет (различали по ${различающие.join(", ")})`,
  );
} else {
  for (const [п] of вторые) {
    беды.push(`вторая карта кодов чека в ${п} — подписи живут в карточке`);
    console.log(`  ✗ вторая карта кодов чека: ${п}`);
  }
}

if (беды.length) {
  console.log(`\n  ⚠️ РАСХОЖДЕНИЙ ${беды.length}`);
  беды.forEach((б) => console.log(`     · ${б}`));
  console.log(ПОЧИНКА);
  process.exit(1);
}
console.log("\n  ✓ коды СНО чека совпадают по обе стороны\n");
process.exit(0);
