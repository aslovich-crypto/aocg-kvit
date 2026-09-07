// ⚠️ СТОРОЖ ЗАГОЛОВКА КАРТОЧКИ ЧЕКА (UX-26).
//
// ЗАЧЕМ. Два макета расходились в одном правиле: основной даёт заголовку
// ОДНУ строку с многоточием, краевой (`compare/Длинное название - деталь
// чека.html`) — ДВЕ (`-webkit-line-clamp:2` + `overflow-wrap:anywhere`).
// Код следовал основному, и на снимке владельца 06.09.2026 заголовок был
// обрезан: «ООО «Виза менеджмент сер…»».
//
// ⚠️ ЗАМЕР ГЕОМЕТРИЕЙ, А НЕ ТЕКСТОМ (T169): `textContent` содержит полное
// название и тогда, когда оно визуально обрезано. Проба по тексту была бы
// ЗЕЛЁНОЙ на обрезанном экране — худший вид поломки прибора.
//
// ⚠️ ШИРИНА 320, САМАЯ УЗКАЯ ИЗ РЕАЛЬНЫХ. Прогон идёт по экрану «Чеки»
// и открывает карточку — там, где человек читает название (T165).
//
// РЕШЕНИЕ ВЛАДЕЛЬЦА 07.09.2026, шаг ⑦ стережёт именно его: две строки
// получает ТОЛЬКО заголовок, подпись под ним остаётся однострочной.
//
// ЗАПУСК: npm run geroy (нужен Chrome; без него — «ПРОВЕРКА НЕ ВЫПОЛНЕНА»).
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const КОРЕНЬ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ПРОБА = path.join(КОРЕНЬ, "scripts/probe-geroy");
const ПОРТ = 5900 + Math.floor(Math.random() * 200);

const БРАУЗЕРЫ = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
];

const ОЖИДАЕМО = [
  ["① экран чеков", "оба чека в списке"],
  ["② карточка длинного юрлица открыта", "карточка открыта"],
  ["③ заголовок не обрезан", "виден целиком в 2 стр"],
  ["④ заголовок не длиннее двух строк", "строк 2"],
  ["⑤ карточка закрыта", "список"],
  ["⑥ карточка с брендом открыта", "карточка открыта"],
  ["⑦ подпись под заголовком однострочна", "строк 1"],
  ["⑧ карточка длинного СЛОВА закрыта и открыта", "карточка открыта"],
  ["⑨ длинное слово рвётся, а не уезжает", "рвётся, строк 2"],
  ["⑩ карточка очень длинного имени", "карточка открыта"],
  [
    "⑪ очень длинное имя ограничено двумя строками",
    "строк 2, остальное многоточием",
  ],
];

const беды = [];
console.log(
  "\nЗАГОЛОВОК КАРТОЧКИ ЧЕКА при 320: две строки, не многоточие (UX-26)",
);

const браузер = БРАУЗЕРЫ.find((п) => existsSync(п));
if (!браузер) {
  console.log("  ✗ ПРОВЕРКА НЕ ВЫПОЛНЕНА: не найден Chrome — смотреть нечем");
  process.exit(1);
}

try {
  execFileSync(
    path.join(КОРЕНЬ, "node_modules/.bin/vite"),
    ["build", "--config", path.join(ПРОБА, "vite.config.mjs")],
    { cwd: КОРЕНЬ, stdio: "pipe", timeout: 180000 },
  );
} catch (е) {
  console.log("  ✗ ПРОВЕРКА НЕ ВЫПОЛНЕНА: проба не собралась");
  String(е.stdout || е.message)
    .split("\n")
    .slice(-6)
    .forEach((с) => console.log("      " + с));
  process.exit(1);
}

const сервер = spawn(
  path.join(КОРЕНЬ, "node_modules/.bin/vite"),
  [
    "preview",
    "--config",
    path.join(ПРОБА, "vite.config.mjs"),
    "--port",
    String(ПОРТ),
    "--strictPort",
  ],
  { cwd: КОРЕНЬ, stdio: "ignore" },
);

const снятьРазом = () =>
  new Promise((готово, споткнулись) => {
    const дитя = spawn(
      браузер,
      [
        "--headless",
        "--disable-gpu",
        "--virtual-time-budget=25000",
        "--window-size=320,1400",
        "--dump-dom",
        `http://localhost:${ПОРТ}/`,
      ],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    let вывод = "";
    const часы = setTimeout(() => {
      дитя.kill("SIGKILL");
      споткнулись(new Error("браузер не ответил за 120 с"));
    }, 120000);
    дитя.stdout.on("data", (к) => (вывод += к));
    дитя.on("error", (е) => {
      clearTimeout(часы);
      споткнулись(е);
    });
    дитя.on("close", () => {
      clearTimeout(часы);
      готово(вывод);
    });
  });

const разобрать = (dom) => {
  const м = dom.match(/<div id="ЗАМЕР">([\s\S]*?)<\/div>/);
  if (!м || !м[1].trim()) return null;
  try {
    return JSON.parse(
      м[1]
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">"),
    );
  } catch {
    return null;
  }
};

try {
  let поднялся = false;
  for (let i = 0; i < 60 && !поднялся; i++) {
    await new Promise((г) => setTimeout(г, 250));
    try {
      поднялся = (await fetch(`http://localhost:${ПОРТ}/`)).ok;
    } catch {
      /* ещё не поднялся */
    }
  }
  if (!поднялся) throw new Error("сервер пробы не поднялся за 15 с");

  let замер = null;
  // Переснимаем только НЕСОСТОЯВШЕЕСЯ измерение; расхождение шага — результат.
  for (let п = 0; п < 3 && !замер; п++) {
    const р = разобрать(await снятьРазом());
    if (Array.isArray(р)) замер = р;
  }
  if (!замер) {
    console.log("  ✗ ПРОВЕРКА НЕ ВЫПОЛНЕНА: замер не снялся за 3 попытки");
    сервер.kill("SIGKILL");
    process.exit(1);
  }
  ОЖИДАЕМО.forEach(([имя, ждём], i) => {
    const было = String(замер[i] ?? "")
      .split(": ")
      .slice(1)
      .join(": ");
    const ок = было === ждём;
    console.log(
      `  ${ок ? "✓" : "✗"} ${имя}: ${было || "НЕТ"}${
        ок ? "" : `  ← ждали «${ждём}»`
      }`,
    );
    if (!ок) беды.push(`${имя}: «${было || "НЕТ"}» вместо «${ждём}»`);
  });
} catch (е) {
  console.log(`  ✗ ПРОВЕРКА НЕ ВЫПОЛНЕНА: ${String(е.message).slice(0, 200)}`);
  сервер.kill("SIGKILL");
  process.exit(1);
} finally {
  сервер.kill("SIGKILL");
}

if (беды.length) {
  console.log(`\n  ⚠️ РАСХОЖДЕНИЙ ${беды.length}`);
  беды.forEach((б) => console.log(`     · ${б}`));
  process.exit(1);
}
console.log(
  "\n  ✓ длинное юрлицо читается целиком в две строки при 320,\n" +
    "    подпись под заголовком осталась однострочной\n",
);
process.exit(0);
