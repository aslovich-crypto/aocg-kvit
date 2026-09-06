// ⚠️ ПРОБА СУММЫ НА ВСЕХ ПУТЯХ ПОКАЗА ЧЕКА (T177).
//
// ЗАЧЕМ. Чек попадает на экран ШЕСТЬЮ разными путями, и до 07.09.2026 каждый
// приводил сумму САМ. Мутация в одном пути не трогала остальные пять: сквозной
// сторож идёт по ручному вводу, а мутация ставилась в приём списка, через
// который тот сценарий не проходит ни разу.
//
// Здесь один сценарий проходит по РАЗНЫМ путям, и у каждого СВОЯ сумма —
// промах по соседнему пути был бы незаметен при одинаковых числах:
//   450,00   — путь ① первая загрузка списка
//   450,00   — путь ④ перечитывание одного чека (открытие карточки)
//   450,00   — путь ⑤ правка (PATCH категории)
//   1 234,56 — путь ② добавление вручную
//   777,77   — путь ⑥ карточка дубля по 409
//
// Сервер отдаёт суммы СТРОКАМИ — как отдал бы Decimal без приведения.
import { createRoot } from "react-dom/client";
import App from "../../src/App.jsx";

const ЛЮДИ = [
  { id: 1, first_name: "Алексей", last_name: "Шукалович", role: "admin" },
];

const ЧЕКИ = [
  {
    id: 201,
    org: "Кофейня",
    amount: "450.00",
    date: "2026-09-01",
    payment: "Корп.карта",
    user_id: 1,
    employee: null,
    category_id: null,
    in_report: false,
  },
];

// Дубль: его отдаёт GET /api/receipts/202 после 409 на добавление.
const ДУБЛЬ = {
  id: 202,
  org: "Аптека",
  amount: "777.77",
  date: "2026-09-02",
  payment: "Наличные",
  user_id: 1,
  employee: null,
  category_id: null,
  in_report: false,
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
    if (id === 202) return Promise.resolve(ответ(200, ДУБЛЬ));
    const чек = ЧЕКИ.find((ч) => ч.id === id);
    if (!чек) return Promise.resolve(ответ(404, { detail: "Not found" }));
    if (метод === "PATCH") {
      // Правка возвращает КАНОНИЧЕСКУЮ форму — сумма снова строкой.
      const тело = JSON.parse(opts.body || "{}");
      Object.assign(чек, тело);
      return Promise.resolve(ответ(200, { ...чек, amount: "450.00" }));
    }
    return Promise.resolve(ответ(200, { ...чек, amount: "450.00" }));
  }

  if (путь === "/api/receipts/" && метод === "POST") {
    const тело = JSON.parse(opts.body || "{}");
    // Пекарня добавляется; всё остальное — мягкий дубль 409 с id 202.
    if (String(тело.org).indexOf("Пекарня") >= 0) {
      const новый = {
        id: 203,
        org: "Пекарня",
        amount: "1234.56",
        date: тело.date || "2026-09-03",
        payment: "Корп.карта",
        user_id: 1,
        employee: null,
        category_id: null,
        in_report: false,
      };
      ЧЕКИ.push({ ...новый });
      return Promise.resolve(ответ(200, новый));
    }
    return Promise.resolve(
      ответ(409, {
        detail: { message: "Такой чек уже есть", existing_id: 202 },
      }),
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
