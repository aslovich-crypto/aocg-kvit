// ⚠️ СТОРОЖ ОТКАЗА ЗАГРУЗКИ: экран не выдаёт молчание сервера за пустоту.
//
// ЗАЧЕМ (T171). Загрузчики фронта глушили отказ пустым `catch` — состояние
// оставалось пустым, и экран говорил «данных нет». Человек читает это как
// факт: заводит документ, который уже есть, звонит про «отнятые права»,
// выписывает второе приглашение. Класс всплыл шесть раз за два дня.
//
// ⚠️ ДВА ПРОГОНА, И ВТОРОЙ НУЖЕН НЕ МЕНЬШЕ ПЕРВОГО: сторож, который только
// требует плашку, зеленел бы и на экране, показывающем беду ВСЕГДА.
//
// ⚠️ Прогон по экранам, где человек смотрит (T165); замер по видимому
// тексту (T169).
//
// ЗАПУСК: npm run otkaz (нужен Chrome; без него — «ПРОВЕРКА НЕ ВЫПОЛНЕНА»).
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const КОРЕНЬ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ПРОБА = path.join(КОРЕНЬ, "scripts/probe-otkaz-zagruzki");
const ПОРТ = 6700 + Math.floor(Math.random() * 200);

const БРАУЗЕРЫ = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
];

// Два прогона: сервер согласен и сервер отказал. Второй нужен, чтобы отказ
// не выдавался за успех — «ссылка готова» после 400 отправляет человека
// копировать то, чего нет.
const ПРОГОНЫ = [
  { имя: "сервер не отвечает", хвост: "?rezhim=padaet", шаги: "падает" },
  { имя: "сервер отвечает", хвост: "", шаги: "работает" },
];

const ОЖИДАЕМО = {
  падает: [
    ["① оболочка говорит об отказе", "сказано · есть повтор"],
    ["② названо, чего не хватает", "перечислено: 6"],
    ["③ Главная про отчёты", "сказано"],
    ["④ экран «Чеки» не врёт про пустоту", "сказано"],
    ["⑤ «Аккаунт» не крутит вечную загрузку", "сказано"],
    ["⑥ «Интеграции» не выдают пустоту за список", "сказано"],
    ["⑦ «Организация» не выдаёт пустые реквизиты за правду", "сказано"],
  ],
  работает: [
    // ⚠️ Обратная половина: без беды экран о ней не говорит.
    ["① оболочка говорит об отказе", "молчит, беды нет"],
    ["② названо, чего не хватает", "случай без беды"],
    ["③ Главная про отчёты", "молчит, беды нет"],
    ["④ экран «Чеки» не врёт про пустоту", "случай без беды"],
    ["⑤ «Аккаунт» не крутит вечную загрузку", "профиль открыт"],
    ["⑥ «Интеграции» не выдают пустоту за список", "молчит, беды нет"],
    [
      "⑦ «Организация» не выдаёт пустые реквизиты за правду",
      "молчит, беды нет",
    ],
  ],
};

const беды = [];
console.log("\nОТКАЗ ЗАГРУЗКИ: экран говорит, что сервер не ответил");

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

const снятьРазом = (хвост) =>
  new Promise((готово, споткнулись) => {
    const дитя = spawn(
      браузер,
      [
        "--headless",
        "--disable-gpu",
        "--virtual-time-budget=30000",
        "--window-size=430,1400",
        "--dump-dom",
        `http://localhost:${ПОРТ}/${хвост}`,
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

  for (const прогон of ПРОГОНЫ) {
    console.log(`\n  ${прогон.имя.toUpperCase()}`);
    let замер = null;
    // Переснимаем только НЕСОСТОЯВШЕЕСЯ измерение; расхождение шага —
    // это результат, его не переснимают.
    for (let п = 0; п < 3 && !замер; п++) {
      const р = разобрать(await снятьРазом(прогон.хвост));
      if (Array.isArray(р)) замер = р;
    }
    if (!замер) {
      console.log("  ✗ ПРОВЕРКА НЕ ВЫПОЛНЕНА: замер не снялся за 3 попытки");
      process.exitCode = 1;
      continue;
    }
    ОЖИДАЕМО[прогон.шаги].forEach(([имя, ждём], i) => {
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
      if (!ок)
        беды.push(`${прогон.имя}/${имя}: «${было || "НЕТ"}» вместо «${ждём}»`);
    });
  }
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
  "\n  ✓ отказ загрузки назван словами и с повтором; без беды экран о ней\n" +
    "    не говорит\n",
);
process.exit(0);
