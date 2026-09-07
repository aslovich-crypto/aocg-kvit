import { useEffect, useState } from "react";
import LoadFailure from "../components/LoadFailure";
import { C, FONT, theme } from "../lib/theme";
import { TAX_LABELS } from "../lib/tax";

// Вкладка «Организация» в Настройках (задача #1, фронт).
// Профиль своей орг: показ name/inn/тип/дата; правка name/inn только для admin.
// Тип и дата — read-only. Бэкенд: GET/PATCH /api/organizations/me.
// Зависимости (authFetch, палитра C, FONT, Btn, SectionHead, fmtDate) приходят
// пропсами из NastroykiPage — чтобы не наращивать App.jsx и не плодить дубли.

const TYPE_LABEL = { company: "Компания", person: "ИП" };

// FastAPI отдаёт detail строкой (400) или списком объектов (422) — нормализуем.
function extractErr(e) {
  if (!e || !e.detail) return "";
  if (typeof e.detail === "string") return e.detail;
  if (Array.isArray(e.detail) && e.detail[0]) {
    return (e.detail[0].msg || "").replace(/^Value error,\s*/, "");
  }
  return "";
}

export default function OrganizationTab({ authFetch, role, Btn, fmtDate }) {
  // T171: «реквизиты пусты» и «реквизиты не загрузились» — разные вещи.
  const [сбойЗагрузки, setСбойЗагрузки] = useState(false);
  const [попытка, setПопытка] = useState(0);
  const [org, setOrg] = useState(null);
  const [form, setForm] = useState({ name: "", inn: "", tax_system: "" });
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const isAdmin = role === "admin";
  const fromApi = (d) => ({
    name: d.name || "",
    inn: d.inn || "",
    tax_system: d.tax_system || "",
  });

  useEffect(() => {
    authFetch("/api/organizations/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && d.id) {
          setOrg(d);
          setForm(fromApi(d));
        }
        setСбойЗагрузки(false);
      })
      // ⚠️ Пустые реквизиты и «не загрузились» выглядели одинаково (T171):
      // человек начинал заполнять форму заново поверх существующих данных.
      .catch(() => setСбойЗагрузки(true));
  }, [authFetch, попытка]);

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  async function save() {
    const name = form.name.trim();
    const inn = form.inn.trim();
    if (!name) {
      setErr("Укажите название организации");
      return;
    }
    setErr("");
    setLoading(true);
    const payload = { name, inn };
    // tax_system шлём только если выбран (пустой = «Не указан» → не трогаем).
    if (form.tax_system) payload.tax_system = form.tax_system;
    try {
      const res = await authFetch("/api/organizations/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const d = await res.json().catch(() => null);
        if (d && d.id) {
          setOrg(d);
          setForm(fromApi(d));
        }
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } else {
        const e = await res.json().catch(() => null);
        setErr(extractErr(e) || "Не удалось сохранить");
      }
    } catch {
      setErr("Не удалось сохранить");
    } finally {
      setLoading(false);
    }
  }

  if (!org)
    return сбойЗагрузки ? (
      <div style={{ padding: "20px" }}>
        <LoadFailure
          что="реквизиты организации"
          onRetry={() => setПопытка((н) => н + 1)}
        />
      </div>
    ) : (
      <div
        style={{
          padding: "40px 20px",
          textAlign: "center",
          color: theme.fg3,
          fontFamily: FONT,
          fontSize: 13,
        }}
      >
        Загрузка…
      </div>
    );

  const rowStyle = (i) => ({
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "3px 12px",
    borderBottom: `1px solid ${theme.border}`,
    background: i % 2 === 0 ? theme.surface : theme.surfaceSunk,
  });
  const lbl = {
    fontSize: 11,
    color: theme.fg2,
    fontFamily: FONT,
    minWidth: 110,
    flexShrink: 0,
  };
  const fin = {
    flex: 1,
    textAlign: "right",
    border: "none",
    background: "transparent",
    fontSize: 16 /* T138 */,
    color: C.dark,
    fontFamily: FONT,
    outline: "none",
    padding: "7px 0",
  };
  const ro = { ...fin, color: theme.fg2 }; // read-only значение

  // Редактируемое (admin) или статичное поле — единый рендер строки.
  const field = (i, label, key, opts = {}) => (
    <div style={rowStyle(i)}>
      <span style={lbl}>{label}</span>
      {isAdmin && opts.editable ? (
        <input
          value={form[key]}
          onChange={(e) => set(key, e.target.value)}
          placeholder={opts.placeholder || ""}
          inputMode={opts.inputMode}
          pattern={opts.pattern}
          style={fin}
        />
      ) : (
        <span style={ro}>{opts.display ?? (form[key] || "—")}</span>
      )}
    </div>
  );

  return (
    <div
      style={{ padding: "12px 16px calc(env(safe-area-inset-bottom) + 80px)" }}
    >
      {/* ⚠️ Заголовка нет: экран уже назван «Организация» в шапке.
          Правило вёрстки — docs/RULES-FRONTEND.md, раздел о подэкранах. */}
      {field(0, "Название", "name", { editable: true, placeholder: "ООО «…»" })}
      {field(1, "ИНН", "inn", {
        editable: true,
        placeholder: "10 или 12 цифр",
        inputMode: "numeric",
        pattern: "[0-9]*",
      })}
      {field(2, "Тип", "type", {
        display: TYPE_LABEL[org.type] || org.type || "—",
      })}
      {/* Налоговый режим — селектор для admin, иначе read-only подпись */}
      <div style={rowStyle(3)}>
        <span style={lbl}>Налоговый режим</span>
        {isAdmin ? (
          <select
            value={form.tax_system}
            onChange={(e) => set("tax_system", e.target.value)}
            style={{ ...fin, cursor: "pointer" }}
          >
            <option value="">Не указан</option>
            {Object.entries(TAX_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        ) : (
          <span style={ro}>{TAX_LABELS[org.tax_system] || "Не указан"}</span>
        )}
      </div>
      {field(4, "Создана", "created", {
        display: org.created_at ? fmtDate(org.created_at) : "—",
      })}

      {isAdmin && (
        <div style={{ marginTop: 16 }}>
          {err && (
            <div
              style={{
                fontSize: 12,
                color: theme.cherry,
                fontFamily: FONT,
                marginBottom: 8,
              }}
            >
              {err}
            </div>
          )}
          {saved && (
            <div
              style={{
                fontSize: 12,
                color: "#15803D",
                fontFamily: FONT,
                marginBottom: 8,
              }}
            >
              Сохранено
            </div>
          )}
          <Btn full onClick={save} loading={loading}>
            Сохранить
          </Btn>
        </div>
      )}
    </div>
  );
}
