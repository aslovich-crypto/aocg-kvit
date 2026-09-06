// ⚠️ ПРОБА ОТКАЗА ЗАГРУЗКИ (T171). Проверяет то, что раньше было НЕОТЛИЧИМО
// от пустоты: сервер не ответил — а экран говорил «данных нет».
//
// Два прогона одним кодом:
//   ?rezhim=padaet  — все загрузки отказывают: экран обязан СКАЗАТЬ об этом
//   (без параметра)  — всё отвечает: плашек беды быть не должно ни одной
//
// ⚠️ Второй прогон важен не меньше первого: сторож, который только требует
// плашку, зеленел бы и на экране, который показывает беду ВСЕГДА.
import { createRoot } from "react-dom/client";
import App from "../../src/App.jsx";

const ПАДАЕТ = new URLSearchParams(location.search).get("rezhim") === "padaet";

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
  "/api/invite/list": [],
  "/api/services/": [],
};

// Что именно роняем: ровно те загрузчики, из-за которых экран врал.
const ПАДАЮЩИЕ = [
  "/api/receipts/",
  "/api/cards/",
  "/api/users/",
  "/api/categories/",
  "/api/organizations/me",
  "/api/users/me",
  "/api/reports/",
  "/api/services/",
];

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
  if (ПАДАЕТ && ПАДАЮЩИЕ.includes(путь))
    return Promise.reject(new Error("нет связи"));
  return Promise.resolve(ответ(200, ОТВЕТЫ[путь] ?? []));
};

localStorage.setItem("access_token", "проба");
localStorage.setItem("refresh_token", "проба");
localStorage.setItem("consent_given", "true");
localStorage.setItem("consent_version", "1");

createRoot(document.getElementById("root")).render(<App />);
