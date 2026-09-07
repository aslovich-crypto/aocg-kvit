#!/usr/bin/env node
// ЗАМЕР СТРОКИ СПИСКА «ЧЕКИ» при 320×568 (T172, часть 1). НИЧЕГО НЕ ЧИНИТ —
// печатает числа: что стоит в строке, где рвётся, сколько строк видно,
// и то же самое для гипотезы «карта уезжает на вторую строку».
//
// ⚠️ ОКНО 320×568 — самый узкий и самый низкий из реальных (iPhone SE).
// Ширина отвечает на «влезает ли», высота — на «сколько видно»; без второй
// вопрос владельца «сколько чеков станет видно» не имеет числа вовсе.
//
// ЗАПУСК: node scripts/measure-stroka.mjs
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const КОРЕНЬ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ПРОБА = path.join(КОРЕНЬ, "scripts/probe-stroka");
// ⚠️ СВОЙ ДИАПАЗОН. Первая редакция взяла 5700+, где уже сидит
// check-author.mjs: два прибора дрались за порт, и check-author молча
// падал на --strictPort. Диагноз поставлен по тому, что ПРОПУСК МУТАЦИИ
// ПЕРЕЕЗЖАЛ между прогонами — значит дело в оснастке, а не в мутанте.
const ПОРТ = 5300 + Math.floor(Math.random() * 200);
const БРАУЗЕРЫ = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
];

const браузер = БРАУЗЕРЫ.find((п) => existsSync(п));
if (!браузер) {
  console.log("  ✗ ЗАМЕР НЕ ВЫПОЛНЕН: не найден Chrome — смотреть нечем");
  process.exit(1);
}

try {
  execFileSync(
    path.join(КОРЕНЬ, "node_modules/.bin/vite"),
    ["build", "--config", path.join(ПРОБА, "vite.config.mjs")],
    { cwd: КОРЕНЬ, stdio: "pipe", timeout: 180000 },
  );
} catch (е) {
  console.log("  ✗ ЗАМЕР НЕ ВЫПОЛНЕН: проба не собралась");
  String(е.stdout || е.message)
    .split("\n")
    .slice(-8)
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

const снять = (вариант) =>
  new Promise((готово, беда) => {
    const дитя = spawn(
      браузер,
      [
        "--headless=new",
        "--disable-gpu",
        "--virtual-time-budget=25000",
        "--window-size=320,568",
        "--dump-dom",
        `http://localhost:${ПОРТ}/?variant=${вариант}`,
      ],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    let вывод = "";
    const часы = setTimeout(() => {
      дитя.kill("SIGKILL");
      беда(new Error("браузер молчит"));
    }, 120000);
    дитя.stdout.on("data", (к) => (вывод += к));
    дитя.on("error", (е) => {
      clearTimeout(часы);
      беда(е);
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

const печать = (с) => {
  console.log(`\n═══ ${с.метка} · окно ${с.окно.w}×${с.окно.h} ═══`);
  console.log(`строк отрисовано ${с.строк} · ВИДНО ЦЕЛИКОМ ${с.видноЦеликом}`);
  for (const р of с.строки) {
    const а = р.автор,
      о = р.оплата;
    console.log(
      `  #${р["№"]} строка ${р.строка.w}×${р.строка.h} подложка=${
        р.подложка ? р.подложка.h : "—"
      }` +
        ` · колонки ${р.колонки.join(" / ")}` +
        `\n      мета ${
          р.мета ? `cw=${р.мета.cw} sw=${р.мета.sw}` : "— (подпись вне колонки)"
        }` +
        ` ${р.мета ? (р.мета.обрезан ? "ПЕРЕПОЛНЕНА" : "влезает") : ""}` +
        `\n      дата ${р.дата ? `w=${р.дата.w}` : "—"}` +
        `\n      автор ${
          а
            ? `«${а.текст}» видно ${а.cw} из ${а.sw} (не хватает ${
                р.нехватка
              }) ${а.обрезан ? "ОБРЕЗАН" : "цел"}`
            : "нет"
        }` +
        `\n      оплата ${
          о
            ? `«${о.текст}» cw=${о.cw} sw=${о.sw} ${
                о.обрезан ? "ОБРЕЗАНА" : "цела"
              }`
            : "нет"
        }`,
    );
  }
};

try {
  let поднялся = false;
  for (let i = 0; i < 60 && !поднялся; i++) {
    try {
      const r = await fetch(`http://localhost:${ПОРТ}/`);
      поднялся = r.ok;
    } catch {
      await new Promise((г) => setTimeout(г, 250));
    }
  }
  if (!поднялся) {
    console.log("  ✗ ЗАМЕР НЕ ВЫПОЛНЕН: сервер пробы не поднялся");
    process.exit(1);
  }

  const прогон = async (вариант) => {
    const з = разобрать(await снять(вариант));
    if (!з || з.НЕ_ОТРИСОВАЛОСЬ) {
      console.log(`  ✗ ЗАМЕР НЕ ВЫПОЛНЕН (${вариант}): проба не отдала чисел`);
      process.exit(1);
    }
    return з;
  };
  // ⚠️ ДВА ПРОГОНА, А НЕ ДВЕ ПЕРЕСТАНОВКИ В ОДНОМ. Места для подписи два —
  // внутри левой колонки (наследует её пол 148) и во всю ширину карточки
  // (288 минус поля). Наложить одно на другое значило бы мерить разметку,
  // которой ни один вариант не создаёт.
  const A = await прогон("a");
  const B = await прогон("b");

  печать(A.до);
  печать(A.после);
  печать(B.после);

  const свод = (с) => {
    const сА = с.строки.filter((р) => р.автор);
    return {
      обр: сА.filter((р) => р.автор.обрезан).length,
      всего: сА.length,
      h: с.строки[0]?.строка.h,
      видно: с.видноЦеликом,
      макс: Math.max(0, ...сА.map((р) => р.автор.cw)),
    };
  };
  const д = свод(A.до);
  console.log("\n═══ ИТОГ ═══");
  console.log(
    "  вариант                    обрезано   высота  видно  подписи дают",
  );
  const ряд = (и, с) =>
    console.log(
      `  ${и.padEnd(26)} ${String(с.обр + " из " + с.всего).padEnd(10)}` +
        `${String(с.h).padEnd(8)}${String(с.видно).padEnd(7)}${с.макс}px`,
    );
  ряд("сейчас", д);
  ряд("①a внутри колонки", свод(A.после));
  ряд("①b во всю ширину", свод(B.после));

  console.log("\n═══ ЖЕСТ ═══");
  const уехала = (ж) => /translateX\(-\d/.test((ж && ж.вовремя) || "");
  for (const [метка, ж] of [
    ["однострочная (контроль)", A.до.жест],
    ["①a двойная", A.после.жест],
    ["①b двойная", B.после.жест],
  ]) {
    if (!ж) {
      console.log(`  ${метка}: не мерился`);
      continue;
    }
    console.log(
      `  ${метка}: ${ж.было} → ${ж.вовремя} → ${ж.после}` +
        `  ${уехала(ж) ? "УЕХАЛА" : "не сдвинулась"}`,
    );
  }
  if (!уехала(A.до.жест)) {
    console.log("  ⚠️ КОНТРОЛЬ НЕ УЕХАЛ — синтетический жест до обработчика");
    console.log("     не доходит; про свайп этот замер НЕ ОТВЕЧАЕТ.");
  }
} finally {
  сервер.kill("SIGKILL");
}
