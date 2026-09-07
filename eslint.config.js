import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  // design/handoff — распакованная выгрузка Claude Design (см. .gitignore).
  // Это ЧУЖОЙ код: .jsx из проекта ДС не наш и нашим правилам не подчиняется.
  // ⚠️ Без игнора eslint даёт 133 ошибки из 11 файлов выгрузки, и `npm run lint`
  // краснеет на том, чего мы не писали. Правило ПОСТОЯННОЕ — каталог без даты
  // в имени, поэтому следующая выгрузка попадёт под него сама.
  globalIgnores([
    "dist",
    "design/handoff",
    // вывод сборки пробы для сторожа канона (npm run look) — чужой
    // минифицированный код, линту там делать нечего
    "scripts/probe/__dist",
    "scripts/probe-behaviour/__dist",
    "scripts/probe-live/__dist",
    "scripts/probe-skvoz/__dist",
    "scripts/probe-token/__dist",
    "scripts/probe-summa/__dist",
    "scripts/probe-geroy/__dist",
    "scripts/probe-avtor/__dist",
    "scripts/probe-udalenie/__dist",
    "scripts/probe-priglashenie/__dist",
    "scripts/probe-vhod-po-ssylke/__dist",
    "scripts/probe-priglasheniya-spisok/__dist",
    "scripts/probe-otkaz-zagruzki/__dist",
    "scripts/probe-boundary/__dist",
    "scripts/probe-scroll/__dist",
    "scripts/probe-vid/__dist",
    "scripts/probe-pos/__dist",
  ]),
  {
    files: ["**/*.{js,jsx}"],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
]);
