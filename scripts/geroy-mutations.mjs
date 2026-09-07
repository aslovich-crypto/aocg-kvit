// ⚠️ МУТАЦИИ СТОРОЖА ЗАГОЛОВКА (правило T11: непроверенный сторож — неработающий).
// СВОД: ПОСТАВЛЕНО · ПОЙМАНО · НЕ ПОСТАВЛЕНО (правило T77).
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const КОРЕНЬ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ФАЙЛ = path.join(КОРЕНЬ, "src/components/ReceiptDetailModal.jsx");

const МУТАНТЫ = [
  {
    имя: "М1 перенос снят — вернулась одна строка с многоточием",
    было: "                      WebkitLineClamp: 2,\n",
    стало: '                      whiteSpace: "nowrap",\n',
    ждём: /③ заголовок не обрезан: ОБРЕЗАН/,
    почему: "это ровно состояние до правки — прибор обязан его помнить",
  },
  {
    имя: "М2 строк стало одна вместо двух",
    было: "WebkitLineClamp: 2,",
    стало: "WebkitLineClamp: 1,",
    ждём: /③ заголовок не обрезан: ОБРЕЗАН/,
    почему: "clamp:1 обрезает по высоте — заголовок снова не дочитать",
  },
  {
    имя: "М3 display:-webkit-box снят — clamp перестаёт работать",
    было: '                      display: "-webkit-box",\n',
    стало: "",
    ждём: /ОГРАНИЧЕНИЕ НЕ РАБОТАЕТ/,
    почему: "ловится шагом ⑪: на имени, которому двух строк мало",
  },
  {
    имя: "М4 подпись под заголовком тоже стала многострочной",
    // ⚠️ ЭТОТ МУТАНТ СТЕРЕЖЁТ РЕШЕНИЕ ВЛАДЕЛЬЦА, А НЕ КОД: две строки
    // получает ТОЛЬКО заголовок. Без него решение держалось бы
    // на аккуратности следующего, кто откроет файл.
    было:
      '                        overflow: "hidden",\n' +
      '                        textOverflow: "ellipsis",\n' +
      '                        whiteSpace: "nowrap",\n' +
      "                      }}\n" +
      "                    >\n" +
      "                      {seller}",
    стало:
      '                        display: "-webkit-box",\n' +
      '                        WebkitBoxOrient: "vertical",\n' +
      "                        WebkitLineClamp: 2,\n" +
      '                        overflow: "hidden",\n' +
      '                        overflowWrap: "anywhere",\n' +
      "                      }}\n" +
      "                    >\n" +
      "                      {seller}",
    ждём: /ПОДПИСЬ РАЗЪЕХАЛАСЬ/,
    почему: "подпись обязана остаться однострочной — решение владельца",
  },
];

const прогнать = () => {
  try {
    return execFileSync(
      "node",
      [path.join(КОРЕНЬ, "scripts/check-geroy.mjs")],
      {
        cwd: КОРЕНЬ,
        encoding: "utf8",
        timeout: 600000,
      },
    );
  } catch (е) {
    return String(е.stdout || "") + String(е.stderr || "");
  }
};

console.log("\nМУТАЦИИ СТОРОЖА ЗАГОЛОВКА");
const исходник = readFileSync(ФАЙЛ, "utf8");
const чисто = прогнать();
if (/РАСХОЖДЕНИЙ/.test(чисто)) {
  console.log("  ⚠️ ОБРАТНЫЙ ХОД НЕ ПРОЙДЕН: сторож красен ДО мутаций");
  process.exit(1);
}
console.log("  обратный ход: на нетронутом коде расхождений нет ✓\n");

let поставлено = 0;
let поймано = 0;
const непоставленные = [];
for (const м of МУТАНТЫ) {
  if (!исходник.includes(м.было)) {
    непоставленные.push(м.имя);
    console.log(`  ✗ НЕ ПОСТАВЛЕН  ${м.имя}: якоря в файле нет`);
    continue;
  }
  writeFileSync(ФАЙЛ, исходник.replace(м.было, м.стало), "utf8");
  поставлено += 1;
  const вывод = прогнать();
  writeFileSync(ФАЙЛ, исходник, "utf8");
  const есть = м.ждём.test(вывод);
  поймано += есть ? 1 : 0;
  console.log(
    `  ${есть ? "✓ поймана" : "✗ ПРОПУЩЕНА"}  ${м.имя} — ${м.почему}`,
  );
}

console.log(
  `\nПОСТАВЛЕНО ${поставлено} · ПОЙМАНО ${поймано} · НЕ ПОСТАВЛЕНО ${непоставленные.length}`,
);
if (readFileSync(ФАЙЛ, "utf8") !== исходник) {
  console.log("  ⚠️ ФАЙЛ НЕ ВОССТАНОВЛЕН — этого быть не должно");
  process.exit(1);
}
console.log("исходный файл не тронут ✓");
process.exit(поймано === поставлено && !непоставленные.length ? 0 : 1);
