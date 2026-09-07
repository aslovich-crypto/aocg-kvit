// ⚠️ ПРОБА ЗАГОЛОВКА КАРТОЧКИ ЧЕКА (UX-26). Длинное юрлицо в заголовке
// героя: краевой макет `compare/Длинное название - деталь чека.html` даёт ему
// ДВЕ строки (`-webkit-line-clamp:2` + `overflow-wrap:anywhere`), основной —
// одну с многоточием. Код следовал основному, и на снимке владельца 06.09.2026
// заголовок обрезан: «ООО «Виза менеджмент сер…»».
//
// ⚠️ ЗАМЕР ГЕОМЕТРИЕЙ, А НЕ ТЕКСТОМ. `textContent` содержит ПОЛНОЕ название
// даже когда оно визуально обрезано многоточием — проба по тексту была бы
// зелёной на обрезанном экране. Это T169 в чистом виде, поэтому меряем
// scrollWidth/clientWidth и scrollHeight/clientHeight отрисованного узла.
//
// ДВА ЧЕКА, И ВТОРОЙ НУЖЕН РАДИ РЕШЕНИЯ ВЛАДЕЛЬЦА 07.09.2026:
//   201 «Виза» — бренда НЕТ, заголовок = длинное юрлицо (главный случай);
//   202 «ВкусВилл» — бренд есть, длинное юрлицо уходит в ПОДПИСЬ под ним.
//   Подпись обязана остаться ОДНОСТРОЧНОЙ: заголовок человек ищет глазами
//   первым, там обрезка мешает узнать чек; юрлицо — уточнение.

import { createRoot } from "react-dom/client";
import App from "../../src/App.jsx";

const ЛЮДИ = [
  { id: 1, first_name: "Алексей", last_name: "Шукалович", role: "admin" },
];

const ЧЕКИ = [
  {
    id: 201,
    org: 'ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ "ВИЗА МЕНЕДЖМЕНТ СЕРВИС"',
    org_legal:
      'ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ "ВИЗА МЕНЕДЖМЕНТ СЕРВИС"',
    org_brand: null,
    amount: "450.00",
    date: "2026-09-01",
    payment: "Корп.карта",
    user_id: 1,
    employee: null,
    category_id: null,
    in_report: false,
  },
  {
    id: 202,
    org: 'ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ "ПРОИЗВОДСТВЕННО-ТОРГОВАЯ КОМПАНИЯ СИБИРСКИЕ ТРАДИЦИИ"',
    org_legal:
      'ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ "ПРОИЗВОДСТВЕННО-ТОРГОВАЯ КОМПАНИЯ СИБИРСКИЕ ТРАДИЦИИ"',
    org_brand: "ВкусВилл",
    amount: "780.00",
    date: "2026-09-02",
    payment: "Наличные",
    user_id: 1,
    employee: null,
    category_id: null,
    in_report: false,
  },
  {
    id: 203,
    // ⚠️ ОДНО ДЛИННОЕ СЛОВО БЕЗ ПРОБЕЛОВ — ради `overflow-wrap: anywhere`.
    // На названии со пробелами перенос происходит и без него, и мутация
    // «anywhere снят» осталась бы непойманной: проверка была бы зелёной
    // на сломанном правиле.
    org: "ПРОИЗВОДСТВЕННОТОРГОВАЯКОМПАНИЯ",
    org_legal: null,
    org_brand: "ПРОИЗВОДСТВЕННОТОРГОВАЯКОМПАНИЯ",
    amount: "300.00",
    date: "2026-09-03",
    payment: "Наличные",
    user_id: 1,
    employee: null,
    category_id: null,
    in_report: false,
  },
  {
    id: 205,
    // ⚠️ ИМЯ, КОТОРОМУ ДВУХ СТРОК МАЛО — ради проверки САМОГО ОГРАНИЧЕНИЯ.
    // На имени, влезающем ровно в две строки, снятие `-webkit-line-clamp`
    // ничего не меняет: текст и так переносится. Ограничение проверяется
    // только там, где оно обязано сработать.
    org: 'ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ "МЕЖРЕГИОНАЛЬНАЯ ТРАНСПОРТНО-ЛОГИСТИЧЕСКАЯ КОМПАНИЯ СЕВЕРНЫЙ ПУТЬ"',
    org_legal:
      'ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ "МЕЖРЕГИОНАЛЬНАЯ ТРАНСПОРТНО-ЛОГИСТИЧЕСКАЯ КОМПАНИЯ СЕВЕРНЫЙ ПУТЬ"',
    org_brand: null,
    amount: "900.00",
    date: "2026-09-04",
    payment: "Наличные",
    user_id: 1,
    employee: null,
    category_id: null,
    in_report: false,
  },
];

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
  "/api/cards/": [{ id: 1, name: "Корп.карта", is_default: true }],
  "/api/categories/": { groups: [] },
  "/api/organizations/me": { id: 1, name: "АОЦГ", tax_system: "usn_d" },
  "/api/notifications/": { unread: 0, items: [] },
};

const ответ = (status, тело) => ({
  ok: status >= 200 && status < 300,
  status,
  json: () => Promise.resolve(тело),
  text: () => Promise.resolve(JSON.stringify(тело)),
});

window.fetch = (u, opts = {}) => {
  const метод = (opts.method || "GET").toUpperCase();
  const путь = String(u)
    .replace(/^https?:\/\/[^/]+/, "")
    .split("?")[0];
  const одиночный = путь.match(/^\/api\/receipts\/(\d+)$/);

  if (одиночный) {
    const id = Number(одиночный[1]);
    const чек = ЧЕКИ.find((ч) => ч.id === id);
    if (!чек) return Promise.resolve(ответ(404, { detail: "Not found" }));
    if (метод === "PATCH") {
      // Правка возвращает КАНОНИЧЕСКУЮ форму — сумма снова строкой.
      const тело = JSON.parse(opts.body || "{}");
      Object.assign(чек, тело);
      return Promise.resolve(ответ(200, { ...чек }));
    }
    return Promise.resolve(ответ(200, { ...чек }));
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
