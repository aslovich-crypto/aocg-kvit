// ⚠️ ПРОБА ЭКРАНА ВХОДА ПО ССЫЛКЕ (/join/<токен>). Проверяет то, что человек
// видит, ПЕРЕЙДЯ ПО ПРИГЛАШЕНИЮ, — а не то, что удобно замерить изнутри.
//
// Четыре случая, каждый своим адресом пробы:
//   ?sluchay=imennaya — именная ссылка: адрес обязан быть подставлен и не
//                       редактироваться (сервер его сверяет, a5bcb13)
//   ?sluchay=obshaya  — общая: поле свободно, сказано, что роль «Сотрудник»
//   ?sluchay=otkaz    — сервер отказал 400 на регистрации: текст сервера
//                       обязан дойти до человека
//   ?sluchay=sboy     — validate не ответил: «не дозвонились» ≠ «ссылка
//                       недействительна», и это разные действия человека
import { createRoot } from "react-dom/client";
import App from "../../src/App.jsx";

const СЛУЧАЙ =
  new URLSearchParams(location.search).get("sluchay") || "imennaya";

const ВАЛИДАЦИЯ = {
  imennaya: {
    is_valid: true,
    role: "accountant",
    org_name: "АОЦГ",
    expires_at: "2026-09-12T12:00:00Z",
    is_personal: true,
    email: "ivan@example.com",
  },
  obshaya: {
    is_valid: true,
    role: "employee",
    org_name: "АОЦГ",
    expires_at: "2026-09-07T12:00:00Z",
    is_personal: false,
    email: null,
  },
};
ВАЛИДАЦИЯ.otkaz = ВАЛИДАЦИЯ.imennaya;

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

  if (путь.startsWith("/api/invite/validate/")) {
    // ⚠️ СБОЙ СВЯЗИ — ЭТО ОТКАЗ ПРОМИСА, а не ответ с плохим телом: именно так
    // ведёт себя оборванная сеть, и именно этот случай экран путал с мёртвой
    // ссылкой.
    if (СЛУЧАЙ === "sboy") return Promise.reject(new Error("нет связи"));
    return Promise.resolve(ответ(200, ВАЛИДАЦИЯ[СЛУЧАЙ]));
  }

  if (путь === "/api/auth/register-by-invite") {
    if (СЛУЧАЙ === "otkaz")
      return Promise.resolve(
        ответ(400, {
          detail:
            "Это приглашение выписано на другой адрес — войдите с той почты, на которую его прислали",
        }),
      );
    return Promise.resolve(
      ответ(200, { access_token: "т", refresh_token: "т" }),
    );
  }

  return Promise.resolve(ответ(200, []));
};

// Экран входа по ссылке живёт по адресу /join/<токен> — проба открывается
// сразу там, как человек из письма.
history.replaceState({}, "", "/join/tok-1" + location.search);

createRoot(document.getElementById("root")).render(<App />);
