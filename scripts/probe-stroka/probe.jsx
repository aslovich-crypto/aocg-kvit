// ⚠️ ПРОБА СТРОКИ СПИСКА «ЧЕКИ» (T172). Подпись автора в строке обрезается;
// решение владельца 08.09.2026 — перенести КАРТУ на вторую строку.
//
// ⚠️ ЗАМЕР ГЕОМЕТРИЕЙ, А НЕ ТЕКСТОМ (T169, повторено в UX-26): `textContent`
// содержит полное имя и тогда, когда оно визуально срезано многоточием.
// Мерим clientWidth/scrollWidth отрисованных узлов.
//
// ⚠️ АВТОР ВИДЕН ТОЛЬКО ТЕМ, КТО ВИДИТ ЧУЖИЕ ЧЕКИ (App.jsx:1387). Поэтому
// роль здесь `admin` и людей в организации несколько — у сотрудника строки
// с автором нет вовсе, и проба мерила бы экран без предмета (T165).
//
// ЧЕКИ ПОДОБРАНЫ ПОД ХУДШИЙ СЛУЧАЙ, А НЕ ПОД СРЕДНИЙ: длинные фамилии,
// карта с четырьмя цифрами (не «Наличные» — там подпись короче), длинные
// названия категорий. Средний случай влезает и сегодня; вопрос владельца
// про тот, что не влезает.

import { createRoot } from "react-dom/client";
import App from "../../src/App.jsx";

const ЛЮДИ = [
  { id: 1, first_name: "Алексей", last_name: "Шукалович", role: "admin" },
  {
    id: 2,
    first_name: "Константин",
    last_name: "Овчинников",
    role: "employee",
  },
  {
    id: 3,
    first_name: "Владислав",
    last_name: "Христорождественский",
    role: "employee",
  },
  { id: 4, first_name: "Пётр", last_name: "Ли", role: "employee" },
];

const общее = (id, кто, орг, сумма, карта) => ({
  id,
  org: орг,
  org_legal: орг,
  org_brand: null,
  amount: сумма,
  date: "2026-09-01",
  payment: карта,
  card_last4: карта === "Наличные" ? null : "3950",
  user_id: кто,
  employee: null,
  category_id: 11,
  in_report: false,
});

const ЧЕКИ = [
  // ① самая длинная фамилия организации — худший случай подписи
  общее(301, 3, "ООО «Ромашка»", "1250.00", "Корпоративная 3950"),
  // ② фамилия средней длины
  общее(302, 2, "ООО «Василёк»", "980.50", "Корпоративная 3950"),
  // ③ короткая фамилия — влезает и сегодня, нужна как контроль
  общее(303, 4, "ООО «Клевер»", "340.00", "Корпоративная 3950"),
  // ④ наличные: подписи карты нет, у автора места больше
  общее(304, 3, "ООО «Одуванчик»", "77.00", "Наличные"),
  // ⑤⑥⑦ ещё три — чтобы считать, сколько строк видно на экране
  общее(305, 2, "ООО «Подорожник»", "4500.00", "Корпоративная 3950"),
  общее(306, 3, "ООО «Лютик»", "220.00", "Корпоративная 3950"),
  общее(307, 2, "ООО «Крапива»", "1500.00", "Корпоративная 3950"),
];

const КАТАЛОГ = {
  groups: [
    {
      id: 1,
      name: "Питание и кейтеринг",
      categories: [
        { id: 11, name: "Представительские расходы", tax_kind: "Прочие" },
      ],
    },
  ],
};

const ОТВЕТЫ = {
  "/api/users/me": {
    id: 1,
    first_name: "Алексей",
    last_name: "Шукалович",
    email: "u@example.com",
    role: "admin",
    is_email_verified: true,
    consent_version: 1,
    consent_at: "2026-08-01T00:00:00Z",
    linked_providers: [],
  },
  "/api/users/": ЛЮДИ,
  "/api/reports/": [],
  "/api/cards/": [{ id: 1, name: "Корпоративная 3950", is_default: true }],
  "/api/categories/": КАТАЛОГ,
  "/api/organizations/me": { id: 1, name: "АОЦГ", tax_system: "usn_d" },
  "/api/notifications/": { unread: 0, items: [] },
};

const ответ = (status, тело) => ({
  ok: status >= 200 && status < 300,
  status,
  json: () => Promise.resolve(тело),
  text: () => Promise.resolve(JSON.stringify(тело)),
});

window.fetch = (u) => {
  const путь = String(u)
    .replace(/^https?:\/\/[^/]+/, "")
    .split("?")[0];
  const одиночный = путь.match(/^\/api\/receipts\/(\d+)$/);
  if (одиночный) {
    const чек = ЧЕКИ.find((ч) => ч.id === Number(одиночный[1]));
    return Promise.resolve(
      чек ? ответ(200, { ...чек }) : ответ(404, { detail: "Not found" }),
    );
  }
  if (путь === "/api/receipts/")
    return Promise.resolve(
      ответ(
        200,
        ЧЕКИ.map((ч) => ({ ...ч })),
      ),
    );
  return Promise.resolve(ответ(200, ОТВЕТЫ[путь] ?? []));
};

localStorage.setItem("access_token", "проба");
localStorage.setItem("refresh_token", "проба");
localStorage.setItem("consent_given", "true");
localStorage.setItem("consent_version", "1");

createRoot(document.getElementById("root")).render(<App />);
