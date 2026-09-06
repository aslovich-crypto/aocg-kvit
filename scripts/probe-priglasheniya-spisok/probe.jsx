// ⚠️ ПРОБА СПИСКА ПРИГЛАШЕНИЙ на экране «Пользователи». С 23db3b1 бэкенд
// отдаёт ВСЕ ссылки, включая погашенные, — и фронт обязан их развести:
// живые впереди, отработавшие отдельно и ниже.
//
// Три случая, каждый своим адресом:
//   (без параметра) — живые и отработавшие вперемешку от сервера
//   ?sluchay=pusto  — живых нет вовсе
//   ?sluchay=sboy   — список не загрузился (это НЕ «приглашений нет»)
import { createRoot } from "react-dom/client";
import App from "../../src/App.jsx";

const СЛУЧАЙ = new URLSearchParams(location.search).get("sluchay") || "";

const ПРИГЛАШЕНИЯ = [
  {
    token: "живая",
    invite_url: "https://app.aocgai.ru/join/живая",
    role: "employee",
    email: "petr@example.com",
    first_name: "Пётр",
    last_name: "Петров",
    sent_at: "2026-09-06T09:00:00Z",
    expires_at: "2026-09-13T09:00:00Z",
    max_uses: 1,
    uses_count: 0,
    статус: "приглашён, ожидает",
    отработала: false,
    used_by_user_id: null,
    used_at: null,
    вошёл: null,
  },
  {
    token: "отработавшая",
    invite_url: "https://app.aocgai.ru/join/отработавшая",
    role: "accountant",
    email: "ivan@example.com",
    first_name: "Иван",
    last_name: "Иванов",
    sent_at: "2026-09-05T09:00:00Z",
    expires_at: "2026-09-12T09:00:00Z",
    max_uses: 1,
    uses_count: 1,
    статус: "зарегистрировался",
    отработала: true,
    used_by_user_id: 42,
    used_at: "2026-09-05T14:30:00Z",
    вошёл: "Иван Иванов",
  },
  {
    // ⚠️ СТАРАЯ СТРОКА: погашена, но отметки нет и быть не может — связи
    // в базе не существовало. Экран обязан сказать это словом.
    token: "старая",
    invite_url: "https://app.aocgai.ru/join/старая",
    role: "employee",
    email: "al@aocg.ru",
    first_name: "",
    last_name: "",
    sent_at: null,
    expires_at: null,
    max_uses: 1,
    uses_count: 1,
    статус: "зарегистрировался",
    отработала: true,
    used_by_user_id: null,
    used_at: null,
    вошёл: null,
  },
];

const ОТВЕТЫ = {
  "/api/users/me": {
    id: 1,
    first_name: "Алексей",
    last_name: "Шукалович",
    email: "a@example.com",
    role: "admin",
    is_email_verified: true,
    consent_version: 1,
    consent_at: "2026-08-01T00:00:00Z",
    linked_providers: [],
  },
  "/api/users/": [
    { id: 1, first_name: "Алексей", last_name: "Шукалович", role: "admin" },
  ],
  "/api/receipts/": [],
  "/api/reports/": [],
  "/api/cards/": [],
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

window.fetch = (u) => {
  const путь = String(u)
    .replace(/^https?:\/\/[^/]+/, "")
    .split("?")[0];
  if (путь === "/api/invite/list") {
    if (СЛУЧАЙ === "sboy") return Promise.reject(new Error("нет связи"));
    if (СЛУЧАЙ === "pusto")
      return Promise.resolve(
        ответ(
          200,
          ПРИГЛАШЕНИЯ.filter((и) => и["отработала"]),
        ),
      );
    return Promise.resolve(ответ(200, ПРИГЛАШЕНИЯ));
  }
  return Promise.resolve(ответ(200, ОТВЕТЫ[путь] ?? []));
};

localStorage.setItem("access_token", "проба");
localStorage.setItem("refresh_token", "проба");
localStorage.setItem("consent_given", "true");
localStorage.setItem("consent_version", "1");

createRoot(document.getElementById("root")).render(<App />);
