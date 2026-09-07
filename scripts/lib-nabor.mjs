// Общий разбор порождённых наборов — ОДНО МЕСТО НА ДВУХ СТОРОЖЕЙ.
//
// ⚠️ ПОЧЕМУ ОБЩИЙ ФАЙЛ, ЕСЛИ СТОРОЖА ДВА. Владелец просил два сторожа,
// чтобы наборы ругались НЕЗАВИСИМО: беда в режимах организации не должна
// гасить беду в кодах чека. Независимость — про ВЕРДИКТ, а не про буквы
// разбора. Скопировать разбор в оба файла значило бы завести третью копию
// в заходе, который копии сводит.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

// Порождённый набор: значения, штамп из шапки и пересчитанный штамп.
// Пересчёт идёт по тому же виду, что в генераторе: json.dumps(набор,
// ensure_ascii=False, separators=(",", ":")) — компактный JSON без пробелов,
// его же даёт JSON.stringify.
export function прочитатьНабор(путь, имя) {
  let текст;
  try {
    текст = readFileSync(путь, "utf8");
  } catch {
    return { беда: `нет ${path.basename(путь)} — копия не сгенерирована` };
  }
  const м = текст.match(new RegExp(`export const ${имя} = \\[(.*?)\\];`, "s"));
  const штамп = (текст.match(/ШТАМП-ИСТОЧНИКА sha256: ([0-9a-f]{64})/) ||
    [])[1];
  if (!м || !штамп)
    return { беда: `копия не разбирается: нет ${имя} или штампа` };
  const набор = [...м[1].matchAll(/"([^"]*)"/g)].map((x) => x[1]);
  const посчитан = createHash("sha256")
    .update(JSON.stringify(набор), "utf8")
    .digest("hex");
  return { набор, штамп, посчитан };
}

// Ключи объектного литерала `const ИМЯ = { ключ: … }` в тексте файла.
export function ключиКарты(текст, имя) {
  const м = текст.match(new RegExp(`${имя} = \\{(.*?)\\n\\};`, "s"));
  if (!м) return null;
  return [...м[1].matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/gm)].map(
    (x) => x[1],
  );
}

// Все .js/.jsx под src/, кроме перечисленных.
export function исходники(корень, кроме = []) {
  const мимо = кроме.map((п) => path.resolve(корень, п));
  const собрано = [];
  (function обойти(каталог) {
    for (const имя of readdirSync(каталог)) {
      const п = path.join(каталог, имя);
      if (statSync(п).isDirectory()) обойти(п);
      else if (/\.jsx?$/.test(имя) && !мимо.includes(п))
        собрано.push([path.relative(корень, п), readFileSync(п, "utf8")]);
    }
  })(path.join(корень, "src"));
  return собрано;
}

// Сверка «подписи ↔ набор» в обе стороны. Возвращает список бед.
export function сверитьКлючи(имя, ключи, набор) {
  const беды = [];
  const лишние = ключи.filter((к) => !набор.includes(к));
  const забытые = набор.filter((к) => !ключи.includes(к));
  if (лишние.length)
    беды.push(`${имя}: экран знает лишнее — ${лишние.join(", ")}`);
  if (забытые.length)
    беды.push(`${имя}: экран не знает — ${забытые.join(", ")}`);
  return беды;
}
