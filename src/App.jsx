/* global __BUILD_TIME__ */
import { useState, useEffect, useRef, useCallback } from "react";
import { useModalA11y } from "./hooks/useModalA11y";
import { useFabHidden, fabHiddenStyle } from "./hooks/useFabHidden";
import OrganizationTab from "./pages/OrganizationTab";
import GlavnayaPage from "./pages/GlavnayaPage";
import OtchetyPage from "./pages/OtchetyPage";
import ScanReceiptModal from "./pages/ScanReceiptModal";
import { parseQRString, buildQRString } from "./lib/qr";
import { computeTaxAccounting, regimeFlags, TAX_LABELS } from "./lib/tax";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import {
  ChartColumn,
  ClipboardList,
  Home,
  ReceiptText,
  Eye,
  EyeOff,
  Mail,
  AlertTriangle,
  Lock,
  Trash2,
  User,
  Bell,
  Check,
  Plus,
  Search,
  SlidersHorizontal,
  CreditCard,
  Banknote,
  Shield,
  Tag,
  Plug,
  Building2,
  Users,
  FileText,
  ChevronRight,
  ChevronLeft,
} from "lucide-react";
import { C, FONT, theme } from "./lib/theme";
// ⚠️ ОДНА РАЗМЕТКА «сервер не ответил» на всё приложение (T171):
// третьей копии текста не пишем, см. src/components/LoadFailure.jsx.
import LoadFailure from "./components/LoadFailure";
// Словарь категорий — ГЕНЕРИРУЕМЫЙ (источник: app/dictionaries/categories.json
// в репозитории бэкенда). Руками сюда значения не переписывать: разошлись бы
// молча, как это уже было (T39).
import {
  TAX_KINDS,
  DEFAULT_FALLBACK,
  DEFAULT_TAX_KIND,
} from "./lib/dictionaries";
import {
  shortOrg,
  fmtDate,
  paymentShort,
  isCash,
  money,
  moneyInput,
  parseMoney,
} from "./lib/format";
import {
  setCatalogMaps,
  groupColor,
  groupOf,
  catColor,
  catName,
  catColorById,
} from "./lib/categories";
import CategorySheet from "./components/CategorySheet";
import ReceiptDetailModal, {
  // ⚠️ ПОДТВЕРЖДЕНИЕ БЕРЁМ ГОТОВОЕ, а не пишем второе: оно уже написано
  // для карточки чека и знает про отчёт (см. ReceiptDetailModal.jsx).
  ConfirmDeleteSheet,
} from "./components/ReceiptDetailModal";
import LegalText from "./components/LegalText";
import { идПоИмени, имяАвтора, полноеИмя } from "./lib/people";
// S-28: тот же предикат роли, что уже гейтит фильтр автора на «Отчётах».
// Вторая копия условия разошлась бы с первой при следующей правке ролей.
import { canApprove } from "./lib/reports";
// Сетевой слой вынесен в src/lib/api.js (CLAUDE.md): компоненты вне монолита
// импортируют authFetch оттуда, а не получают пропсом.
import {
  API,
  authFetch,
  fetchWithTimeout,
  tokens,
  текстОшибки,
} from "./lib/api";
// S-34: текст согласия только с бэкенда, локальной копии нет.
import { загрузитьСогласие } from "./lib/policy";
import { каноничныеЧеки, каноничныйЧек } from "./lib/receipt";

// Sign out: revoke the refresh token server-side, clear local tokens, drop to login.
async function logout() {
  const rt = tokens.refresh;
  try {
    await fetch(API + "/api/auth/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: rt }),
    });
  } catch {
    /* offline — clear locally anyway */
  }
  tokens.clear();
  try {
    // ⚠️ ЯВНЫЙ выход помечается признаком. Автоматический — тот, что
    // шлёт authFetch при 401, — признака не несёт, и это не мелочь:
    // после явного человек уходит НАМЕРЕННО и должен вернуться
    // на «Главную», а после автоматического его выкинуло посреди
    // работы, и вернуть надо ровно туда, где он был.
    window.dispatchEvent(
      new CustomEvent("auth:logout", { detail: { явный: true } }),
    );
  } catch {
    /* ignore */
  }
}

// ⚠️ ПОДПИСИ НАПИСАНЫ ПО ГЕЙТАМ, А НЕ ПО ПАМЯТИ. Замер 31.08.2026 по
// требованию владельца — и прежние подписи врали ДВАЖДЫ: у «Бухгалтера»
// стояло «Регистрирует сотрудников», хотя все три ручки управления людьми
// admin-only (`users.py` 226/304/331), и «выгружает отчёты в 1С», хотя
// выгрузки в 1С на бэкенде НЕТ НИ ОДНОЙ СТРОКОЙ — грепом по `app/routers/`
// пусто. Интерфейс обещал больше, чем умеет бэкенд, и человек выбирал роль
// по несуществующим правам.
//
// ЧЕМ МЕРЕНО, ПОГЕЙТНО:
//   _require_admin            → приглашения (создать/список/отозвать),
//                               users POST/PATCH/DELETE, реквизиты орг — 8 мест
//   can_see_all               → все чеки и отчёты организации (admin, accountant)
//   _require_approver         → одобрить/отклонить отчёт (тот же круг)
//   _require_category_manager → справочник категорий (тот же круг)
//   _require_card_manager     → справочник карт (тот же круг)
//   employee                  → только свои чеки и отчёты
//
// ⚠️ РОЛИ `manager` ЗДЕСЬ БОЛЬШЕ НЕТ. В белый список `Role` она не входит
// намеренно («в Приме её никто не понимает», `app/auth.py:48`), прав ей не
// давал ни один гейт, а строк с такой ролью на проде нет: после чистки
// 31.08.2026 в базе один человек, администратор. Подпись без поведения —
// это обещание, которого никто не выполнит.
const ROLES = [
  {
    id: "employee",
    label: "Сотрудник",
    desc: "Добавляет чеки и создаёт отчёты, отправляет их на проверку. Видит только свои.",
  },
  {
    id: "accountant",
    label: "Бухгалтер",
    desc: "Видит все чеки и отчёты организации, одобряет и отклоняет их, ведёт справочники категорий и карт. Людьми не управляет.",
  },
  {
    id: "admin",
    label: "Администратор",
    desc: "Всё, что может бухгалтер, плюс приглашает и отключает сотрудников и правит реквизиты организации.",
  },
];

// Русские метки источника чека (как в фильтре «Источник») — для баннера дублей.
const SRC_LABEL = {
  fns: "ФНС",
  qr_scan: "QR",
  photo_ocr: "Фото",
  manual: "Вручную",
};
// Склонение существительного по числу: plural(n, ["чек","чека","чеков"]).
const plural = (n, forms) => {
  const n10 = n % 10,
    n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return forms[0];
  if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return forms[1];
  return forms[2];
};

const toLocalISO = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
const todayISO = () => toLocalISO(new Date());
const daysAgoISO = (d) => {
  const x = new Date();
  x.setDate(x.getDate() - d);
  return toLocalISO(x);
};
const monthStartISO = () => {
  const x = new Date();
  x.setDate(1);
  return toLocalISO(x);
};
const quarterStartISO = () => {
  const d = new Date();
  return toLocalISO(
    new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1),
  );
};

// ─── GLOBAL PERIOD ────────────────────────────────────────
const PERIOD_OPTIONS = [
  { key: "week", label: "Неделя" },
  { key: "month", label: "Месяц" },
  { key: "quarter", label: "Квартал" },
  { key: "year", label: "Год" },
  { key: "all", label: "Всё" },
];
const periodLabel = (k) =>
  (PERIOD_OPTIONS.find((o) => o.key === k) || PERIOD_OPTIONS[1]).label;
const periodKey = (l) =>
  (PERIOD_OPTIONS.find((o) => o.label === l) || PERIOD_OPTIONS[1]).key;
function inPeriod(date, period) {
  if (!date) return false;
  if (period === "all") return true;
  if (period === "week") return date >= daysAgoISO(7);
  if (period === "month") return date.slice(0, 7) === todayISO().slice(0, 7);
  if (period === "quarter") return date >= quarterStartISO();
  if (period === "year") return date.slice(0, 4) === todayISO().slice(0, 4);
  return true;
}

// ─── ATOMS ────────────────────────────────────────────────

function SectionHead({ num, title, id }) {
  return (
    <div
      id={id}
      // ⚠️ признак для сторожа канона: он ищет заголовки ВНУТРИ
      // отрисованного экрана и сверяет их с именем экрана в шапке
      data-zagolovok={title}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        margin: "16px 0 8px",
      }}
    >
      {num && (
        <div
          style={{
            width: 20,
            height: 20,
            background: theme.surfaceSunk,
            color: theme.fg2,
            fontSize: 9,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: FONT,
            flexShrink: 0,
          }}
        >
          {num}
        </div>
      )}
      <span
        style={{
          fontSize: 10,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: C.mid,
          fontFamily: FONT,
        }}
      >
        {title}
      </span>
      <div style={{ flex: 1, height: "0.5px", background: theme.border }} />
    </div>
  );
}

function Btn({ children, onClick, disabled, outline, full, small, loading }) {
  // loading: in-flight submit — keep the cherry fill, dim to 0.6, block clicks.
  const off = disabled || loading;
  return (
    <button
      onClick={onClick}
      disabled={off}
      style={{
        background: loading
          ? theme.cherry
          : disabled
            ? theme.surfaceSunk
            : outline
              ? "transparent"
              : theme.cherry,
        color: loading
          ? theme.surface
          : disabled
            ? theme.fg3
            : outline
              ? theme.cherry
              : theme.surface,
        border: `1.5px solid ${
          disabled && !loading ? theme.border : theme.cherry
        }`,
        padding: small ? "6px 12px" : "9px 18px",
        fontFamily: FONT,
        fontSize: 10,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        cursor: off ? "default" : "pointer",
        opacity: loading ? 0.6 : 1,
        transition: "all 0.15s",
        width: full ? "100%" : "auto",
        borderRadius: 6,
      }}
    >
      {children}
    </button>
  );
}

function RuleInput({
  label,
  value,
  onChange,
  // onBlur — «привести введённое в порядок, когда человек ушёл из поля».
  // Форматировать под пальцами нельзя: каретка прыгает на каждой вставке
  // разделителя разрядов. Свой onBlur у инпута уже есть (гасит подчёркивание),
  // поэтому внешний ДОПОЛНЯЕТ его, а не заменяет.
  onBlur,
  type = "text",
  placeholder,
  inputMode,
  pattern,
}) {
  const [f, setF] = useState(false);
  return (
    <div style={{ marginBottom: 14 }}>
      <div
        style={{
          fontSize: 9,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: theme.fg2,
          marginBottom: 4,
          fontFamily: FONT,
        }}
      >
        {label}
      </div>
      <input
        type={type}
        inputMode={inputMode}
        pattern={pattern}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        onFocus={() => setF(true)}
        onBlur={() => {
          setF(false);
          onBlur?.();
        }}
        style={{
          width: "100%",
          border: "none",
          borderBottom: `1.5px solid ${f ? theme.cherry : theme.border}`,
          outline: "none",
          padding: "7px 0",
          fontSize: 16 /* T138 */,
          fontFamily: FONT,
          color: C.dark,
          background: "transparent",
          boxSizing: "border-box",
          transition: "border-color 0.2s",
        }}
      />
    </div>
  );
}

function TabBar({ tabs, active, onSelect }) {
  return (
    <div
      style={{
        display: "flex",
        borderBottom: `1px solid ${theme.border}`,
        background: theme.surface,
        overflowX: "auto",
      }}
    >
      {tabs.map((t) => (
        <button
          key={t}
          onClick={() => onSelect(t)}
          style={{
            padding: "10px 14px",
            border: "none",
            background: "transparent",
            color: active === t ? theme.cherry : theme.fg2,
            fontFamily: FONT,
            fontSize: 10,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            cursor: "pointer",
            whiteSpace: "nowrap",
            flexShrink: 0,
            borderBottom:
              active === t
                ? `2px solid ${theme.cherry}`
                : "2px solid transparent",
            transition: "all 0.15s",
          }}
        >
          {t}
        </button>
      ))}
    </div>
  );
}

function Block({ children, style: s }) {
  return (
    <div
      style={{
        background: theme.surfaceSunk,
        borderLeft: `3px solid ${theme.cherryMuted}`,
        padding: "10px 14px",
        marginBottom: 10,
        ...s,
      }}
    >
      {children}
    </div>
  );
}

function Modal({ title, onClose, children, footer }) {
  const dialogRef = useModalA11y(onClose);
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(22,26,29,0.45)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        zIndex: 100,
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        style={{
          background: theme.surface,
          width: "100%",
          maxWidth: 480,
          borderTop: `3px solid ${theme.cherry}`,
          maxHeight: "82vh",
          display: "flex",
          flexDirection: "column",
          borderRadius: "12px 12px 0 0",
          overflow: "hidden",
          outline: "none",
        }}
      >
        <div
          style={{
            background: theme.surfaceSunk,
            borderBottom: `1px solid ${theme.border}`,
            padding: "11px 16px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 3, height: 14, background: theme.cherry }} />
            <span
              style={{
                fontSize: 11,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: C.dark,
                fontFamily: FONT,
              }}
            >
              {title}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            style={{
              border: "none",
              background: "none",
              color: theme.fg2,
              cursor: "pointer",
              fontSize: 16,
            }}
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>
        <div style={{ overflow: "auto", flex: 1, padding: "4px 16px 8px" }}>
          {children}
        </div>
        {footer && (
          <div
            style={{
              padding: "10px 16px calc(10px + env(safe-area-inset-bottom))",
              borderTop: `1px solid ${theme.border}`,
              background: theme.surfaceSunk,
              flexShrink: 0,
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

function SegmentedControl({ segments, active, onChange }) {
  return (
    <div
      style={{
        display: "flex",
        background: "#E6E9EF",
        borderRadius: 8,
        padding: 2,
        gap: 2,
      }}
    >
      {segments.map((s) => {
        const on = s === active;
        return (
          <button
            key={s}
            type="button"
            onClick={() => onChange(s)}
            aria-pressed={on}
            style={{
              flex: 1,
              // minWidth:0 обязателен: у флекс-элемента по умолчанию
              // min-width:auto, то есть он НЕ МОЖЕТ сжаться уже своего текста.
              // Пять подписей, причём активная жирнее остальных — суммарная
              // минимальная ширина МЕНЯЕТСЯ при переключении периода, и на
              // узком экране строка переставала помещаться. Отсюда «страница
              // уехала вбок сразу после переключения чипа».
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              textAlign: "center",
              padding: "6px 2px",
              borderRadius: 6,
              cursor: "pointer",
              userSelect: "none",
              background: on ? theme.surface : "transparent",
              color: on ? "#A4161A" : "#636B7D",
              border: on ? "1px solid #EEF0F4" : "1px solid transparent",
              boxShadow: on ? "0 1px 3px rgba(17,19,24,0.12)" : "none",
              fontSize: 11,
              fontFamily: FONT,
              fontWeight: on ? 600 : 500,
              transition:
                "background 180ms ease, color 180ms ease, box-shadow 180ms ease",
            }}
          >
            {s}
          </button>
        );
      })}
    </div>
  );
}

function SectionCard({ title, children }) {
  // .block из дизайн-системы: белая карточка radius 12, заголовок 15px/600 внутри,
  // без серой шапки-полоски.
  return (
    <div
      style={{
        background: theme.surface,
        border: `0.5px solid ${theme.border}`,
        borderRadius: 12,
        marginBottom: 12,
        padding: 16,
      }}
    >
      {title && (
        <div
          style={{
            fontSize: 15,
            fontWeight: 600,
            color: "#111318",
            fontFamily: FONT,
            margin: "0 0 14px",
          }}
        >
          {title}
        </div>
      )}
      {children}
    </div>
  );
}

function Donut({ title, data, sliceColor }) {
  const pal = [
    theme.cherry,
    theme.cherryMuted,
    "#C45558",
    "#E8A0A2",
    "#D4888A",
  ];
  // sliceColor(d) — раскраска по группе (донат «Категории»); иначе вишнёвая палитра.
  const colorAt = (d, i) => (sliceColor ? sliceColor(d) : pal[i % pal.length]);
  const sectionTotal = data.reduce((s, d) => s + d.value, 0);
  return (
    <SectionCard title={title}>
      {data.length > 1 && (
        <div style={{ position: "relative", height: 160 }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                cx="50%"
                cy="50%"
                innerRadius={54}
                outerRadius={75}
                paddingAngle={2}
                startAngle={90}
                endAngle={-270}
              >
                {data.map((d, i) => (
                  <Cell key={i} fill={colorAt(d, i)} />
                ))}
              </Pie>
              <Tooltip
                formatter={(v) => money(v)}
                contentStyle={{
                  background: theme.surface,
                  border: `1px solid ${theme.border}`,
                  fontFamily: FONT,
                  fontSize: 11,
                }}
              />
            </PieChart>
          </ResponsiveContainer>
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              pointerEvents: "none",
            }}
          >
            <span style={{ fontSize: 11, color: "#636B7D", fontFamily: FONT }}>
              Итого
            </span>
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: C.dark,
                fontFamily: FONT,
                fontVariantNumeric: "tabular-nums",
                whiteSpace: "nowrap",
              }}
            >
              {money(sectionTotal)}
            </span>
          </div>
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column" }}>
        {data.map((d, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "7px 0",
              borderTop: i === 0 ? "none" : `1px solid ${theme.border}`,
            }}
          >
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: colorAt(d, i),
                flexShrink: 0,
              }}
            />
            <span
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: 14,
                color: C.dark,
                fontFamily: FONT,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {d.name}
            </span>
            <span
              style={{
                fontSize: 14,
                fontWeight: 500,
                color: C.dark,
                fontFamily: FONT,
                fontVariantNumeric: "tabular-nums",
                whiteSpace: "nowrap",
              }}
            >
              {money(d.value)}
            </span>
            <span
              style={{
                fontSize: 13,
                color: theme.fg2,
                fontFamily: FONT,
                fontVariantNumeric: "tabular-nums",
                width: 40,
                textAlign: "right",
                flexShrink: 0,
              }}
            >
              {sectionTotal > 0
                ? Math.round((d.value / sectionTotal) * 100) + "%"
                : "0%"}
            </span>
          </div>
        ))}
      </div>
      {data.length === 0 && (
        <div
          style={{
            fontSize: 12,
            color: theme.fg3,
            fontFamily: FONT,
            padding: "6px 0",
          }}
        >
          Нет данных за период
        </div>
      )}
    </SectionCard>
  );
}

// ─── PAGES ────────────────────────────────────────────────

function SvodkaPage({
  receipts,
  activePeriod,
  setActivePeriod,
  users,
  cards,
  catalog,
  org,
  role,
}) {
  const [showFilters, setShowFilters] = useState(false);
  const [selEmployee, setSelEmployee] = useState(null);
  const [cats, setCats] = useState([]);
  const [selCards, setSelCards] = useState([]);
  const filtersActive = !!selEmployee || cats.length > 0 || selCards.length > 0;
  // Имя из фильтра переводим в идентификатор ОДИН раз: сравнивать надо
  // авторов, а не строки (см. src/lib/people.js).
  const selEmployeeId = идПоИмени(selEmployee, users);

  const filtered = receipts.filter((r) => {
    if (!inPeriod(r.date, activePeriod)) return false;
    // ⚠️ ОТБОР ПО `user_id`, А НЕ ПО ИМЕНИ (04.09.2026). Было сравнение
    // `r.employee || "Алексей Шукалович"` с именем из списка людей: колонка
    // `employee` пуста во всех 88 чеках прода, поэтому выбор ЛЮБОГО другого
    // сотрудника давал пустой список всегда, а выбор владельца — ВСЕ чеки
    // организации, включая чужие. Показ и отбор теперь на одном поле.
    if (selEmployeeId != null && r.user_id !== selEmployeeId) return false;
    if (cats.length > 0 && !cats.includes(catName(r))) return false;
    if (selCards.length > 0 && !selCards.includes(r.payment)) return false;
    return true;
  });

  const total = filtered.reduce((s, r) => s + Number(r.amount), 0);
  const orgMap = {},
    payMap = {},
    catMap = {},
    empMap = {};
  filtered.forEach((r) => {
    if (!orgMap[r.org]) orgMap[r.org] = { value: 0, count: 0 };
    orgMap[r.org].value += Number(r.amount);
    orgMap[r.org].count++;
    if (!payMap[r.payment]) payMap[r.payment] = { value: 0, count: 0 };
    payMap[r.payment].value += Number(r.amount);
    payMap[r.payment].count++;
    const cn = catName(r);
    if (!catMap[cn]) catMap[cn] = { value: 0, count: 0 };
    catMap[cn].value += Number(r.amount);
    catMap[cn].count++;
    // ⚠️ ГРУППИРОВКА ПО АВТОРУ, А НЕ ПО ПУСТОЙ КОЛОНКЕ. Прежний ключ
    // `r.employee || "Алексей Шукалович"` складывал ВСЕ расходы организации
    // в одного человека — на «Сводке» это цифра, по которой возмещают деньги.
    const e = имяАвтора(r.user_id, users);
    if (!empMap[e]) empMap[e] = { value: 0, count: 0 };
    empMap[e].value += Number(r.amount);
    empMap[e].count++;
  });
  const empData = Object.entries(empMap).map(([name, d]) => ({ name, ...d }));

  // ── Налоговый учёт расходов (INT) — общий расчёт, см. lib/tax.js ──
  const { deductible, nonDeductible, vatSum, vatCount, taxTotal } =
    computeTaxAccounting(filtered, catalog);
  const regime = org && org.tax_system ? org.tax_system : null;
  const { reducesExpenses, vatPayer } = regimeFlags(regime);
  const taxNote = {
    fontSize: 13,
    lineHeight: 1.45,
    color: theme.fg2,
    fontFamily: FONT,
  };
  const taxRow = (color, name, value) => (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span
        style={{
          width: 9,
          height: 9,
          borderRadius: "50%",
          background: color,
          flexShrink: 0,
        }}
      />
      <span style={{ flex: 1, fontSize: 14, color: C.dark, fontFamily: FONT }}>
        {name}
      </span>
      <span
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: C.dark,
          fontFamily: FONT,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {money(value)}
      </span>
    </div>
  );

  return (
    <div style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 80px)" }}>
      <div
        style={{
          background: theme.surface,
          borderBottom: `1px solid ${theme.border}`,
          padding: "10px 16px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <SegmentedControl
              segments={PERIOD_OPTIONS.map((o) => o.label)}
              active={periodLabel(activePeriod)}
              onChange={(l) => setActivePeriod(periodKey(l))}
            />
          </div>
          <div
            style={{
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              // ⑤ 14, как на «Чеках» и «Отчётах» и как в макете (.actions).
              // Было 8 — расхождение, заметное только рядом с ними.
              gap: 14,
            }}
          >
            {/* ③ ИКОНКА ПОИСКА БЕЗ ОБРАБОТЧИКА — намеренно, решение владельца
                продукта 05.08. В макете «Сводки» поиск есть, но что он ищет
                на аналитическом экране (чеки? категории? сотрудников?),
                канон не описывает: раскрытого состояния в макете нет.
                Ставим иконку по канону, смысл заводим строкой в трекер
                (UX-15) — как только он определён, сюда приходит обработчик.
                Это ровно тот случай, который в UX-14 назван «мёртвая кнопка
                хуже её отсутствия»; здесь на него пошли осознанно, ради
                единообразия трёх полос. */}
            {/* ⚠️ ОТСТУПЛЕНИЯ.СводкаБезЛупы (UX-15, 03.09.2026). Канон рисует
                лупу в шапках всех трёх лент — здесь её НЕТ НАМЕРЕННО, и это
                третье решение по этой кнопке за два дня:
                ① заглушка aria-disabled «ради единообразия» — обман жеста;
                ② переброс в поиск «Главной» — навигация, переодетая поиском;
                ③ разбор всей картины: на «Сводке» НЕТ ПРЕДМЕТА ПОИСКА —
                   это агрегаты, искать нечего. Кнопка без осмысленного
                   действия НА СВОЁМ МЕСТЕ не существует (RULES-FRONTEND:
                   «вид никогда не важнее того, что кнопка делает»).
                Вернуть лупу — только вместе с предметом поиска. */}
            <FilterIcon
              active={filtersActive}
              onClick={() => setShowFilters(true)}
            />
          </div>
        </div>
      </div>
      <div style={{ padding: "12px 16px" }}>
        {/* 1 · Итого за период */}
        <div
          style={{
            background: theme.surface,
            border: `0.5px solid ${theme.border}`,
            borderRadius: 12,
            padding: 16,
            marginBottom: 12,
          }}
        >
          <div
            style={{
              fontSize: 13,
              color: "#636B7D",
              marginBottom: 6,
              fontFamily: FONT,
            }}
          >
            Итого за период
          </div>
          <div
            style={{
              fontSize: 28,
              fontWeight: 700,
              color: "#111318",
              fontFamily: FONT,
              fontVariantNumeric: "tabular-nums",
              lineHeight: 1.05,
              letterSpacing: "-0.015em",
            }}
          >
            {money(total)}
          </div>
          <div
            style={{
              fontSize: 13,
              color: "#636B7D",
              fontFamily: FONT,
              marginTop: 7,
            }}
          >
            {filtered.length > 0
              ? `${filtered.length} ${plural(filtered.length, [
                  "операция",
                  "операции",
                  "операций",
                ])}`
              : "Нет данных за период"}
          </div>
        </div>

        {/* Налоговый учёт расходов */}
        {org && (
          <SectionCard title="Налоговый учёт расходов">
            {!regime ? (
              <div style={taxNote}>
                Укажите налоговый режим в разделе «Организация» — тогда покажем,
                сколько расходов можно учесть.
              </div>
            ) : !reducesExpenses ? (
              <div style={taxNote}>
                На режиме «{TAX_LABELS[regime]}» расходы не уменьшают налог.
              </div>
            ) : (
              <>
                <div
                  style={{
                    display: "flex",
                    height: 12,
                    borderRadius: 999,
                    overflow: "hidden",
                    gap: 2,
                  }}
                >
                  <span
                    style={{
                      flex: `0 0 ${
                        taxTotal > 0 ? (deductible / taxTotal) * 100 : 0
                      }%`,
                      background: "#15803D",
                    }}
                  />
                  <span
                    style={{
                      flex: `0 0 ${
                        taxTotal > 0 ? (nonDeductible / taxTotal) * 100 : 0
                      }%`,
                      background: "#9CA3AF",
                    }}
                  />
                </div>
                <div
                  style={{
                    marginTop: 14,
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                  }}
                >
                  {taxRow("#15803D", "Можно учесть в расходах", deductible)}
                  {taxRow("#9CA3AF", "Нельзя учесть", nonDeductible)}
                </div>
              </>
            )}
            {vatPayer && (
              <div
                style={{
                  marginTop: 14,
                  paddingTop: 14,
                  borderTop: `1px solid ${theme.border}`,
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <span
                  style={{
                    flex: 1,
                    fontSize: 14,
                    color: C.dark,
                    fontFamily: FONT,
                  }}
                >
                  Входящий НДС к вычету
                </span>
                <div style={{ textAlign: "right" }}>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: C.dark,
                      fontFamily: FONT,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {money(vatSum)}
                  </div>
                  <div
                    style={{ fontSize: 12, color: theme.fg2, fontFamily: FONT }}
                  >
                    {vatCount} {plural(vatCount, ["чек", "чека", "чеков"])} с
                    НДС
                  </div>
                </div>
              </div>
            )}
          </SectionCard>
        )}

        {/* По категориям */}
        <Donut
          title="По категориям"
          data={Object.entries(catMap).map(([name, d]) => ({ name, ...d }))}
          sliceColor={(d) => catColor(d.name).fg}
        />

        {/* 3 · Организации */}
        <Donut
          title="Организации"
          data={Object.entries(orgMap).map(([name, d]) => ({
            name: shortOrg(name),
            ...d,
          }))}
        />

        {/* 4 · Методы оплаты */}
        <Donut
          title="Методы оплаты"
          data={Object.entries(payMap).map(([name, d]) => ({ name, ...d }))}
        />

        {/* 5 · Сотрудники */}
        <SectionCard title="Сотрудники">
          {empData.map((d, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "11px 0",
                borderTop: i === 0 ? "none" : `1px solid ${theme.border}`,
              }}
            >
              <div
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: "50%",
                  background: theme.surfaceSunk,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <User
                  size={16}
                  color="#636B7D"
                  strokeWidth={2}
                  aria-hidden="true"
                />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 500,
                    color: C.dark,
                    fontFamily: FONT,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {d.name}
                </div>
                <div
                  style={{ fontSize: 12, color: "#636B7D", fontFamily: FONT }}
                >
                  {`${d.count} ${plural(d.count, ["чек", "чека", "чеков"])}`}
                </div>
              </div>
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: "#111318",
                  fontFamily: FONT,
                  fontVariantNumeric: "tabular-nums",
                  flexShrink: 0,
                }}
              >
                {money(d.value)}
              </span>
            </div>
          ))}
          {empData.length === 0 && (
            <div
              style={{
                fontSize: 12,
                color: theme.fg3,
                fontFamily: FONT,
                padding: "10px 0",
              }}
            >
              Нет данных за период
            </div>
          )}
        </SectionCard>
      </div>
      {showFilters && (
        <FiltersModal
          // S-28: секция «Сотрудник» рисуется только при переданном пропе
          // (hasEmp в FiltersModal). Рядовому сотруднику она не только лишняя,
          // но и бессмысленная: по A-ACL ему приходят только свои чеки, выбор
          // коллеги дал бы пустой экран. Так же гейтится фильтр на «Отчётах».
          employees={canApprove(role) ? users : undefined}
          selectedEmployee={selEmployee}
          catalog={catalog}
          cards={cards}
          selectedCats={cats}
          selectedCards={selCards}
          onApply={(r) => {
            setSelEmployee(r.employee);
            setCats(r.cats);
            setSelCards(r.cards);
          }}
          onReset={() => {
            setSelEmployee(null);
            setCats([]);
            setSelCards([]);
          }}
          onClose={() => setShowFilters(false)}
        />
      )}
    </div>
  );
}

function shortPayment(p) {
  if (!p) return "Не указано";
  if (p === "Корпоративная карта") return "Корп.карта";
  return p;
}

function SwipeableReceiptCard({ receipt, onClick, onDelete, автор }) {
  // ⚠️ ПОДПИСЬ ПРИХОДИТ ГОТОВОЙ, А НЕ СЧИТАЕТСЯ ЗДЕСЬ. Карточка не знает
  // ни списка людей, ни роли смотрящего — и не должна: показывать ли автора,
  // решает список (это зависит от роли), а как его назвать — общий модуль
  // `src/lib/people.js`. Иначе в карточке появилась бы третья копия правила.
  const [tx, setTx] = useState(0);
  const [drag, setDrag] = useState(false); // render-safe mirror of dragging.current (no transition while dragging)
  const startX = useRef(0);
  const startY = useRef(0);
  const dragging = useRef(false);
  const moved = useRef(false);
  const locked = useRef(null);

  const r = receipt;
  const col = catColorById(r);
  const REVEAL = 72;
  const dot = {
    width: 3,
    height: 3,
    borderRadius: "50%",
    background: "#9CA3AF",
    flexShrink: 0,
  };

  function onPointerDown(e) {
    dragging.current = true;
    setDrag(true);
    moved.current = false;
    locked.current = null;
    startX.current = e.clientX;
    startY.current = e.clientY;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e) {
    if (!dragging.current) return;
    const dx = e.clientX - startX.current;
    const dy = e.clientY - startY.current;
    if (locked.current === null) {
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
        locked.current = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      } else return;
    }
    if (locked.current !== "x") return;
    moved.current = true;
    const base = tx < 0 ? -REVEAL : 0;
    const next = Math.min(0, Math.max(-REVEAL, base + dx));
    setTx(next);
  }
  function onPointerUp() {
    if (!dragging.current) return;
    dragging.current = false;
    setDrag(false);
    if (locked.current === "x") {
      setTx(tx < -REVEAL / 2 ? -REVEAL : 0);
    }
  }
  function handleTap() {
    if (moved.current) return;
    if (tx < 0) {
      setTx(0);
      return;
    }
    onClick?.();
  }

  return (
    <div
      style={{
        position: "relative",
        background: "#B91C1C",
        overflow: "hidden",
        borderRadius: 12,
        boxShadow: "0 1px 3px rgba(17,19,24,.08)",
      }}
    >
      {/* ⚠️ У ДЕЙСТВИЯ ПОЯВИЛОСЬ ИМЯ. Раньше это был безымянный div с одной
          иконкой: скринридер о нём не сообщал вовсе, а сторож не мог его
          найти — удаление было доступно только зрячему пальцу. */}
      <div
        role="button"
        tabIndex={-1}
        aria-label="Удалить чек"
        onClick={onDelete}
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          width: REVEAL,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
        }}
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#fff"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
          <path d="M10 11v6M14 11v6" />
          <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
        </svg>
      </div>
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={handleTap}
        style={{
          background: theme.surface,
          padding: "14px 16px",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
          transform: `translateX(${tx}px)`,
          transition: drag ? "none" : "transform 0.2s ease",
          cursor: "pointer",
          userSelect: "none",
          touchAction: "pan-y",
        }}
      >
        {/* left — название + строка (дата · оплата)

            ПОЛ 148px. Без него на узком экране длинная пилюля категории
            («Представительские расходы») забирала всю строку, и мете
            оставалось 44px из нужных ~143: сначала пропадали цифры карты,
            а следом СРЕЗАЛОСЬ ПОЛОВИНОЙ ИКОНКОЙ — на экране торчал огрызок
            в пару пикселей. Поймано прогоном вёрстки 06.08.2026
            («срезан предком: −14px svg ← режет span «3950»», 8 случаев @320).
            Число выведено замером, а не прикидкой: при поле 131 цифрам
            доставалось 21.8px из 34.5, при 140 — 30.8, целиком «3950»
            встаёт с 148. Состав: дата 66 + зазор 6 + точка 3 + зазор 6 +
            иконка 14 + зазор 4 + цифры 34.5.
            Родня: тот же пол (152) стоит на «Главной» по тем же причинам. */}
        <div
          style={{
            flex: 1,
            minWidth: 148,
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          <span
            style={{
              fontSize: 15,
              fontWeight: 500,
              fontFamily: FONT,
              color: C.dark,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {shortOrg(r.org)}
          </span>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 13,
              color: "#636B7D",
              fontFamily: FONT,
              fontVariantNumeric: "tabular-nums",
              minWidth: 0,
              whiteSpace: "nowrap",
            }}
          >
            <span style={{ flexShrink: 0 }}>{fmtDate(r.date)}</span>
            {/* ⚠️ АВТОР — ТОЛЬКО ТЕМ, КТО ВИДИТ ЧУЖИЕ ЧЕКИ (решение владельца
                04.09.2026, тот же приём, что в списке отчётов). У сотрудника
                список и так свой: столбец с одним повторяющимся именем —
                шум. Пустую строку не рисуем вовсе, поэтому и разделителя
                перед ней нет. */}
            {автор ? (
              <>
                <span style={dot} />
                <span
                  style={{
                    flexShrink: 1,
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {автор}
                </span>
              </>
            ) : null}
            <span style={dot} />
            {/* Способ оплаты — как в макете: иконка карты (или купюр
                для наличных) и последние четыре цифры. Имя карты в списке
                не показываем, оно остаётся в деталях чека.
                ИСТОЧНИК ЧЕКА («ФНС», «QR», «Фото», «Вручную») УБРАН: этого
                элемента в макете нет вовсе. Вместе с ним стала не нужна
                механика «узкой карточки» (useNarrowCard, порог 309px) —
                она существовала только ради него. */}
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                minWidth: 0,
                overflow: "hidden",
              }}
            >
              {isCash(r) ? (
                <Banknote
                  size={14}
                  color={theme.fg2}
                  strokeWidth={2}
                  style={{ flexShrink: 0 }}
                />
              ) : (
                <CreditCard
                  size={14}
                  color={theme.fg2}
                  strokeWidth={2}
                  style={{ flexShrink: 0 }}
                />
              )}
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  minWidth: 0,
                }}
              >
                {paymentShort(r)}
              </span>
            </span>
          </div>
        </div>
        {/* right — сумма и под ней пилюля категории, как в макете
            templates/receipts/Чеки.html: `.right` = колонка, align-items
            flex-end, gap 7, flex-shrink 0; пилюля 12px/500, padding 5×10,
            radius 999, nowrap.
            ВОЗВРАТ К МАКЕТУ (05.08): 02.08 пилюля была уведена в левую
            колонку (7e0cbe8), чтобы правые 56px карточки не несли читаемого —
            они лежат под плавающей кнопкой. Кнопка на месте, значит
            перекрытие пилюли вернётся вместе с ней; это осознанный размен
            в пользу канона, а не недосмотр. Задача про кнопку — UX-FAB.
            КОЛОНКА ТЕПЕРЬ СЖИМАЕТСЯ (flexShrink:1 + minWidth:0), и вместе
            с этим вернулись maxWidth/overflow/ellipsis у пилюли: раньше их
            сняли справедливо — в НЕсжимаемой колонке maxWidth:100% ограничивал
            элемент его же шириной и не значил ничего. Порядок уступки такой:
            сумма не жертвует ничем (flexShrink:0, это главное число строки),
            уступает пилюля — она усекается многоточием. В макете усечения нет,
            потому что там ширина 402 и категории короткие («Питание»); наши
            («Представительские расходы») длиннее макетных, и это ровно тот
            случай, когда вёрстку под ширину подгонять можно. */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: 7,
            flexShrink: 1,
            minWidth: 0,
          }}
        >
          <span
            style={{
              fontSize: 15,
              fontWeight: 600,
              fontFamily: FONT,
              color: C.dark,
              fontVariantNumeric: "tabular-nums",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            {money(r.amount)}
          </span>
          <span
            style={{
              fontSize: 12,
              fontWeight: 500,
              fontFamily: FONT,
              padding: "5px 10px",
              borderRadius: 999,
              background: col.bg,
              color: col.fg,
              whiteSpace: "nowrap",
              maxWidth: "100%",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {catName(r)}
          </span>
        </div>
      </div>
    </div>
  );
}

function FiltersModal({
  dateBuilder,
  from,
  to,
  employees,
  selectedEmployee,
  catalog,
  selectedCats,
  cards,
  selectedCards,
  sources,
  // Диапазон суммы {from, to}. Секция рисуется ТОЛЬКО при переданном
  // пропе, как и остальные: «Чеки» и «Сводка» его не передают,
  // «Отчёты» передают. Отдельный компонент фильтров не заводим —
  // это была бы вторая копия того же самого (решение 05.08).
  amount,
  onApply,
  onReset,
  onClose,
}) {
  const hasEmp = employees !== undefined;
  const hasCats = catalog != null && Array.isArray(catalog.groups);
  const hasCards = cards !== undefined;
  const hasSource = sources !== undefined;
  const hasAmount = amount !== undefined;

  const [pFrom, setPFrom] = useState(from || monthStartISO());
  const [pTo, setPTo] = useState(to || todayISO());
  const [selEmp, setSelEmp] = useState(selectedEmployee || null);
  const [selCats, setSelCats] = useState(selectedCats || []);
  const [selCards, setSelCards] = useState(selectedCards || []);
  const [selSources, setSelSources] = useState(sources || []);
  const [amtFrom, setAmtFrom] = useState(amount?.from ?? "");
  const [amtTo, setAmtTo] = useState(amount?.to ?? "");
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const toggleIn = (arr, setArr, val) => {
    if (val === null) {
      setArr([]);
      return;
    }
    setArr((prev) =>
      prev.includes(val) ? prev.filter((x) => x !== val) : [...prev, val],
    );
  };
  const isOn = (arr, val) =>
    val === null ? arr.length === 0 : arr.includes(val);

  // D1: двухуровневый фильтр категорий — группа разворачивается, чекбоксы на статьях,
  // «вся группа» одним тапом (вкл/выкл все имена статей группы). selCats = имена статей.
  const [expandedGroups, setExpandedGroups] = useState([]);
  const toggleExpand = (id) =>
    setExpandedGroups((p) =>
      p.includes(id) ? p.filter((x) => x !== id) : [...p, id],
    );
  const toggleGroupAll = (names) => {
    const allOn = names.length > 0 && names.every((n) => selCats.includes(n));
    setSelCats((prev) =>
      allOn
        ? prev.filter((n) => !names.includes(n))
        : [...new Set([...prev, ...names])],
    );
  };

  const inputStyle = {
    width: "100%",
    padding: "10px 12px",
    border: `1px solid ${theme.border}`,
    borderRadius: 8,
    fontSize: 16 /* T138 */,
    fontFamily: FONT,
    color: C.dark,
    background: theme.surface,
    boxSizing: "border-box",
  };
  const labelStyle = {
    fontSize: 11,
    color: theme.fg2,
    fontFamily: FONT,
    marginBottom: 8,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
  };
  const chip = (on) => ({
    padding: "6px 12px",
    border: "none",
    borderRadius: 8,
    cursor: "pointer",
    fontFamily: FONT,
    fontSize: 12,
    fontWeight: on ? 600 : 500,
    background: on ? "#A4161A" : "#EEF0F4",
    color: on ? "#fff" : "#636B7D",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
  });

  const cardNames = hasCards ? cards.map((c) => c.name).concat("Наличные") : [];

  const EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
  const close = () => {
    setShown(false);
    setTimeout(onClose, 220);
  }; // play exit, then unmount
  const apply = () => {
    onApply({
      from: pFrom,
      to: pTo,
      employee: selEmp,
      cats: selCats,
      cards: selCards,
      sources: selSources,
      // Пустая строка = «не задано», а не ноль: иначе «от 0» стало бы
      // условием, которое ничего не отсекает, но выглядит заданным.
      amountFrom: amtFrom === "" ? null : Number(amtFrom),
      amountTo: amtTo === "" ? null : Number(amtTo),
    });
    close();
  };
  const reset = () => {
    onReset();
    close();
  };

  const dialogRef = useModalA11y(close);

  return (
    <div
      onClick={close}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.3)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        zIndex: 120,
        opacity: shown ? 1 : 0,
        transition: `opacity ${shown ? 280 : 220}ms ease`,
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Фильтры"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: theme.surface,
          width: "100%",
          maxWidth: 480,
          borderRadius: "16px 16px 0 0",
          display: "flex",
          flexDirection: "column",
          maxHeight: "88dvh",
          paddingBottom: "env(safe-area-inset-bottom)",
          transform: shown ? "translateY(0)" : "translateY(100%)",
          transition: `transform ${shown ? 280 : 220}ms ${EASE}`,
          outline: "none",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            padding: "8px 0 2px",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              width: 36,
              height: 4,
              borderRadius: 2,
              background: "#D7DAE0",
            }}
          />
        </div>
        <div
          style={{
            padding: "4px 16px 12px",
            borderBottom: `1px solid ${theme.border}`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontSize: 15,
              fontFamily: FONT,
              color: C.dark,
              fontWeight: 600,
            }}
          >
            Фильтры
          </span>
          <button
            type="button"
            onClick={close}
            aria-label="Закрыть"
            style={{
              border: "none",
              background: "none",
              color: theme.fg2,
              fontSize: 18,
              cursor: "pointer",
            }}
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>
        <div
          style={{
            padding: "16px",
            overflow: "auto",
            flex: 1,
            display: "flex",
            flexDirection: "column",
            gap: 18,
          }}
        >
          {dateBuilder && (
            <div>
              <div style={labelStyle}>Период</div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 10,
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: 10,
                      color: theme.fg2,
                      fontFamily: FONT,
                      marginBottom: 4,
                    }}
                  >
                    От
                  </div>
                  <input
                    type="date"
                    value={pFrom}
                    onChange={(e) => setPFrom(e.target.value)}
                    aria-label="Период: дата от"
                    style={inputStyle}
                  />
                </div>
                <div>
                  <div
                    style={{
                      fontSize: 10,
                      color: theme.fg2,
                      fontFamily: FONT,
                      marginBottom: 4,
                    }}
                  >
                    До
                  </div>
                  <input
                    type="date"
                    value={pTo}
                    onChange={(e) => setPTo(e.target.value)}
                    aria-label="Период: дата до"
                    style={inputStyle}
                  />
                </div>
              </div>
            </div>
          )}

          {hasAmount && (
            <div>
              <div style={labelStyle}>Сумма, ₽</div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)",
                  gap: 10,
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: 10,
                      color: theme.fg2,
                      fontFamily: FONT,
                      marginBottom: 4,
                    }}
                  >
                    От
                  </div>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    value={amtFrom}
                    onChange={(e) => setAmtFrom(e.target.value)}
                    aria-label="Сумма: от"
                    placeholder="0"
                    style={inputStyle}
                  />
                </div>
                <div>
                  <div
                    style={{
                      fontSize: 10,
                      color: theme.fg2,
                      fontFamily: FONT,
                      marginBottom: 4,
                    }}
                  >
                    До
                  </div>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    value={amtTo}
                    onChange={(e) => setAmtTo(e.target.value)}
                    aria-label="Сумма: до"
                    placeholder="без предела"
                    style={inputStyle}
                  />
                </div>
              </div>
            </div>
          )}

          {hasEmp && (
            <div>
              <div style={labelStyle}>Сотрудник</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {[
                  ["Все сотрудники", null],
                  ...employees.map((u) => [полноеИмя(u), полноеИмя(u)]),
                ].map(([label, val]) => (
                  <button
                    key={val || "all"}
                    onClick={() => setSelEmp(val)}
                    style={chip(val === null ? !selEmp : selEmp === val)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {hasCats && (
            <div>
              <div style={labelStyle}>Категория</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div>
                  <button
                    onClick={() => setSelCats([])}
                    style={chip(selCats.length === 0)}
                  >
                    Все
                  </button>
                </div>
                {catalog.groups.map((g) => {
                  const names = (g.categories || []).map((c) => c.name);
                  const allOn =
                    names.length > 0 && names.every((n) => selCats.includes(n));
                  const someOn =
                    !allOn && names.some((n) => selCats.includes(n));
                  const col = groupColor(g.name);
                  const expanded = expandedGroups.includes(g.id);
                  return (
                    <div
                      key={g.id}
                      style={{
                        border: `1px solid ${theme.border}`,
                        borderRadius: 10,
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          padding: "8px 10px",
                        }}
                      >
                        <button
                          onClick={() => toggleGroupAll(names)}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            flex: 1,
                            border: "none",
                            background: "none",
                            cursor: "pointer",
                            textAlign: "left",
                            padding: 0,
                          }}
                        >
                          <span
                            style={{
                              width: 18,
                              height: 18,
                              borderRadius: 5,
                              border: `1.5px solid ${
                                allOn || someOn ? col.fg : theme.border
                              }`,
                              background: allOn
                                ? col.fg
                                : someOn
                                  ? col.bg
                                  : theme.surface,
                              color: allOn ? "#fff" : col.fg,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              flexShrink: 0,
                              fontSize: 12,
                              fontWeight: 700,
                            }}
                          >
                            {allOn ? "✓" : someOn ? "–" : ""}
                          </span>
                          <span
                            style={{
                              fontSize: 13,
                              fontFamily: FONT,
                              color: C.dark,
                              fontWeight: 600,
                            }}
                          >
                            {g.name}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleExpand(g.id)}
                          aria-label={
                            expanded ? "Свернуть группу" : "Развернуть группу"
                          }
                          style={{
                            border: "none",
                            background: "none",
                            cursor: "pointer",
                            color: theme.fg2,
                            fontSize: 16,
                            padding: "2px 6px",
                            transform: expanded ? "rotate(90deg)" : "none",
                            transition: "transform 0.15s",
                          }}
                        >
                          <span aria-hidden="true">›</span>
                        </button>
                      </div>
                      {expanded && (
                        <div
                          style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: 6,
                            padding: "0 10px 10px 36px",
                          }}
                        >
                          {(g.categories || []).map((c) => (
                            <button
                              key={c.id}
                              onClick={() =>
                                toggleIn(selCats, setSelCats, c.name)
                              }
                              style={chip(selCats.includes(c.name))}
                            >
                              {c.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {hasCards && (
            <div>
              <div style={labelStyle}>Карта</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {[
                  ["Все", null],
                  ...cardNames.map((n) => [shortPayment(n), n]),
                ].map(([label, val]) => (
                  <button
                    key={val || "all"}
                    onClick={() => toggleIn(selCards, setSelCards, val)}
                    style={chip(isOn(selCards, val))}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {hasSource && (
            <div>
              <div style={labelStyle}>Источник</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {[
                  ["Все", null],
                  ["ФНС", "fns"],
                  ["QR", "qr_scan"],
                  ["Фото", "photo_ocr"],
                  ["Вручную", "manual"],
                ].map(([label, val]) => (
                  <button
                    key={label}
                    onClick={() => toggleIn(selSources, setSelSources, val)}
                    style={chip(isOn(selSources, val))}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <div
          style={{
            padding: "12px 16px",
            display: "flex",
            gap: 8,
            borderTop: `1px solid ${theme.border}`,
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            onClick={reset}
            title="Сбросить"
            aria-label="Сбросить"
            style={{
              width: 44,
              height: 44,
              border: `1px solid ${theme.border}`,
              background: theme.surface,
              color: theme.fg2,
              cursor: "pointer",
              borderRadius: 10,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="1 4 1 10 7 10" />
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
            </svg>
          </button>
          <button
            onClick={apply}
            style={{
              flex: 1,
              padding: "12px",
              background: theme.cherry,
              border: "none",
              fontFamily: FONT,
              fontSize: 13,
              color: theme.surface,
              cursor: "pointer",
              borderRadius: 10,
              fontWeight: 600,
              letterSpacing: "0.04em",
            }}
          >
            Применить
          </button>
        </div>
      </div>
    </div>
  );
}

function FilterIcon({ active, onClick }) {
  // ПО МАКЕТУ: простая иконка `SlidersHorizontal` 20px в ряду действий,
  // без плашки и фона. Раньше это был квадрат 38×38 с заливкой #EEF0F4,
  // скруглением 10 и самодельной svg 16px внутри — расхождение и по виду,
  // и по размеру (38 против 20). Активное состояние показываем цветом,
  // как у иконки поиска: вишнёвый вместо серого.
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Фильтры"
      aria-pressed={active}
      style={{
        background: "none",
        border: "none",
        padding: 0,
        cursor: "pointer",
        display: "flex",
      }}
    >
      <SlidersHorizontal size={20} color={active ? theme.cherry : theme.fg2} />
    </button>
  );
}

function Toast({ toast }) {
  if (!toast) return null;
  const palette = {
    success: { bg: "#F0FDF4", fg: "#15803D", bd: "#BBF7D0" },
    warning: { bg: "#FFFBEB", fg: "#B45309", bd: "#FDE68A" },
    error: { bg: "#FEF2F2", fg: "#B91C1C", bd: "#FECACA" },
  }[toast.type] || { bg: "#F0FDF4", fg: "#15803D", bd: "#BBF7D0" };
  return (
    <div
      style={{
        position: "fixed",
        // ⚠️ НИЖЕ ШАПКИ, А НЕ ПОВЕРХ НЕЁ (замер владельца по снимку 05.09.2026,
        // iPhone): плашка закрывала собой заголовок раздела и переключатель
        // приложений — человек читал отказ и терял, где находится. 64px —
        // высота шапки Тип-2: safe-area + 10px отступа сверху, 44px кнопок,
        // 10px снизу. Сторож `npm run delete` требует, чтобы прямоугольники
        // плашки и шапки не пересекались.
        top: "calc(env(safe-area-inset-top) + 64px)",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 200,
        background: palette.bg,
        border: `1px solid ${palette.bd}`,
        color: palette.fg,
        borderRadius: 10,
        padding: "10px 16px",
        fontFamily: FONT,
        fontSize: 12,
        fontWeight: 600,
        maxWidth: "90vw",
        textAlign: "center",
        boxShadow: "0 4px 14px rgba(0,0,0,0.12)",
      }}
    >
      {toast.message}
      {/* Действие в тосте — это ОТМЕНА только что сделанного: удаление уходит
          отложенным запросом, и пока тост висит, его можно вернуть. Кнопка,
          а не ссылка: её жмут пальцем и находят скринридером. */}
      {toast.action && (
        <button
          type="button"
          onClick={toast.action.onClick}
          style={{
            marginLeft: 12,
            border: "none",
            background: "none",
            padding: 0,
            font: `700 12px/1 ${FONT}`,
            color: palette.fg,
            textDecoration: "underline",
            cursor: "pointer",
          }}
        >
          {toast.action.label}
        </button>
      )}
    </div>
  );
}

// Интерактивный sticky-баннер дублей (задача №9 фаза D): список всех похожих
// чеков (warning.duplicates) с чекбоксами и массовым удалением. Умные defaults:
// отмечены только deletable (kkt_fn IS NULL) и не в отчёте; ФНС/QR (deletable=
// false) и in_report — disabled с пометкой. force в UI всегда false (бэк защищает).
function DuplicateWarningBanner({ warning, onDelete, onClose }) {
  const dups = warning.duplicates || [];
  const high = warning.confidence === "high";
  const headOrg =
    (dups.find((d) => !d.is_new && d.org) || dups[0] || {}).org || "";

  // ── ЗАГОЛОВОК ПРИХОДИТ С СЕРВЕРА (№25, мера А) ─────────────────────
  //
  // ⚠️ ДО 29.08.2026 ПЛАШКА РИСОВАЛА СВОЙ ТЕКСТ, А `warning.message`
  // НЕ ЧИТАЛА ВОВСЕ — грепом по src/ ноль обращений. Бэкенд собирал
  // «Этот чек уже добавлен 2 августа — совпадают сумма и ИНН
  // поставщика», человек видел «Возможный дубль». Требование владельца
  // (текст с датой чека) было выполнено на сервере и не доходило
  // до экрана — и это было НЕЗАМЕТНО: тест проверял ответ API,
  // то есть то, чего никто не показывает.
  //
  // ⚠️ ДАТУ ЗНАЕТ ТОЛЬКО СЕРВЕР: он видит найденные чеки целиком, их
  // может быть несколько и с разными датами. Собирать текст здесь
  // значит завести вторую реализацию одного правила — тот же класс,
  // что T39.
  //
  // ⚠️ ЗАПАСНОЙ ТЕКСТ ОБЯЗАТЕЛЕН, требование владельца: старый бэкенд,
  // ошибка, пустое поле — плашка обязана сказать что-то осмысленное.
  // «Молчащее предупреждение хуже грубого».
  const заголовок =
    (typeof warning.message === "string" && warning.message.trim()) ||
    (high && headOrg ? `Возможный дубль чека «${headOrg}»` : "Возможный дубль");
  const [selected, setSelected] = useState(
    () =>
      new Set(dups.filter((d) => d.deletable && !d.in_report).map((d) => d.id)),
  );
  const [busy, setBusy] = useState(false);
  const toggle = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const count = selected.size;
  const submit = async () => {
    if (count === 0 || busy) return;
    setBusy(true);
    const ok = await onDelete([...selected]); // на успехе баннер размонтируется
    if (!ok) setBusy(false); // на ошибке — остаёмся, кнопка снова активна
  };
  const disabledBtn = count === 0 || busy;
  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 10,
        margin: "10px 16px 0",
        padding: "12px",
        background: "#FFFBEB",
        border: "1px solid #FDE68A",
        borderRadius: 8,
        fontFamily: FONT,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <AlertTriangle
          size={16}
          color="#B45309"
          strokeWidth={2}
          style={{ flexShrink: 0, marginTop: 1 }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#B45309" }}>
            {заголовок}
          </div>
          <div style={{ fontSize: 11, color: "#B45309", marginTop: 1 }}>
            Найдено {dups.length}{" "}
            {plural(dups.length, [
              "похожий чек",
              "похожих чека",
              "похожих чеков",
            ])}
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label="Закрыть"
          style={{
            background: "none",
            border: "none",
            padding: 0,
            color: "#B45309",
            fontSize: 16,
            lineHeight: 1,
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          ×
        </button>
      </div>
      <div
        style={{
          marginTop: 10,
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        {dups.map((d) => {
          const locked = !d.deletable || d.in_report;
          return (
            <label
              key={d.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 8px",
                background: theme.surface,
                border: `1px solid ${theme.border}`,
                borderRadius: 8,
                cursor: locked ? "default" : "pointer",
                opacity: locked ? 0.7 : 1,
              }}
            >
              <input
                type="checkbox"
                disabled={locked}
                checked={selected.has(d.id)}
                onChange={() => toggle(d.id)}
                aria-label="Выбрать дубликат"
                style={{
                  width: 16,
                  height: 16,
                  accentColor: theme.cherry,
                  cursor: locked ? "default" : "pointer",
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 600,
                  letterSpacing: "0.03em",
                  color: C.mid,
                  background: theme.surfaceSunk,
                  border: `1px solid ${theme.border}`,
                  borderRadius: 5,
                  padding: "1px 6px",
                  flexShrink: 0,
                }}
              >
                {SRC_LABEL[d.source] || d.source}
              </span>
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: 12,
                  color: C.dark,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {/* shortOrg: строка и без того плотная (источник · название ·
                    сумма · дата), сырое юрлицо вытесняло из неё всё остальное */}
                {(d.org ? shortOrg(d.org) + " · " : "") +
                  money(d.amount) +
                  " · " +
                  fmtDate(d.date)}
              </span>
              {d.is_new && (
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    color: "#B45309",
                    background: "#FFFBEB",
                    border: "1px solid #FDE68A",
                    borderRadius: 5,
                    padding: "1px 5px",
                    flexShrink: 0,
                  }}
                >
                  новый
                </span>
              )}
              {d.in_report && (
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 600,
                    color: "#6D28D9",
                    background: "#F5F3FF",
                    border: "1px solid #DDD6FE",
                    borderRadius: 5,
                    padding: "1px 5px",
                    flexShrink: 0,
                  }}
                >
                  В отчёте
                </span>
              )}
              {!d.deletable && (
                <Lock
                  size={13}
                  color={theme.fg2}
                  strokeWidth={2}
                  style={{ flexShrink: 0 }}
                />
              )}
            </label>
          );
        })}
      </div>
      <div
        style={{
          marginTop: 10,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <button
          onClick={submit}
          disabled={disabledBtn}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 14px",
            border: "none",
            borderRadius: 8,
            fontFamily: FONT,
            fontSize: 12,
            fontWeight: 700,
            cursor: disabledBtn ? "default" : "pointer",
            background: disabledBtn ? theme.border : theme.cherry,
            color: disabledBtn ? theme.fg2 : theme.surface,
          }}
        >
          <Trash2 size={14} strokeWidth={2} /> Удалить выбранные ({count})
        </button>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            padding: "8px 6px",
            color: C.mid,
            fontFamily: FONT,
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Закрыть
        </button>
      </div>
    </div>
  );
}

// Виды операции для поля n= в QR-строке (как в приложении ФНС).
const OP_TYPES = [
  { n: "1", label: "Приход" },
  { n: "2", label: "Возврат прихода" },
  { n: "3", label: "Расход" },
  { n: "4", label: "Возврат расхода" },
];

// Ручной ввод реквизитов чека (ФН/ФД/ФПД + сумма/дата+время/тип) с проверкой
// через ФНС. Собирает QR-строку (buildQRString) и прогоняет через тот же
// onVerify=handleCapture, что и скан: 'ok' → форма уже заполнена и открыта;
// иначе — фолбэк «записать без проверки» (source=manual).
function RequisitesSheet({ prefill, onClose, onVerify, onManualFallback }) {
  const now = new Date();
  const pad = (x) => String(x).padStart(2, "0");
  const [date, setDate] = useState(
    prefill?.date ||
      `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
  );
  const [time, setTime] = useState(
    `${pad(now.getHours())}:${pad(now.getMinutes())}`,
  );
  const [opType, setOpType] = useState(prefill?.type || "1");
  const [amount, setAmount] = useState(prefill?.amount || "");
  const [fn, setFn] = useState(prefill?.fn || "");
  const [fd, setFd] = useState(prefill?.fd || "");
  const [fpd, setFpd] = useState(prefill?.fpd || "");
  const [checking, setChecking] = useState(false);
  const [errMsg, setErrMsg] = useState(""); // сообщение фолбэка после неуспешной проверки
  const [showInfo, setShowInfo] = useState(false); // тултип ⓘ (молчит до тапа)
  const [nowMs] = useState(() => Date.now()); // «сейчас» на момент открытия формы — стабильно между рендерами

  const num = (v) => /^\d+([.,]\d+)?$/.test(String(v).trim());
  const fnDigits = fn.replace(/\D/g, "");
  const fnHint = fn && fnDigits.length !== 16; // не блокирует, только подсказка
  const future =
    date && time ? new Date(`${date}T${time}`).getTime() > nowMs : false;
  const canCheck = !!(
    date &&
    time &&
    num(amount) &&
    /^\d+$/.test(fn.trim()) &&
    /^\d+$/.test(fd.trim()) &&
    /^\d+$/.test(fpd.trim()) &&
    !future
  );

  async function check() {
    if (checking || !canCheck) return;
    setErrMsg("");
    setChecking(true);
    const qr = buildQRString({ date, time, amount, fn, fd, fpd, opType }); // fn/fd/fpd НЕ логируем
    let result;
    try {
      result = await onVerify(qr);
    } catch {
      result = "partial";
    }
    setChecking(false);
    if (result === "ok") {
      onClose();
      return;
    } // handleCapture уже открыл форму
    if (result === "rejected")
      setErrMsg(
        "Сервис проверки чеков не принял наш доступ. Чек здесь ни при чём — запишите без проверки и сообщите администратору.",
      );
    else if (result === "not_found")
      // ⚠️ ТЕКСТ ПЕРЕПИСАН 31.08.2026 ПО ЖИВОМУ СБОЮ ФНС. Код 5 «Нет
      // информации по чеку (прочее)» — самый частый ответ, и он приходит
      // на ЗАРЕГИСТРИРОВАННЫЕ чеки: владелец проверил два чека вручную на
      // сайте — они там есть, а по нашему запросу код 5. Значит прежний
      // текст «Чек не найден. Проверьте реквизиты» винил и чек, и человека,
      // а виновата задержка на стороне налоговой. Сотрудник, прочитав
      // «не найден», решает, что сломано приложение.
      setErrMsg(
        "Налоговая пока не отдаёт данные по чеку — так бывает, обычно в течение суток. Сохраните с фото: чек попадёт в отчёт, поля заполняются вручную.",
      );
    else if (result === "unavailable")
      setErrMsg(
        "Сервис ФНС временно недоступен. Попробуйте позже или запишите без проверки.",
      );
    else
      setErrMsg(
        "Не удалось проверить чек. Попробуйте снова или запишите без проверки.",
      );
  }

  const lbl = {
    // T139: подписи полей были трёх размеров (9/10/11) — сведены к 11,
    // это существующий размер из канонного диапазона 11–13.
    fontSize: 11,
    letterSpacing: "0.18em",
    textTransform: "uppercase",
    color: theme.fg2,
    fontFamily: FONT,
  };
  const inp = {
    width: "100%",
    border: "none",
    borderBottom: `1.5px solid ${theme.border}`,
    outline: "none",
    padding: "7px 0",
    fontSize: 16 /* T138: было 13 — Safari зумил при фокусе */,
    fontFamily: FONT,
    color: C.dark,
    background: "transparent",
    boxSizing: "border-box",
  };
  const amber = {
    marginTop: 6,
    padding: "6px 10px",
    background: "#FFFBEB",
    border: "1px solid #FDE68A",
    borderRadius: 8,
    fontFamily: FONT,
    fontSize: 11,
    color: "#B45309",
  };
  const fallbackBtn = {
    width: "100%",
    marginTop: 8,
    padding: "10px",
    background: "none",
    border: "none",
    fontFamily: FONT,
    fontSize: 12,
    color: theme.fg2,
    cursor: "pointer",
    textDecoration: "underline",
  };

  return (
    <Modal
      title="Ввести реквизиты"
      onClose={onClose}
      footer={
        <>
          {errMsg && (
            <div
              style={{
                marginBottom: 8,
                padding: "8px 12px",
                background: "#FEF2F2",
                border: "1px solid #FECACA",
                borderRadius: 8,
                fontFamily: FONT,
                fontSize: 12,
                color: "#B91C1C",
              }}
            >
              {errMsg}
            </div>
          )}
          <Btn full onClick={check} disabled={!canCheck} loading={checking}>
            {checking ? "Проверяем…" : "Проверить чек"}
          </Btn>
          <button
            onClick={() => onManualFallback({ date, amount })}
            style={fallbackBtn}
          >
            {errMsg
              ? "Записать без проверки"
              : "Чека нет в базе ФНС? Записать без проверки"}
          </button>
        </>
      }
    >
      <div style={{ paddingTop: 12 }}>
        {/* ПАРА «ДАТА / ВРЕМЯ»: пол 118px и перенос вместо переполнения.
            118 — ЗАМЕРЕННЫЙ собственный минимум поля ввода при 13px, а не
            подобранное число: сужая строку по шагам, оба поля упираются
            в 118 и дальше не сжимаются (208 → уже вылезают на 16.6px).
            Паре нужно 118+12+118 = 248, сейчас у неё 288 при экране 320 —
            ЗАПАС 40px, и сегодня НИЧЕГО НЕ ЛОМАЕТСЯ. Правка на будущее:
            станет теснее 248 (третье поле в строке, выросшие отступы шторки,
            экран уже 320) — пара переедет на две строки, каждое поле во всю
            ширину, вместо того чтобы вылезти за край.
            Почему не minWidth:0, как буквально просит сторож: поле ввода
            не умеет усекаться многоточием — при 128px строки дата сжалась бы
            до 58px и сегменты «08/06/2026» обрезались. Для текста лекарство
            есть, для input — нет. Задача T27. */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 12,
            marginBottom: 14,
          }}
        >
          <div style={{ flex: 1, minWidth: 118 }}>
            <div style={{ ...lbl, marginBottom: 4 }}>Дата</div>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              aria-label="Дата чека"
              style={inp}
            />
          </div>
          <div style={{ flex: 1, minWidth: 118 }}>
            <div style={{ ...lbl, marginBottom: 4 }}>Время</div>
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              aria-label="Время чека"
              style={inp}
            />
          </div>
        </div>
        {future && (
          <div style={{ ...amber, marginTop: -8, marginBottom: 12 }}>
            Дата и время чека не могут быть в будущем
          </div>
        )}

        <div style={{ marginBottom: 14 }}>
          <div style={{ ...lbl, marginBottom: 4 }}>Тип операции</div>
          <select
            value={opType}
            onChange={(e) => setOpType(e.target.value)}
            style={{ ...inp, appearance: "none", cursor: "pointer" }}
          >
            {OP_TYPES.map((o) => (
              <option key={o.n} value={o.n}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <RuleInput
          label="Итого, ₽"
          value={amount}
          onChange={setAmount}
          type="text"
          inputMode="decimal"
          placeholder="0.00"
        />

        <div style={{ marginBottom: 14 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              marginBottom: 4,
            }}
          >
            <span style={lbl}>ФН (фискальный накопитель)</span>
            <button
              onClick={() => setShowInfo((s) => !s)}
              aria-label="Подсказка"
              style={{
                width: 16,
                height: 16,
                borderRadius: "50%",
                border: `1px solid ${theme.fg3}`,
                background: "none",
                color: theme.fg2,
                fontSize: 11,
                lineHeight: 1,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                padding: 0,
              }}
            >
              i
            </button>
          </div>
          <input
            value={fn}
            onChange={(e) => setFn(e.target.value)}
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder="16 цифр"
            aria-label="ФН (фискальный накопитель)"
            style={inp}
          />
          {showInfo && (
            <div
              style={{
                marginTop: 6,
                padding: "8px 10px",
                background: theme.surfaceSunk,
                borderRadius: 8,
                fontFamily: FONT,
                fontSize: 11,
                color: C.mid,
                lineHeight: 1.5,
              }}
            >
              Эти числа напечатаны внизу чека, рядом с QR-кодом. ФН — фискальный
              накопитель (16 цифр), ФД — номер документа, ФПД — фискальный
              признак.
            </div>
          )}
          {fnHint && <div style={amber}>Обычно ФН — 16 цифр, проверьте</div>}
        </div>

        <RuleInput
          label="ФД № (фискальный документ)"
          value={fd}
          onChange={setFd}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          placeholder="например 12345"
        />
        <RuleInput
          label="ФПД (фискальный признак)"
          value={fpd}
          onChange={setFpd}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          placeholder="например 1234567890"
        />
      </div>
    </Modal>
  );
}

function OperaciiPage({
  scrollRef,
  сигналСканера, // плитка «Сканировать чек» с «Главной» (одноразовый)
  onScanSignalConsumed, // употребили — обнулить, иначе окно-призрак при возврате
  receipts,
  users, // для подписи автора: имя ищется по user_id (см. src/lib/people.js)
  cards,
  catalog,
  role, // ЧП5б: до деталей отчёта, открытых из карточки чека
  handleAdd,
  handleDelete,
  handleUpdate,
  handleRefreshReceipt,
  handleBulkDelete,
  activePeriod,
  setActivePeriod,
}) {
  const paymentOptions = [
    ...cards.map((c) => c.name),
    "Наличные",
    "Не указано",
  ];
  const [search, setSearch] = useState("");
  const [sources, setSources] = useState([]); // [] = «Все»
  const [cats, setCats] = useState([]); // выбранные категории, [] = «Все»
  const [selCards, setSelCards] = useState([]); // выбранные карты (по полю payment), [] = «Все»
  // ⚠️ ФИЛЬТРА «СОТРУДНИК» ЗДЕСЬ НЕ БЫЛО ВОВСЕ (замер владельца 04.09.2026,
  // iPhone/Safari): пункт завели только на «Сводке» ещё в c1a7bde, а на
  // экране, который человек открывает чаще всего, дотянуться до отбора по
  // автору было нельзя. Хранится ИМЯ (его человек выбирает в шторке),
  // решение принимается по `id` — перевод один, в src/lib/people.js.
  const [selEmp, setSelEmp] = useState(null);
  const selEmpId = идПоИмени(selEmp, users);
  const [showFilters, setShowFilters] = useState(false);
  const defaultFrom = "",
    defaultTo = "";
  const [dateFrom, setDateFrom] = useState(defaultFrom);
  const [dateTo, setDateTo] = useState(defaultTo);
  const [limit, setLimit] = useState(30);
  const [showSearch, setShowSearch] = useState(false); // поиск-иконка раскрывает поле
  const [showScan, setShowScan] = useState(false);
  // Сигнал с «Главной»: открыть сканер сразу — и ТУТ ЖЕ обнулить сигнал,
  // иначе эффект при следующем монтировании экрана откроет окно заново.
  useEffect(() => {
    if (!сигналСканера) return;
    const т = setTimeout(() => {
      setShowScan(true);
      if (onScanSignalConsumed) onScanSignalConsumed();
    }, 0);
    return () => clearTimeout(т);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [сигналСканера]);
  // Ширину меряем у КОНТЕЙНЕРА списка — одним наблюдателем на все строки.
  const fabHidden = useFabHidden(scrollRef);
  const [showAdd, setShowAdd] = useState(false);
  const [showReq, setShowReq] = useState(false); // экран ручного ввода реквизитов (проверка ФНС)
  const [reqPrefill, setReqPrefill] = useState(null); // парсинг QR при заходе с неудачного скана
  const [showCatSheet, setShowCatSheet] = useState(false); // D1: bottom-sheet выбора статьи
  const [detail, setDetail] = useState(null);
  // Чек, по которому спрашивают подтверждение удаления из списка.
  const [подтвердитьУдаление, setПодтвердитьУдаление] = useState(null);
  // Счётчик открытий карточки: ответ на перечитывание применяем, только если
  // с момента запроса не открыли другой чек и не закрыли карточку — иначе
  // поздний ответ подменил бы чужие данные или «воскресил» закрытую карточку.
  const detailReqRef = useRef(0);

  // Открыть карточку: сразу показываем строку из списка (мгновенно, без
  // спиннера), затем подменяем канонической формой с бэка. Список грузится
  // один раз за сессию, поэтому вычисляемые поля (in_report, report_title)
  // в нём протухают — например, если чек приложили к отчёту в другой вкладке.
  async function openDetail(r) {
    setDetail(r);
    const req = ++detailReqRef.current;
    // Ошибку/офлайн глотаем молча: на экране данные из списка, они не хуже.
    const norm = await handleRefreshReceipt(r.id);
    if (!norm) return;
    if (req !== detailReqRef.current) return; // открыли другой чек / закрыли
    setDetail(norm);
  }

  function closeDetail() {
    detailReqRef.current++; // обесцениваем ответ, если он ещё в полёте
    setDetail(null);
  }
  const [form, setForm] = useState({
    org: "",
    amount: "",
    category: "Не указано",
    payment: "Не указано",
    date: todayISO(),
    fn: "",
    raw_data: null,
    photo_key: null,
    source: "manual",
  });
  // null | "loading" | "ok" | "partial" | "ocr_unavailable" | "ocr_failed"
  // Три последних — РАЗНЫЕ причины, а не одна «не получилось» (S-54).
  const [fnsStatus, setFnsStatus] = useState(null);
  const [fnsПричина, setFnsПричина] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false); // POST /receipts in flight — blocks double-submit
  const [addError, setAddError] = useState(""); // red banner above the submit button
  const [dupId, setDupId] = useState(null); // on 409: id of the receipt that already exists
  const [dupWarning, setDupWarning] = useState(null); // on 200+warning: дубль(и) (задача №9)
  const [toast, setToast] = useState(null); // {type,message,duration} — уведомление
  // Баннер дубля теперь sticky без авто-скрытия (фаза D). Авто-скрываем только
  // toast; cleanup снимает таймер при смене сообщения/размонтировании страницы.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.duration || 3000);
    return () => clearTimeout(t);
  }, [toast]);
  // In-flight FNS prefetch keyed by qrText, started the instant the modal
  // captures a QR (before the user taps "Загрузить чек"). By the time the
  // user confirms, the network round-trip is usually already done.
  const fnsPrefetchRef = useRef({ qrText: null, promise: null });

  async function _fetchFns(qrText) {
    // Surface the HTTP status so callers can tell ok (200) / not_found (404) /
    // unavailable (503) apart. httpStatus 0 = transport failure → unavailable.
    try {
      const res = await authFetch(`/api/fns/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qr_raw: qrText }),
      });
      const body = await res.json().catch(() => null);
      return { httpStatus: res.status, body };
    } catch {
      /* network failure or timeout */
    }
    return { httpStatus: 0, body: null };
  }

  // Called by the modal as soon as it captures a QR. Fire-and-forget — the
  // result is consumed later by handleCapture via the shared ref.
  function prefetchFns(qrText) {
    if (!qrText) return;
    if (
      fnsPrefetchRef.current.qrText === qrText &&
      fnsPrefetchRef.current.promise
    )
      return;
    fnsPrefetchRef.current = { qrText, promise: _fetchFns(qrText) };
  }

  async function _suggestPayment(org) {
    if (!org) return null;
    try {
      const sres = await authFetch(
        `/api/receipts/suggest-payment?org=${encodeURIComponent(org)}`,
      );
      if (sres.ok) {
        const sd = await sres.json();
        return sd.payment || null;
      }
    } catch {
      /* ignored */
    }
    return null;
  }

  // Two-phase contract with ScanReceiptModal:
  //   1. Modal captures the QR locally, calls prefetchFns(), shows preview.
  //   2. User confirms → modal calls handleCapture(qrText) → we await the
  //      prefetched FNS promise (or start one fresh as fallback).
  //      Return 'ok' → modal closes itself, form is already open with full data.
  //      Return 'partial' → modal switches to its own error screen; user can
  //      rescan, fall back to OCR (handleOcrFile), or manual (handleManual).
  async function handleCapture(qrText) {
    const parsed = parseQRString(qrText);
    // Prefill form from local QR parse — reliable even when FNS fails.
    setForm((p) => ({
      ...p,
      date: parsed.date || p.date,
      amount: parsed.amount ? moneyInput(parsed.amount) : "",
      org: "",
      category: "Не указано",
      fn: parsed.fn || "",
      raw_data: null,
      photo_key: null,
      source: "qr_scan",
    }));
    setFnsStatus("loading");

    let d;
    if (
      fnsPrefetchRef.current.qrText === qrText &&
      fnsPrefetchRef.current.promise
    ) {
      d = await fnsPrefetchRef.current.promise;
    } else {
      d = await _fetchFns(qrText);
    }
    fnsPrefetchRef.current = { qrText: null, promise: null };

    // Distinguish the FNS outcomes by HTTP status (see fns.py): 404 not_found,
    // 503/0 unavailable, anything else without an ok body → partial.
    const { httpStatus, body } = d || {};
    // ⚠️ ПРИЧИНА ЗАПОМИНАЕТСЯ ОТДЕЛЬНО ОТ `fnsStatus`. Блокер 31.08.2026:
    // три разные беды — чек не найден, сервис недоступен, сервис отказал НАМ —
    // сводились к одной плашке «Данные из ФНС не загрузились». По ней нельзя
    // отличить «виноват чек» от «виноват наш ключ», и владелец полдня искал
    // не там. Плашка теперь называет причину.
    if (httpStatus === 502) {
      setFnsПричина("rejected");
      setFnsStatus("partial");
      return "rejected";
    }
    if (httpStatus === 404) {
      setFnsПричина("not_found");
      setFnsStatus("partial");
      return "not_found";
    }
    if (httpStatus === 503 || httpStatus === 0) {
      setFnsПричина("unavailable");
      setFnsStatus("partial");
      return "unavailable";
    }
    if (httpStatus !== 200 || !body || body.status !== "ok" || !body.org) {
      setFnsStatus("partial");
      return "partial";
    }

    const raw = body.raw || {};
    const cash = Number(raw.cashTotalSum) || 0;
    const card = Number(raw.ecashTotalSum) || 0;
    const suggested = await _suggestPayment(body.org);
    const defaultCard = cards.find((c) => c.is_default)?.name || null;
    let payment = "Не указано";
    // T153 Ⓐ: «Наличные» приходят из СУММ ЧЕКА — это факт. Какая ИМЕННО
    // карта — угадывание (личная история у продавца, иначе карта по
    // умолчанию), и угадывание обязано быть ПОДПИСАНО на форме, а не
    // выбрано тихо: владелец платил личной, форма молча ставила корпоративную.
    let paymentGuessed = false;
    if (cash > 0 && card === 0) payment = "Наличные";
    else if (card > 0 && cash === 0) {
      payment =
        suggested && suggested !== "Наличные"
          ? suggested
          : defaultCard || "Не указано";
      paymentGuessed = payment !== "Не указано";
    } else if (suggested) {
      payment = suggested;
      paymentGuessed = true;
    }

    setForm((p) => ({
      ...p,
      org: body.org || p.org,
      amount: body.total ? moneyInput(body.total) : p.amount,
      category: body.category || p.category,
      raw_data: body.raw || body,
      payment,
      paymentGuessed,
    }));
    setShowAdd(true);
    setFnsStatus("ok");
    setTimeout(() => setFnsStatus((s) => (s === "ok" ? null : s)), 1500);
    return "ok";
  }

  // OCR fallback: when FNS comes back partial, the modal offers a "Распознать
  // фото" button → file picker → this handler. Returns 'ok'/'partial' with the
  // same contract as handleCapture, so the modal closes itself on success.
  async function handleOcrFile(file) {
    if (!file) return "partial";
    setFnsStatus("loading");
    const fd = new FormData();
    fd.append("file", file);
    let d = null;
    try {
      // Vision OCR is slower than the FNS/payment calls — allow 20s.
      const res = await authFetch(
        `/api/receipts/ocr/`,
        { method: "POST", body: fd },
        20000,
      );
      if (res.ok) d = await res.json().catch(() => null);
    } catch {
      /* network or timeout */
    }

    if (!d || !d.org || d.amount == null) {
      // ПРИЧИНА, а не общее «не получилось» (S-54). Бэкенд отдаёт её полем
      // reason; старый ответ без поля трактуем как неудачу разбора — мы
      // в ветке распознавания фото, и ФНС здесь ни при чём.
      const причина =
        d?.reason === "ocr_unavailable" ? "ocr_unavailable" : "ocr_failed";
      setFnsStatus(причина);
      if (причина === "ocr_unavailable") {
        // Распознавать нечем — ведём человека к ручному вводу СРАЗУ, а не
        // оставляем на экране предпросмотра с предложением повторить.
        setShowScan(false);
        setForm((p) => ({
          ...p,
          raw_data: null,
          photo_key: null,
          source: "manual",
        }));
        setShowAdd(true);
      }
      return причина;
    }

    const suggested = await _suggestPayment(d.org);
    const defaultCard = cards.find((c) => c.is_default)?.name || null;
    let payment = "Не указано";
    let paymentGuessed = false; // T153 Ⓐ — как в QR-пути
    if (d.payment_type === "cash") payment = "Наличные";
    else if (d.payment_type === "card") {
      payment =
        suggested && suggested !== "Наличные"
          ? suggested
          : defaultCard || "Не указано";
      paymentGuessed = payment !== "Не указано";
    } else if (suggested) {
      payment = suggested;
      paymentGuessed = true;
    }

    // СНИМОК ТЕПЕРЬ ЖИВЁТ В ХРАНИЛИЩЕ, А НЕ В ЧЕКЕ (задача №3).
    // Ручка OCR отдаёт ключ объекта отдельным полем; в raw_data ему не место —
    // бэкенд читает photo_key с ВЕРХНЕГО уровня тела запроса, и ключ, забытый
    // внутри raw_data, до колонки не доедет. Ровно на этом чуть не сорвался
    // замер: снимок лежал бы в бакете, а чек на него не ссылался.
    // photo_base64 из ответа тоже убираем: пока хранилище не настроено, ручка
    // его ещё возвращает, и без вычистки он снова осел бы в базе — то есть
    // ровно то, ради чего задача и затеяна.
    // reason — служебное поле ОТВЕТА (S-54), в чек ему не место: бэкенд
    // читает тело запроса, и лишний ключ уехал бы в базу. Та же ловушка,
    // что с photo_key в задаче №3.
    const { photo_key, photo_saved, ...receiptData } = d;
    delete receiptData.photo_base64;
    delete receiptData.reason;
    // ПРЕДУПРЕЖДЕНИЯ РАСПОЗНАВАНИЯ ПОКАЗЫВАЛИСЬ НИКОМУ.
    // Бэкенд складывал их в d.warnings с самого начала (невалидный ИНН,
    // а с сегодня — неправдоподобная дата, строка 24), а фронт не читал это
    // поле ВООБЩЕ: греп по src/ давал ноль вхождений. Честный признак,
    // которого никто не видит, — то же самое, что его отсутствие.
    const notes = Array.isArray(d.warnings) ? d.warnings.filter(Boolean) : [];
    if (photo_saved === false) {
      // Отказ хранилища. Молчать нельзя: человек уверен, что фото приложено.
      // Тост — минимум, он исчезает сам; видимая метка на карточке чека
      // заведена внутри строки 18 трекера (дизайн, через Claude Design).
      notes.unshift("Чек сохраним, но фото приложить не удалось");
    }
    if (notes.length) {
      // Больше двух строк в тосте не читают — остальное считаем числом,
      // чтобы человек хотя бы знал, что замечаний больше.
      const shown = notes.slice(0, 2).join(" · ");
      const tail = notes.length > 2 ? ` (и ещё ${notes.length - 2})` : "";
      setToast({ type: "warning", message: shown + tail, duration: 6000 });
    }
    setForm((p) => ({
      ...p,
      org: d.org,
      amount: moneyInput(d.amount),
      date: d.date || p.date,
      category: d.category || "Не указано",
      fn: d.fn || p.fn,
      raw_data: receiptData,
      photo_key: photo_key || null,
      // ⚠️ ПРИЗНАК ДОКУМЕНТА, А НЕ РЕКВИЗИТ (№25, мера Б). Распознанные ФД
      // и ФПД едут отдельными полями и в карточке чека не показываются:
      // модель ошибается в цифре, и неверный реквизит в документе хуже
      // отсутствующего. Нужны они ровно для одного — узнать чек, который
      // сфотографировали второй раз, даже если вывеску модель прочла иначе
      // (живой случай 12.08.2026: один чек сохранён трижды).
      ocr_fd: d.ocr_fd || null,
      ocr_fpd: d.ocr_fpd || null,
      payment,
      paymentGuessed,
      source: "photo_ocr",
    }));
    setShowAdd(true);
    setFnsStatus("ok");
    setTimeout(() => setFnsStatus((s) => (s === "ok" ? null : s)), 1500);
    return "ok";
  }

  // «Ввести вручную» / «Заполнить вручную» → экран ввода реквизитов с проверкой ФНС.
  // qrText (опц.) — из фазы fnsError скана: префиллим реквизиты распарсенным QR,
  // чтобы пользователь дозаполнил только время и перепроверил.
  function handleManual(qrText) {
    setShowScan(false);
    setReqPrefill(qrText ? parseQRString(qrText) : null);
    setShowReq(true);
  }

  // Фолбэк «записать без проверки» из RequisitesSheet → старая форма «Добавить чек»,
  // source=manual, переносим введённые дату/сумму.
  function openManualForm(prefill) {
    setShowReq(false);
    setForm((p) => ({
      ...p,
      date: prefill?.date || p.date,
      amount: prefill?.amount || "",
      org: "",
      category: "Не указано",
      fn: "",
      raw_data: null,
      photo_key: null,
      source: "manual",
    }));
    setFnsStatus(null);
    setShowAdd(true);
  }

  const customFilterActive = dateFrom !== defaultFrom || dateTo !== defaultTo;
  const inDate = (r) => {
    if (customFilterActive)
      return (!dateFrom || r.date >= dateFrom) && (!dateTo || r.date <= dateTo);
    return inPeriod(r.date, activePeriod);
  };
  const filtered = receipts.filter((r) => {
    // ⚠️ СРАВНИВАЕМ АВТОРОВ, А НЕ СТРОКИ. Колонка `employee` пуста во всех
    // 88 чеках прода, поэтому отбор по имени давал бы пустой список всегда
    // (тот же дефект, что чинили на «Сводке» в 3d17843).
    if (selEmpId != null && r.user_id !== selEmpId) return false;
    if (cats.length > 0 && !cats.includes(catName(r))) return false;
    if (selCards.length > 0 && !selCards.includes(r.payment)) return false;
    if (sources.length > 0 && !sources.includes(r.source)) return false;
    if (!search) return inDate(r);
    const q = search.toLowerCase();
    return (
      (r.org.toLowerCase().includes(q) ||
        shortOrg(r.org).toLowerCase().includes(q)) &&
      inDate(r)
    );
  });
  const visible = filtered.slice(0, limit);
  const hiddenCount = filtered.length - limit;
  const filtersActive =
    customFilterActive ||
    !!selEmp ||
    cats.length > 0 ||
    selCards.length > 0 ||
    sources.length > 0;
  const resetFilters = () => {
    setDateFrom(defaultFrom);
    setDateTo(defaultTo);
    setSelEmp(null);
    setCats([]);
    setSelCards([]);
    setSources([]);
    setSearch("");
  };

  async function addR() {
    if (isSubmitting) return; // защита от двойного клика
    // Разбор ОДИН на форму: сравнение с пустотой по самой строке пропускало
    // пробел (строка из пробела истинна) и чек сохранялся с суммой 0.
    const amountNum = parseMoney(form.amount);
    if (!form.org || amountNum === null) {
      setAddError("Заполните организацию и сумму");
      return;
    }
    setIsSubmitting(true);
    setAddError("");
    setDupId(null);
    try {
      const payload = {
        date: form.date,
        org: form.org,
        category: form.category,
        payment: form.payment,
        // Разбор в parseMoney: клавиатура iOS даёт запятую или точку (зависит
        // от РЕГИОНА устройства, не от нас), а автозаполнение кладёт в поле уже
        // отформатированное «1 520,00» с неразрывным пробелом.
        amount: amountNum,
        source: form.source || "manual",
      };
      if (form.fn) payload.kkt_fn = form.fn; // form.fn — внутреннее имя инпута; шлём как kkt_fn (канон)
      // Признак документа для поиска повторного фото (№25, Б). Отдельные
      // поля, а не fd_num/fpd: те — реквизиты, и распознанной цифре в них
      // не место. Пустые не шлём — «не дубль» безобиднее выдумки.
      if (form.ocr_fd) payload.ocr_fd = form.ocr_fd;
      if (form.ocr_fpd) payload.ocr_fpd = form.ocr_fpd;
      if (form.raw_data) payload.raw_data = form.raw_data;
      // Ключ объекта — ВЕРХНИМ уровнем: бэкенд читает его отсюда, а не
      // из raw_data. Без этой строки снимок лежит в бакете, а чек на него
      // не ссылается — сирота с обоих концов.
      if (form.photo_key) payload.photo_key = form.photo_key;
      const res = await authFetch(`/api/receipts/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.status === 409) {
        const body = await res.json().catch(() => null);
        setDupId(body?.detail?.existing_id || null); // плашка предложит «Открыть» существующий
        setAddError("Этот чек уже добавлен");
        return;
      }
      if (!res.ok) {
        setAddError("Не удалось добавить чек. Попробуйте ещё раз");
        return;
      }
      // warning (мягкий дубль) идёт рядом с полями чека — вынимаем его, чтобы
      // не осело лишним полем на объекте в списке; чек добавляем без него.
      const { warning, ...receipt } = await res.json();
      handleAdd(receipt);
      setShowAdd(false);
      setForm({
        org: "",
        amount: "",
        category: "Не указано",
        payment: "Не указано",
        date: todayISO(),
        fn: "",
        raw_data: null,
        photo_key: null,
        source: "manual",
      });
      setFnsStatus(null);
      setAddError("");
      setDupId(null);
      setDupWarning(warning || null);
    } catch {
      setAddError("Не удалось добавить чек. Проверьте интернет");
    } finally {
      setIsSubmitting(false);
    }
  }

  // From the 409 banner: jump to the receipt that already exists.
  async function openDup() {
    if (!dupId) return;
    try {
      const er = await authFetch(`/api/receipts/${dupId}`);
      if (er.ok) {
        const ex = await er.json();
        handleAdd(ex);
        setShowAdd(false);
        setForm({
          org: "",
          amount: "",
          category: "Не указано",
          payment: "Не указано",
          date: todayISO(),
          fn: "",
          raw_data: null,
          photo_key: null,
          source: "manual",
        });
        setFnsStatus(null);
        setAddError("");
        setDupId(null);
        setDetail(каноничныйЧек(ex));
      }
    } catch {
      /* network — leave the banner as is */
    }
  }

  // Клик «Удалить выбранные» в баннере → bulk-delete + toast по результату.
  // Возвращает true (успех — баннер закрыт) / false (ошибка — баннер остаётся).
  async function deleteDuplicates(ids) {
    const body = await handleBulkDelete(ids, false);
    if (!body) {
      setToast({
        type: "error",
        message: "Не удалось удалить",
        duration: 4000,
      });
      return false;
    }
    setDupWarning(null);
    const nd = body.deleted.length;
    const blocked = [];
    if (body.blocked_in_report.length)
      blocked.push(`${body.blocked_in_report.length} в отчёте`);
    if (body.blocked_fns.length) blocked.push(`${body.blocked_fns.length} ФНС`);
    if (nd === 0)
      setToast({
        type: "warning",
        message: `Ничего не удалено: ${blocked.join(", ")}`,
        duration: 5000,
      });
    else if (blocked.length)
      setToast({
        type: "warning",
        message: `✓ Удалено ${nd} ${plural(nd, [
          "чек",
          "чека",
          "чеков",
        ])}. Заблокировано: ${blocked.join(", ")}`,
        duration: 5000,
      });
    else
      setToast({
        type: "success",
        message: `✓ Удалено ${nd} ${plural(nd, ["чек", "чека", "чеков"])}`,
        duration: 3000,
      });
    return true;
  }

  return (
    <div style={{ position: "relative" }}>
      <Toast toast={toast} />
      {dupWarning && (
        <DuplicateWarningBanner
          warning={dupWarning}
          onDelete={deleteDuplicates}
          onClose={() => setDupWarning(null)}
        />
      )}
      {/* TODO: ФНС «Мои чеки онлайн» — включить когда будет готова интеграция
      <TabBar tabs={["Чеки","Онлайн чеки"]} active={tab} onSelect={setTab}/> */}
      <div
        style={{
          background: theme.surface,
          borderBottom: `1px solid ${theme.border}`,
          padding: "10px 16px",
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        {/* UX-7: при заданном диапазоне «с/по» фильтр уходит в свою ветку
            и период НЕ применяется (см. inDate ниже). Раньше чип продолжал
            подсвечивать «Месяц» и выглядел рабочим — пользователь был уверен,
            что видит месяц, а видел диапазон. Из-за этого «Чеки» и «Сводка»
            молча показывали разное. Теперь капсула приглушена и под ней
            написан реальный диапазон; тап по любому чипу его сбрасывает
            (это уже делал onChange) и возвращает период. */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ opacity: customFilterActive ? 0.45 : 1 }}>
            <SegmentedControl
              segments={PERIOD_OPTIONS.map((o) => o.label)}
              active={periodLabel(activePeriod)}
              onChange={(l) => {
                setActivePeriod(periodKey(l));
                setDateFrom(defaultFrom);
                setDateTo(defaultTo);
              }}
            />
          </div>
          {customFilterActive && (
            <div
              style={{
                marginTop: 6,
                font: `500 11px/1.3 ${FONT}`,
                color: theme.warningFg,
              }}
            >
              Показан свой период: {dateFrom ? fmtDate(dateFrom) : "…"} —{" "}
              {dateTo ? fmtDate(dateTo) : "…"}. Тап по периоду сбросит его
            </div>
          )}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            onClick={() => setShowSearch((s) => !s)}
            aria-label="Поиск"
            style={{
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              display: "flex",
            }}
          >
            {/* Иконка одна на все экраны — lucide Search. Раньше здесь была
                своя svg (круг + линия): выглядела похоже, но это была вторая
                картинка, и при смене иконочного набора они бы разъехались. */}
            <Search size={20} color={showSearch ? theme.cherry : theme.fg2} />
          </button>
          <FilterIcon
            active={filtersActive}
            onClick={() => setShowFilters(true)}
          />
        </div>
      </div>
      {showSearch && (
        <div
          style={{
            /* ⚠️ ЭТАЛОН «Главной» (T142): без белого фона и рамки-подчёркивания,
               поле surfaceSunk 11/12, зазор 9. Было третьим видом из трёх:
               фон bg вместо surfaceSunk, отступы 8/12 и лишняя рамка 1px. */
            /* T142-воздух: низ 10 + верхние 12 списка = 22 до карточки.
               Было 22 здесь + 12 списка = 34 — поймано обходом С ДАННЫМИ:
               пустая проба соседа не видела (класс T151). */
            padding: "10px 16px 10px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              padding: "11px 12px",
              gap: 9,
              background: theme.surfaceSunk,
              borderRadius: 10,
            }}
          >
            <Search size={18} color={theme.fg3} aria-hidden="true" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск..."
              aria-label="Поиск по операциям"
              autoFocus
              style={{
                border: "none",
                outline: "none",
                flex: 1,
                minWidth: 0,
                background: "none",
                /* T144-эталон 40: прошивка input даёт 1px/1px — обнулено */
                padding: 0,
                /* T138: кегль 16 (Safari не зумит), строка ФИКСОМ 18px — полоса остаётся 40 */
                font: `400 16px/18px ${FONT}`,
                color: theme.fg1,
              }}
            />
          </div>
        </div>
      )}
      <div
        style={{
          padding: "12px 16px 88px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {visible.map((r) => (
          <SwipeableReceiptCard
            key={r.id}
            receipt={r}
            onClick={() => openDetail(r)}
            // ⚠️ ЖЕСТ НЕ ДЕЛАЕТ НЕОБРАТИМОГО (05.09.2026). Свайп срабатывает
            // легко и случайно, а удалял сразу: отказ сервера человек видел
            // уже ПОСЛЕ жеста. Теперь тот же вопрос, что и в карточке чека.
            onDelete={() => setПодтвердитьУдаление(r)}
            автор={canApprove(role) ? имяАвтора(r.user_id, users) : ""}
          />
        ))}
        {visible.length === 0 && (
          <div
            style={{
              textAlign: "center",
              padding: "56px 24px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 8,
            }}
          >
            <ReceiptText size={48} color="#EEF0F4" strokeWidth={1.5} />
            {filtersActive || search ? (
              <>
                <div
                  style={{ fontSize: 15, color: "#636B7D", fontFamily: FONT }}
                >
                  Ничего не найдено
                </div>
                <div
                  style={{ fontSize: 13, color: "#9CA3AF", fontFamily: FONT }}
                >
                  Попробуйте изменить фильтры
                </div>
                <button
                  onClick={resetFilters}
                  style={{
                    marginTop: 4,
                    background: "none",
                    border: "none",
                    color: theme.cherry,
                    fontFamily: FONT,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Сбросить фильтры
                </button>
              </>
            ) : (
              <>
                <div
                  style={{ fontSize: 15, color: "#636B7D", fontFamily: FONT }}
                >
                  Нет чеков за этот период
                </div>
                <div
                  style={{ fontSize: 13, color: "#9CA3AF", fontFamily: FONT }}
                >
                  Нажмите + чтобы добавить первый чек
                </div>
              </>
            )}
          </div>
        )}
        {hiddenCount > 0 && (
          <div style={{ padding: "14px 16px", textAlign: "center" }}>
            <button
              onClick={() => setLimit((l) => l + 30)}
              style={{
                padding: "10px 20px",
                border: `1px solid ${theme.border}`,
                background: theme.surface,
                color: theme.cherry,
                fontFamily: FONT,
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                borderRadius: 10,
                letterSpacing: "0.03em",
              }}
            >
              Показать ещё {Math.min(30, hiddenCount)} · осталось {hiddenCount}
            </button>
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={() => setShowScan(true)}
        aria-label="Добавить чек"
        style={{
          ...fabHiddenStyle(fabHidden),
          position: "fixed",
          // Слой ЯВНО: раньше его не было вовсе, и кнопка оказывалась под
          // оверлеями по случайности порядка в DOM, а не по правилу.
          // Диапазоны слоёв — в CLAUDE.md, раздел «Слои интерфейса».
          zIndex: 40,
          bottom: "calc(env(safe-area-inset-bottom) + 88px)",
          right: 16,
          width: 56,
          height: 56,
          background: theme.cherry,
          color: theme.surface,
          border: "none",
          fontSize: 20,
          cursor: "pointer",
          boxShadow: `0 2px 8px rgba(17,19,24,0.16)`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "50%",
        }}
      >
        <Plus size={26} aria-hidden="true" />
      </button>
      {showScan && (
        <ScanReceiptModal
          onClose={() => setShowScan(false)}
          onCapture={handleCapture}
          onPrefetch={prefetchFns}
          onOcrFile={handleOcrFile}
          onManual={handleManual}
        />
      )}
      {showReq && (
        <RequisitesSheet
          prefill={reqPrefill}
          onClose={() => setShowReq(false)}
          onVerify={handleCapture}
          onManualFallback={openManualForm}
        />
      )}
      {showFilters && (
        <FiltersModal
          dateBuilder
          from={dateFrom}
          to={dateTo}
          catalog={catalog}
          cards={cards}
          sources={sources}
          // Секция «Сотрудник» — только тем, кто видит чужие чеки; ровно тот
          // же приём, что в «Отчётах» и на «Сводке» (hasEmp в FiltersModal).
          // Сотруднику бэк отдаёт лишь его собственные чеки (A-ACL), выбор
          // коллеги дал бы ему пустой экран.
          employees={canApprove(role) ? users : undefined}
          selectedEmployee={selEmp}
          selectedCats={cats}
          selectedCards={selCards}
          onApply={(r) => {
            setDateFrom(r.from);
            setDateTo(r.to);
            setSelEmp(r.employee);
            setCats(r.cats);
            setSelCards(r.cards);
            setSources(r.sources);
          }}
          onReset={() => {
            setDateFrom(defaultFrom);
            setDateTo(defaultTo);
            setSelEmp(null);
            setCats([]);
            setSelCards([]);
            setSources([]);
          }}
          onClose={() => setShowFilters(false)}
        />
      )}
      {подтвердитьУдаление && (
        <ConfirmDeleteSheet
          чек={подтвердитьУдаление}
          onConfirm={async () => {
            const чек = подтвердитьУдаление;
            setПодтвердитьУдаление(null);
            await handleDelete(чек.id);
          }}
          onClose={() => setПодтвердитьУдаление(null)}
        />
      )}
      {detail && (
        <ReceiptDetailModal
          receipt={detail}
          paymentOptions={paymentOptions}
          catalog={catalog}
          onClose={closeDetail}
          onDelete={() => {
            handleDelete(detail.id);
            closeDetail();
          }}
          onChangeCategory={async (c) => {
            const upd = await handleUpdate(detail.id, { category: c });
            if (upd) setDetail(upd);
          }}
          onChangePayment={async (p) => {
            const upd = await handleUpdate(detail.id, { payment: p });
            if (upd) setDetail(upd);
          }}
          role={role}
          люди={users}
          onRefetchFns={async () => {
            // ⚠️ ПРИЧИНА ВОЗВРАЩАЕТСЯ, А НЕ ГЛОТАЕТСЯ: у 502/404/503 разные
            // тексты, и человеку нужен именно тот, что пришёл.
            const res = await authFetch(
              `/api/receipts/${detail.id}/refetch-fns`,
              {
                method: "POST",
              },
            );
            const тело = await res.json().catch(() => null);
            if (!res.ok)
              return {
                ok: false,
                причина: текстОшибки(тело, `Сервер ответил ${res.status}`),
              };
            // ⚠️ ЧЕРЕЗ `handleRefreshReceipt`, А НЕ СВОИМ `setReceipts`:
            // строка списка обязана обновиться той же канонической формой,
            // что и карточка, иначе признак «можно дозапросить» погаснет
            // в одном месте и останется в другом.
            const norm = await handleRefreshReceipt(тело.id);
            setDetail(norm || тело);
            return { ok: true };
          }}
          onReportLinkChanged={async () => {
            // Связь с отчётом изменилась (прикрепили или убрали в деталях
            // отчёта) — перечитываем каноническую форму чека
            // (in_report / report_id / report_title считает бэк) и обновляем
            // карточку вместе со строкой в списке.
            const norm = await handleRefreshReceipt(detail.id);
            if (norm) setDetail(norm);
          }}
        />
      )}
      {showCatSheet && (
        <CategorySheet
          catalog={catalog}
          selected={form.category}
          onPick={(c) => setForm((p) => ({ ...p, category: c }))}
          onClose={() => setShowCatSheet(false)}
        />
      )}
      {showAdd && (
        <Modal
          title="Добавить чек"
          onClose={() => {
            setShowAdd(false);
            setFnsStatus(null);
            setAddError("");
            setDupId(null);
          }}
          footer={
            <>
              {addError && (
                <div
                  style={{
                    marginBottom: 8,
                    padding: "8px 12px",
                    background: "#FEF2F2",
                    border: "1px solid #FECACA",
                    borderRadius: 8,
                    fontFamily: FONT,
                    fontSize: 12,
                    color: "#B91C1C",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                  }}
                >
                  <span>{addError}</span>
                  {dupId && (
                    <button
                      onClick={openDup}
                      style={{
                        flexShrink: 0,
                        border: "none",
                        background: "none",
                        color: "#B91C1C",
                        fontFamily: FONT,
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: "pointer",
                        textDecoration: "underline",
                        padding: 0,
                      }}
                    >
                      Открыть
                    </button>
                  )}
                </div>
              )}
              <Btn
                full
                onClick={addR}
                disabled={!form.org || !form.amount}
                loading={isSubmitting}
              >
                {isSubmitting ? "Добавляю…" : "Добавить чек"}
              </Btn>
            </>
          }
        >
          <div style={{ paddingTop: 12 }}>
            {fnsStatus === "loading" && (
              <div
                style={{
                  marginBottom: 12,
                  padding: "8px 12px",
                  background: "#EEF0F4",
                  border: `1px solid ${theme.border}`,
                  borderRadius: 6,
                  fontFamily: FONT,
                  fontSize: 11,
                  color: C.mid,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  style={{ flexShrink: 0 }}
                >
                  <circle cx="12" cy="12" r="9" strokeOpacity="0.25" />
                  <path d="M21 12a9 9 0 0 0-9-9" strokeLinecap="round">
                    <animateTransform
                      attributeName="transform"
                      type="rotate"
                      from="0 12 12"
                      to="360 12 12"
                      dur="0.8s"
                      repeatCount="indefinite"
                    />
                  </path>
                </svg>
                Загружаем данные из ФНС…
              </div>
            )}
            {fnsStatus === "ok" && (
              <div
                style={{
                  marginBottom: 12,
                  padding: "8px 12px",
                  background: "#ECFDF5",
                  border: "1px solid #BBF7D0",
                  borderRadius: 6,
                  fontFamily: FONT,
                  fontSize: 11,
                  color: "#047857",
                }}
              >
                Электронный чек загружен ✓
              </div>
            )}
            {(fnsStatus === "partial" ||
              fnsStatus === "ocr_unavailable" ||
              fnsStatus === "ocr_failed") && (
              <div
                style={{
                  marginBottom: 12,
                  padding: "8px 12px",
                  background: "#FFFBEB",
                  border: "1px solid #FDE68A",
                  borderRadius: 6,
                  fontFamily: FONT,
                  fontSize: 11,
                  color: "#B45309",
                }}
              >
                {fnsStatus === "ocr_unavailable"
                  ? "Распознавание фото временно недоступно. Введите данные чека вручную — все поля ниже."
                  : fnsStatus === "ocr_failed"
                    ? "Не удалось разобрать снимок. Переснимите при хорошем свете или введите данные вручную."
                    : fnsПричина === "rejected"
                      ? "Сервис проверки чеков не принял наш доступ — чек здесь ни при чём. Заполните поля вручную и сообщите администратору."
                      : fnsПричина === "unavailable"
                        ? "Сервис проверки ФНС временно недоступен. Заполните поля вручную — чек сохранится."
                        : fnsПричина === "not_found"
                          ? // ⚠️ ОБЕЩАНИЕ «МЫ СООБЩИМ» ПОЯВИЛОСЬ ВМЕСТЕ
                            // С РАБОЧИМ ДОЗАПРОСОМ (T162), не раньше: обещать
                            // то, чего не делаешь, хуже честного «не вышло».
                            // Держится оно на ПИСЬМЕ, а не на том, что человек
                            // снова откроет приложение.
                            "Чек сохранён. Данные из налоговой подтянутся автоматически — обычно в течение суток, мы сообщим. Кнопки ниже — если хотите заполнить сейчас."
                          : "Данные из ФНС не загрузились. Проверьте реквизиты и заполните недостающее вручную."}
              </div>
            )}
            {/* НАЗВАНИЕ ЗДЕСЬ НЕ ПРОПУСКАЕТСЯ ЧЕРЕЗ shortOrg — И ЭТО НЕ НЕДОСМОТР.
                В семи местах показа (карточка «Чеков», кольцо «Организации»,
                чеки отчёта, герой деталей, «Главная», баннер дублей, поиск)
                shortOrg сокращает форму и ставит ёлочки. Здесь другой слой:
                значение РЕДАКТИРУЕМОЕ и уходит в базу как есть — `org: form.org`
                при сохранении. Прогнать его через shortOrg значит записать
                в receipts.org сокращённый вид с ёлочками, а по этой колонке
                матчатся ДЕДУП и АВТО-КАТЕГОРИЗАЦИЯ (`auto_categorize` на бэке
                сравнивает org и org_brand). Разошедшееся написание там ломается
                молча: чек не склеится с дублем, категория не подставится.
                Показ сокращает, хранение — нет. Разобрано 06.08.2026. */}
            <RuleInput
              label="Организация"
              value={form.org}
              onChange={(v) => setForm((p) => ({ ...p, org: v }))}
              placeholder="Яндекс.Такси"
            />
            <RuleInput
              label="Сумма (₽)"
              value={form.amount}
              onChange={(v) => setForm((p) => ({ ...p, amount: v }))}
              onBlur={() =>
                setForm((p) => {
                  const n = parseMoney(p.amount);
                  // Пусто остаётся пустым: «0,00» вместо пустоты выглядит как
                  // введённая сумма и проходит взглядом. Нечитаемое оставляем
                  // КАК ВВЕДЕНО — стереть чужой ввод хуже, чем показать его
                  // неверным; сохранение всё равно не пропустит.
                  if (n === null)
                    return String(p.amount).trim() === ""
                      ? { ...p, amount: "" }
                      : p;
                  return { ...p, amount: moneyInput(n) };
                })
              }
              type="text"
              inputMode="decimal"
              placeholder="0.00"
            />
            <RuleInput
              label="Дата"
              value={form.date}
              onChange={(v) => setForm((p) => ({ ...p, date: v }))}
              type="date"
            />
            <div style={{ marginBottom: 12 }}>
              <div
                style={{
                  fontSize: 9,
                  letterSpacing: "0.15em",
                  textTransform: "uppercase",
                  color: theme.fg2,
                  marginBottom: 6,
                  fontFamily: FONT,
                }}
              >
                Категория
              </div>
              <button
                onClick={() => setShowCatSheet(true)}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 12px",
                  border: `1px solid ${theme.border}`,
                  background: theme.surface,
                  borderRadius: 10,
                  cursor: "pointer",
                  fontFamily: FONT,
                }}
              >
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    background: catColor(form.category).fg,
                    flexShrink: 0,
                  }}
                />
                <span style={{ flex: 1, textAlign: "left", minWidth: 0 }}>
                  <span
                    style={{
                      display: "block",
                      fontSize: 13,
                      color: C.dark,
                      fontWeight: 600,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {form.category || "Не указано"}
                  </span>
                  {groupOf(form.category) && (
                    <span
                      style={{
                        display: "block",
                        fontSize: 10,
                        color: theme.fg2,
                      }}
                    >
                      {groupOf(form.category)}
                    </span>
                  )}
                </span>
                <span style={{ color: theme.fg3, fontSize: 18, flexShrink: 0 }}>
                  ›
                </span>
              </button>
              {(!form.category ||
                form.category === "Не указано" ||
                form.category === DEFAULT_FALLBACK) && (
                <div
                  style={{
                    marginTop: 6,
                    padding: "6px 10px",
                    background: "#FFFBEB",
                    border: "1px solid #FDE68A",
                    borderRadius: 8,
                    fontFamily: FONT,
                    fontSize: 11,
                    color: "#B45309",
                  }}
                >
                  Проверьте категорию
                </div>
              )}
            </div>
            <div style={{ marginBottom: 8 }}>
              <div
                style={{
                  fontSize: 9,
                  letterSpacing: "0.15em",
                  textTransform: "uppercase",
                  color: theme.fg2,
                  marginBottom: 6,
                  fontFamily: FONT,
                }}
              >
                Метод оплаты
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {paymentOptions.map((m) => (
                  <button
                    key={m}
                    onClick={() =>
                      setForm((p) => ({
                        ...p,
                        payment: m,
                        paymentGuessed: false, // выбрал руками — пометка снята
                      }))
                    }
                    style={{
                      padding: "4px 10px",
                      border: `1px solid ${
                        form.payment === m ? theme.cherry : theme.border
                      }`,
                      background:
                        form.payment === m ? theme.cherrySoft : theme.surface,
                      color: form.payment === m ? theme.cherry : C.mid,
                      fontFamily: FONT,
                      fontSize: 11,
                      cursor: "pointer",
                      borderRadius: 6,
                    }}
                  >
                    {m}
                  </button>
                ))}
              </div>
              {form.paymentGuessed && (
                <div
                  style={{
                    marginTop: 6,
                    font: `400 12px/1.4 ${FONT}`,
                    color: "#B45309",
                  }}
                >
                  Карта подставлена по вашей истории — проверьте, той ли картой
                  платили
                </div>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── SETTINGS HELPERS & PARTS ─────────────────────────────
const ROLE_LABEL = Object.fromEntries(ROLES.map((r) => [r.id, r.label]));
const roleLabel = (id) => ROLE_LABEL[id] || "Сотрудник";
const userInitials = (u) =>
  `${(u.first_name || "")[0] || ""}${
    (u.last_name || "")[0] || ""
  }`.toUpperCase() || "?";

const SVC_ICON = { fns: "🧾", alfabank: "🏦", anthropic: "🤖" };
const SVC_STATUS = {
  active: { label: "Активен", bg: "#F0FDF4", fg: "#15803D" },
  in_progress: { label: "В разработке", bg: "#FFFBEB", fg: "#B45309" },
  not_connected: { label: "Не подключено", bg: "#EEF0F4", fg: "#636B7D" },
  not_configured: { label: "Не настроен", bg: "#EEF0F4", fg: "#636B7D" },
};

function ServiceCard({ svc }) {
  const m = SVC_STATUS[svc.status] || SVC_STATUS.not_connected;
  return (
    <div
      style={{
        background: theme.surface,
        border: `1px solid ${theme.border}`,
        borderRadius: 8,
        padding: "12px 14px",
        marginBottom: 10,
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 8,
          background: theme.surfaceSunk,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 18,
          flexShrink: 0,
        }}
      >
        {SVC_ICON[svc.key] || "⚙"}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
            marginBottom: 3,
          }}
        >
          <span
            style={{
              fontFamily: FONT,
              fontSize: 13,
              fontWeight: 700,
              color: C.dark,
            }}
          >
            {svc.name}
          </span>
          <span
            style={{
              fontFamily: FONT,
              fontSize: 10,
              fontWeight: 600,
              padding: "2px 8px",
              borderRadius: 10,
              background: m.bg,
              color: m.fg,
              whiteSpace: "nowrap",
            }}
          >
            {m.label}
          </span>
        </div>
        <div
          style={{
            fontFamily: FONT,
            fontSize: 11,
            color: theme.fg2,
            lineHeight: 1.4,
          }}
        >
          {svc.description}
        </div>
        {svc.key === "fns" && (
          <div style={{ marginTop: 8 }}>
            <button
              disabled
              title="Скоро"
              style={{
                padding: "6px 14px",
                border: `1px solid ${theme.border}`,
                background: theme.surfaceSunk,
                color: theme.fg3,
                fontFamily: FONT,
                fontSize: 12,
                borderRadius: 8,
                cursor: "not-allowed",
              }}
            >
              Подключить
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// Swipe-left to reveal "Удалить" — mirrors SwipeableReceiptCard's pointer logic.
// ⚠️ СТРОКА РАБОТАЕТ В ДВЕ СТОРОНЫ (T118/④, 31.08.2026). Свайп у погашенного
// открывает не «Удалить», а «Вернуть»: до этой правки погашенный вообще не
// доезжал до экрана — список читал `WHERE is_active = true`, — и ошибочный
// свайп чинился только руками в базе. Довод владельца: это защита от его же
// ошибки, а не удобство.
function SwipeableUserRow({
  user,
  onDelete,
  onRestore,
  onTap,
  deletable = true,
}) {
  const [tx, setTx] = useState(0);
  const [drag, setDrag] = useState(false); // render-safe mirror of dragging.current
  const startX = useRef(0),
    startY = useRef(0),
    dragging = useRef(false),
    locked = useRef(null);
  // ⚠️ 84 — КАНОН, а не круглое число: design/handoff/templates/reports,
  // `.sa{width:84px}`. Было 72 без основания. T121.
  const REVEAL = 84;
  const u = user;
  const погашен = u.is_active === false;
  // Погашенного возвращают, активного гасят. Доступность считается по той же
  // стороне: у погашенного запрет «последнего админа» не применим — возврат
  // администраторов не убавляет.
  const действие = погашен
    ? {
        есть: Boolean(onRestore),
        цвет: "#15803D",
        слово: "Вернуть",
        жать: onRestore,
      }
    : { есть: deletable, цвет: "#B91C1C", слово: "Удалить", жать: onDelete };
  const name =
    [u.last_name, u.first_name, u.patronymic].filter(Boolean).join(" ") ||
    u.email ||
    "Без имени";
  function down(e) {
    // ⚠️ СЛЕЖЕНИЕ ИДЁТ ВСЕГДА, ДАЖЕ КОГДА СВАЙПАТЬ НЕЧЕГО. Прежняя редакция
    // выходила здесь при недоступном действии — и строка переставала ловить
    // ТАП тоже. У себя самого и у последнего админа полосы нет, а смена роли
    // на них нужна (её отказ объясняет сервер, и это честнее, чем немой ряд).
    dragging.current = true;
    setDrag(true);
    locked.current = null;
    startX.current = e.clientX;
    startY.current = e.clientY;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function move(e) {
    if (!dragging.current) return;
    const dx = e.clientX - startX.current,
      dy = e.clientY - startY.current;
    if (locked.current === null) {
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6)
        locked.current = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      else return;
    }
    if (locked.current !== "x" || !действие.есть) return;
    const base = tx < 0 ? -REVEAL : 0;
    setTx(Math.min(0, Math.max(-REVEAL, base + dx)));
  }
  function up() {
    if (!dragging.current) return;
    dragging.current = false;
    setDrag(false);
    if (locked.current === "x") {
      setTx(tx < -REVEAL / 2 ? -REVEAL : 0);
      return;
    }
    // ⚠️ ТАП — ЭТО «НЕ БЫЛО ПРОТАСКИВАНИЯ». Отличаем по тому же порогу в 6 px,
    // которым уже определяется ось: `locked` остаётся null, только если палец
    // не сдвинулся. Иначе свайп заканчивался бы открытием карточки роли —
    // жест и действие спорили бы за одно движение.
    if (locked.current === null) {
      // Открытая полоса — сначала закрыть: тап по строке при видимой
      // «Удалить» означает «передумал», а не «поменяй роль».
      if (tx !== 0) setTx(0);
      else if (onTap) onTap();
    }
  }
  return (
    // ⚠️ ОБЁРТКА ПО КАНОНУ `.swipe`: скругление 12 и тень живут ЗДЕСЬ,
    // а не на карточке — комментарий в самом каноне объясняет почему:
    // `overflow:hidden` иначе их обрежет. Раньше строка была без скругления
    // и во всю ширину, и «Пользователи» выглядели иначе «Чеков» и «Отчётов»
    // без всякой причины (T121).
    <div
      style={{
        position: "relative",
        background: действие.цвет,
        borderRadius: 12,
        boxShadow: "0 1px 3px rgba(17,19,24,.08)",
        marginBottom: 8,
        overflow: "hidden",
      }}
    >
      {действие.есть && (
        <div
          onClick={действие.жать}
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            bottom: 0,
            width: REVEAL,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            color: "#fff",
            // ⚠️ ЗНАЧОК И СЛОВО, В СТОЛБИК — канон `.sa`: flex-direction
            // column, gap 5, font 600 12px/1.1. Было только слово: значок
            // понятен без чтения, слово снимает двусмысленность.
            flexDirection: "column",
            gap: 5,
            fontFamily: FONT,
            fontSize: 12,
            fontWeight: 600,
            lineHeight: 1.1,
          }}
        >
          {погашен ? (
            <Check size={20} strokeWidth={2} aria-hidden="true" />
          ) : (
            <Trash2 size={20} strokeWidth={1.75} aria-hidden="true" />
          )}
          {действие.слово}
        </div>
      )}
      <div
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        style={{
          background: theme.surface,
          padding: "11px 14px",
          display: "flex",
          alignItems: "center",
          gap: 12,
          transform: `translateX(${tx}px)`,
          transition: drag ? "none" : "transform 0.2s ease",
          userSelect: "none",
          touchAction: "pan-y",
          borderLeft: `3px solid ${
            u.is_active !== false ? theme.cherry : theme.border
          }`,
        }}
      >
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: "50%",
            background: theme.cherry,
            color: theme.surface,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: FONT,
            fontSize: 11,
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          {userInitials(u)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: FONT,
              fontSize: 13,
              color: C.dark,
              fontWeight: 700,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {name}
          </div>
          {/* ⚠️ ЕДИНЫЙ ТЕКСТ РОЛИ (T146): 12px fg2 во всех местах показа,
              где роль — подпись, а не действие. Было 11/12/13 тремя цветами. */}
          <div style={{ fontFamily: FONT, fontSize: 12, color: theme.fg2 }}>
            {roleLabel(u.role)} ·{" "}
            {u.is_active !== false ? "активен" : "неактивен"}
          </div>
        </div>
      </div>
    </div>
  );
}

// +7 999 123 45 67 mask
function formatPhone(v) {
  let d = (v || "").replace(/\D/g, "");
  if (d.startsWith("8")) d = "7" + d.slice(1);
  if (d && !d.startsWith("7")) d = "7" + d;
  d = d.slice(0, 11);
  if (!d) return ""; // empty input → empty (placeholder shows)
  let out = "+7";
  if (d.length > 1) out += " " + d.slice(1, 4);
  if (d.length >= 5) out += " " + d.slice(4, 7);
  if (d.length >= 8) out += " " + d.slice(7, 9);
  if (d.length >= 10) out += " " + d.slice(9, 11);
  return out;
}

function ChangePasswordModal({ onClose }) {
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [rep, setRep] = useState("");
  const [show, setShow] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const inp = {
    width: "100%",
    padding: "11px 12px",
    border: `1px solid ${theme.border}`,
    borderRadius: 8,
    fontSize: 14,
    fontFamily: FONT,
    color: C.dark,
    background: theme.surface,
    boxSizing: "border-box",
    outline: "none",
  };
  async function submit() {
    setErr("");
    if (newPw.length < 8) {
      setErr("Новый пароль не менее 8 символов");
      return;
    }
    if (newPw !== rep) {
      setErr("Пароли не совпадают");
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      const res = await authFetch("/api/users/me/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ old_password: oldPw, new_password: newPw }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        // СОБСТВЕННАЯ СМЕНА ПАРОЛЯ НЕ ДОЛЖНА ВЫКИДЫВАТЬ ИЗ СИСТЕМЫ (S-16).
        // Бэкенд гасит все прежние токены отметкой tokens_valid_from — иначе
        // после «зашли из чужого места» чужая сессия жила бы ещё месяц. Но
        // вместе со всеми гаснет и НАША: без этой строки человек, сменивший
        // пароль планово, оказывался бы на экране входа без объяснения,
        // и читалось бы это как поломка, а не как защита.
        // Поэтому ручка возвращает новую пару, и мы её сохраняем. Выкидывать
        // должно только «выйти на всех устройствах», где это и ожидается.
        if (d.access_token && d.refresh_token) tokens.set(d);
        setDone(true);
        setTimeout(onClose, 1200);
        return;
      }
      setErr(текстОшибки(d, "Не удалось изменить пароль"));
    } catch {
      setErr("Нет связи с сервером");
    } finally {
      setBusy(false);
    }
  }
  const dialogRef = useModalA11y(onClose);
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.3)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        zIndex: 300,
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Изменить пароль"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: theme.surface,
          width: "100%",
          maxWidth: 480,
          borderRadius: "16px 16px 0 0",
          display: "flex",
          flexDirection: "column",
          paddingBottom: "env(safe-area-inset-bottom)",
          outline: "none",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            padding: "8px 0 2px",
          }}
        >
          <div
            style={{
              width: 36,
              height: 4,
              borderRadius: 2,
              background: "#D7DAE0",
            }}
          />
        </div>
        <div
          style={{
            padding: "4px 16px 12px",
            borderBottom: `1px solid ${theme.border}`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span
            style={{
              fontSize: 15,
              fontFamily: FONT,
              color: C.dark,
              fontWeight: 600,
            }}
          >
            Изменить пароль
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            style={{
              border: "none",
              background: "none",
              color: theme.fg2,
              fontSize: 18,
              cursor: "pointer",
            }}
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>
        <div
          style={{
            padding: "16px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          {done ? (
            <div
              style={{
                textAlign: "center",
                padding: "16px 0",
                fontSize: 15,
                color: "#15803D",
                fontFamily: FONT,
                fontWeight: 600,
              }}
            >
              Пароль изменён ✓
            </div>
          ) : (
            <>
              <input
                style={inp}
                type={show ? "text" : "password"}
                placeholder="Текущий пароль"
                aria-label="Текущий пароль"
                value={oldPw}
                onChange={(e) => setOldPw(e.target.value)}
              />
              <input
                style={inp}
                type={show ? "text" : "password"}
                placeholder="Новый пароль (от 8 символов)"
                aria-label="Новый пароль"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
              />
              <input
                style={inp}
                type={show ? "text" : "password"}
                placeholder="Повторите новый пароль"
                aria-label="Повторите новый пароль"
                value={rep}
                onChange={(e) => setRep(e.target.value)}
              />
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 12,
                  color: theme.fg2,
                  fontFamily: FONT,
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={show}
                  onChange={(e) => setShow(e.target.checked)}
                  aria-label="Показать пароли"
                  style={{ accentColor: theme.cherry }}
                />{" "}
                Показать пароли
              </label>
              {err && (
                <div
                  style={{
                    color: theme.cherry,
                    fontSize: 13,
                    fontFamily: FONT,
                  }}
                >
                  {err}
                </div>
              )}
              <Btn full onClick={submit} disabled={busy}>
                {busy ? "Сохраняем…" : "Сохранить пароль"}
              </Btn>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function AccountTab({
  cards,
  onAddCard,
  onUpdateCard,
  onDeleteCard,
  onSetDefaultCard,
}) {
  // Показ текста согласия из записи — нашей шторкой, не системным окном.
  const [показатьСогласие, setПоказатьСогласие] = useState(false);
  const [newCard, setNewCard] = useState("");
  const [me, setMe] = useState(null);
  // T171: пустая карточка человека и «профиль не загрузился» — разные вещи.
  const [сбойПрофиля, setСбойПрофиля] = useState(false);
  const [попыткаПрофиля, setПопыткаПрофиля] = useState(0);
  const [acc, setAcc] = useState({
    first_name: "",
    last_name: "",
    phone: "",
    employee_number: "",
  });
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");

  // Phone is stored E.164 ("+79991234567") in the DB; mask it for display.
  const fromApi = (d) => ({
    first_name: d.first_name || "",
    last_name: d.last_name || "",
    phone: formatPhone(d.phone || ""),
    employee_number: d.employee_number || "",
  });

  useEffect(() => {
    authFetch("/api/users/me")
      .then((r) => r.json())
      .then((d) => {
        if (d && d.id) {
          setMe(d);
          setAcc(fromApi(d));
        }
        setСбойПрофиля(false);
      })
      // ⚠️ Пустая карточка человека читается как «профиль не заполнен» (T171).
      .catch(() => setСбойПрофиля(true));
  }, [попыткаПрофиля]);

  const set = (k, v) => setAcc((p) => ({ ...p, [k]: v }));
  async function save() {
    const fn = acc.first_name.trim(),
      ln = acc.last_name.trim();
    const digits = acc.phone.replace(/\D/g, ""); // "79991234567" | ""
    if (!fn) {
      setErr("Укажите имя");
      return;
    }
    if (!ln) {
      setErr("Укажите фамилию");
      return;
    }
    if (digits && digits.length !== 11) {
      setErr("Телефон: 11 цифр или оставьте пустым");
      return;
    }
    setErr("");
    const payload = {
      first_name: fn,
      last_name: ln,
      phone: digits ? "+" + digits : "",
      employee_number: acc.employee_number.trim(),
    };
    const res = await authFetch("/api/users/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const d = await res.json().catch(() => null);
      if (d && d.id) {
        setMe(d);
        setAcc(fromApi(d));
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } else {
      setErr("Не удалось сохранить");
    }
  }

  if (!me)
    return (
      <div style={{ padding: "40px 20px" }}>
        {/* ⚠️ ВЕЧНАЯ «ЗАГРУЗКА…» — ТОТ ЖЕ КЛАСС, ЧТО ПУСТОЙ CATCH (T171):
            при отказе экран крутился бесконечно и не говорил ничего. */}
        {сбойПрофиля ? (
          <LoadFailure
            что="ваш профиль"
            onRetry={() => setПопыткаПрофиля((н) => н + 1)}
          />
        ) : (
          <div
            style={{
              textAlign: "center",
              color: theme.fg3,
              fontFamily: FONT,
              fontSize: 13,
            }}
          >
            Загрузка…
          </div>
        )}
      </div>
    );

  const role = me.role || "employee";
  const roleDesc = (ROLES.find((r) => r.id === role) || {}).desc || "";
  const consent = me.consent;
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

  return (
    <div
      style={{ padding: "12px 16px calc(env(safe-area-inset-bottom) + 80px)" }}
    >
      {/* ⚠️ ЗАГОЛОВКА ЗДЕСЬ БОЛЬШЕ НЕТ. «Личные данные» — это остаток
          отменённого макета ui_kits/mobile-app/settings.jsx, где так
          называлась секция ВНУТРИ «Аккаунта». В действующем каноне
          templates/profile/Профиль.html это ГРУППА хаба, куда входят
          «Аккаунт» и «Безопасность» — и слово оказалось в двух ролях
          сразу. Экран уже называется «Аккаунт», второй заголовок над
          единственным блоком полей не нужен. Подробности — T109. */}
      <div style={rowStyle(0)}>
        <span style={lbl}>Имя</span>
        <input
          value={acc.first_name}
          onChange={(e) => set("first_name", e.target.value)}
          placeholder="—"
          aria-label="Имя"
          style={fin}
        />
      </div>
      <div style={rowStyle(1)}>
        <span style={lbl}>Фамилия</span>
        <input
          value={acc.last_name}
          onChange={(e) => set("last_name", e.target.value)}
          placeholder="—"
          aria-label="Фамилия"
          style={fin}
        />
      </div>
      <div style={rowStyle(0)}>
        <span style={lbl}>Email</span>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 6,
            fontSize: 13,
            color: theme.fg2,
            fontFamily: FONT,
          }}
        >
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {me.email || "—"}
          </span>
          {me.is_email_verified && (
            <span
              title="подтверждён"
              style={{ color: "#15803D", fontSize: 12, flexShrink: 0 }}
            >
              ✓
            </span>
          )}
        </span>
      </div>
      <div style={rowStyle(1)}>
        <span style={lbl}>Телефон</span>
        <input
          value={acc.phone}
          onChange={(e) => set("phone", formatPhone(e.target.value))}
          inputMode="tel"
          placeholder="+7 ___ ___ __ __"
          aria-label="Телефон"
          style={{ ...fin, fontVariantNumeric: "tabular-nums" }}
        />
      </div>
      <div style={rowStyle(0)}>
        <span style={lbl}>Табельный №</span>
        <input
          value={acc.employee_number}
          onChange={(e) => set("employee_number", e.target.value)}
          placeholder="—"
          aria-label="Табельный номер"
          style={{ ...fin, fontVariantNumeric: "tabular-nums" }}
        />
      </div>
      {err && (
        <div
          style={{
            color: theme.cherry,
            fontSize: 13,
            fontFamily: FONT,
            marginTop: 10,
          }}
        >
          {err}
        </div>
      )}
      <div style={{ marginTop: err ? 8 : 14 }}>
        <Btn full onClick={save}>
          Сохранить
        </Btn>
      </div>

      <SectionHead title="Ваша роль" />
      <div
        style={{
          background: theme.surface,
          border: `1px solid ${theme.border}`,
          borderRadius: 8,
          borderLeft: `3px solid ${theme.cherry}`,
          padding: "12px 14px",
        }}
      >
        {/* ⚠️ КАНОННАЯ ПИЛЮЛЯ ЗНАК В ЗНАК (T146): .badge из
            templates/profile/Профиль.html:40. Была ВТОРАЯ пилюля, отличная
            от канона всем — бледная заливка, вишнёвый текст, скругление 20,
            700 12px, отступы 3/10. Двух пилюль для одной сущности не бывает. */}
        <span
          style={{
            display: "inline-block",
            background: theme.cherry,
            color: "#fff",
            borderRadius: 999,
            font: `500 11px/1.3 ${FONT}`,
            padding: "3px 9px",
          }}
        >
          {roleLabel(role)}
        </span>
        <div
          style={{
            fontFamily: FONT,
            fontSize: 12,
            color: theme.fg2,
            lineHeight: 1.5,
            marginTop: 8,
          }}
        >
          {roleDesc}
        </div>
      </div>
      <div
        style={{
          fontSize: 11,
          color: theme.fg3,
          fontFamily: FONT,
          marginTop: 6,
        }}
      >
        Роль изменяется Администратором в разделе «Пользователи»
      </div>

      <SectionHead title="Мои карты" />
      <div
        style={{
          fontSize: 11,
          color: theme.fg2,
          fontFamily: FONT,
          marginBottom: 8,
          lineHeight: 1.5,
        }}
      >
        При сканировании чека карта подставляется по истории трат в той же
        организации. Если истории нет — подставляется карта по умолчанию
        (отмечена ★).
      </div>
      {cards.map((c, i) => (
        <div
          key={c.id}
          style={{
            background: i % 2 === 0 ? theme.surface : theme.surfaceSunk,
            padding: "5px 14px",
            borderBottom: `1px solid ${theme.border}`,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span
            onClick={() => {
              if (!c.is_default) onSetDefaultCard(c.id);
            }}
            title={
              c.is_default
                ? "Карта по умолчанию"
                : "Сделать картой по умолчанию"
            }
            style={{
              fontSize: 16,
              cursor: c.is_default ? "default" : "pointer",
              flexShrink: 0,
              color: c.is_default ? theme.cherry : theme.fg3,
              lineHeight: 1,
            }}
          >
            {c.is_default ? "★" : "☆"}
          </span>
          <input
            defaultValue={c.name}
            aria-label="Название карты"
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v && v !== c.name) onUpdateCard(c.id, v);
              else e.target.value = c.name;
            }}
            style={{
              flex: 1,
              border: "none",
              background: "transparent",
              fontSize: 16 /* T138 */,
              fontFamily: FONT,
              color: C.dark,
              outline: "none",
              padding: "4px 0",
            }}
          />
          <button
            type="button"
            onClick={() => onDeleteCard(c.id)}
            aria-label="Удалить карту"
            style={{
              background: "none",
              border: "none",
              padding: 0,
              color: theme.cherryMuted,
              fontSize: 14,
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>
      ))}
      {cards.length === 0 && (
        <div
          style={{
            fontSize: 12,
            color: theme.fg3,
            fontFamily: FONT,
            padding: "8px 0",
          }}
        >
          Пока нет карт
        </div>
      )}
      <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
        <input
          value={newCard}
          onChange={(e) => setNewCard(e.target.value)}
          placeholder="Например: Личная Сбер"
          aria-label="Название новой карты"
          onKeyDown={(e) => {
            if (e.key === "Enter" && newCard.trim()) {
              onAddCard(newCard.trim());
              setNewCard("");
            }
          }}
          style={{
            flex: 1,
            border: `1px solid ${theme.border}`,
            borderRadius: 6,
            outline: "none",
            padding: "7px 10px",
            fontSize: 16 /* T138 */,
            fontFamily: FONT,
            color: C.dark,
            background: theme.surface,
            boxSizing: "border-box",
          }}
        />
        <Btn
          small
          onClick={() => {
            if (newCard.trim()) {
              onAddCard(newCard.trim());
              setNewCard("");
            }
          }}
        >
          + Добавить
        </Btn>
      </div>

      {consent && (
        <>
          <SectionHead title="Согласие на обработку данных" />
          <div
            style={{
              background: theme.surface,
              border: `1px solid ${theme.border}`,
              borderRadius: 8,
              padding: "12px 14px",
            }}
          >
            <div
              style={{
                fontFamily: FONT,
                fontSize: 13,
                color: C.dark,
                lineHeight: 1.5,
              }}
            >
              Согласие дано{" "}
              {consent.given_at
                ? new Date(consent.given_at).toLocaleDateString("ru-RU")
                : "—"}{" "}
              · Политика конфиденциальности v{consent.policy_version}
            </div>
            <button
              // S-34: показываем текст ИЗ ЗАПИСИ (он приходит в consent.text),
              // а не текущую редакцию: человек соглашался со своей.
              // ⚠️ БЫЛ `alert` (Р-ОТКАЗЫ, T116): юридический документ
              // в системном окне без прокрутки и разметки — таблицы правовых
              // оснований там превращались в кашу. Показываем той же шторкой,
              // что и на экране согласия: один документ — один вид.
              onClick={() => setПоказатьСогласие(true)}
              style={{
                marginTop: 8,
                background: "none",
                border: "none",
                color: theme.cherry,
                fontFamily: FONT,
                fontSize: 13,
                cursor: "pointer",
                padding: 0,
              }}
            >
              Посмотреть текст согласия
            </button>
            {показатьСогласие && (
              <ConsentBottomSheet
                title="Согласие на обработку данных"
                text={
                  consent.text ||
                  "Текст этой записи не сохранён (запись сделана до перехода на единый источник)."
                }
                onClose={() => setПоказатьСогласие(false)}
              />
            )}
          </div>
        </>
      )}

      {/* ⚠️ КНОПКИ «ВЫЙТИ» ЗДЕСЬ НЕТ И БЫТЬ НЕ ДОЛЖНО. Выход — действие
          над всем приложением, а не над разделом, и в хабе он в один
          тап. Дубль был остатком отменённого макета ui_kits/mobile-app
          (T109). Удалён, а не спрятан: спрятанное возвращают. */}

      {saved && (
        <div
          style={{
            position: "fixed",
            left: "50%",
            bottom: 90,
            transform: "translateX(-50%)",
            background: "#15803D",
            color: "#fff",
            padding: "10px 18px",
            borderRadius: 10,
            fontFamily: FONT,
            fontSize: 13,
            fontWeight: 600,
            zIndex: 400,
            boxShadow: "0 6px 16px rgba(0,0,0,0.2)",
          }}
        >
          Сохранено ✓
        </div>
      )}
    </div>
  );
}

// ⚠️ ОДНА ФОРМА ВМЕСТО ДВУХ. Было две кнопки — «Добавить сотрудника»
// и «Создать ссылку-приглашение», — и два разных пути к одному итогу.
// Первый заводил человека БЕЗ ПАРОЛЯ (T103, T105) и не слал ему ничего,
// второй давал ссылку, которую надо было передавать руками.
// Требование владельца: приглашение ОДНО, способов доставки два.
// ⚠️ СМЕНА РОЛИ ДЕЙСТВУЮЩЕМУ ЧЕЛОВЕКУ (T118, 31.08.2026). До этого дня
// повысить сотрудника было нельзя вовсе: `role` не входила ни в `UserUpdate`,
// ни в `UPDATABLE`, а проп `onUpdateUser` передавался в экран, который его
// НЕ ОБЪЯВЛЯЛ, и молча выбрасывался. Единственным способом было удалить
// строку и завести заново — то есть **потерять чеки и отчёты человека**.
// Довод владельца: приглашают один раз, а роли меняют постоянно.
//
// ⚠️ ОТКАЗ СЕРВЕРА ПОКАЗЫВАЕТСЯ, А НЕ ПРЯЧЕТСЯ. Понижение себя и снятие
// последнего администратора запрещает бэкенд (`проверить_что_админ_останется`),
// и он же объясняет, ПОЧЕМУ. Прятать такие роли из списка значило бы оставить
// человека без объяснения — молчаливо неработающая кнопка хуже честного отказа.
function RoleSheet({ user, onClose, onApply }) {
  const [роль, setРоль] = useState(user.role || "employee");
  const [busy, setBusy] = useState(false);
  const [ошибка, setОшибка] = useState("");
  const dialogRef = useModalA11y(onClose);
  const имя =
    [user.last_name, user.first_name].filter(Boolean).join(" ") ||
    user.email ||
    "сотрудник";

  async function применить() {
    if (busy || роль === user.role) return;
    setBusy(true);
    setОшибка("");
    const итог = await onApply(роль);
    setBusy(false);
    if (итог && итог.ok) onClose();
    else setОшибка((итог && итог.причина) || "Не удалось изменить роль");
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: theme.scrim || "rgba(0,0,0,0.3)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        zIndex: 300,
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Роль: ${имя}`}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: theme.surface,
          width: "100%",
          // ⚠️ БЕЗ `border-box` карточка была бы ШИРЕ экрана ровно на 32 px
          // отступов — поймано сторожем вёрстки (T14) в тот же заход.
          boxSizing: "border-box",
          maxWidth: 480,
          borderRadius: "16px 16px 0 0",
          padding: "16px 16px 20px",
          paddingBottom: "env(safe-area-inset-bottom)",
          outline: "none",
        }}
      >
        <div
          style={{
            fontSize: 15,
            fontFamily: FONT,
            color: theme.fg1,
            fontWeight: 600,
            marginBottom: 2,
          }}
        >
          Роль сотрудника
        </div>
        <div
          style={{
            fontSize: 12,
            fontFamily: FONT,
            color: theme.fg2,
            marginBottom: 14,
          }}
        >
          {имя}
        </div>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            marginBottom: 10,
          }}
        >
          {ROLES.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setРоль(r.id)}
              style={{
                padding: "8px 14px",
                borderRadius: 999,
                border: `1px solid ${
                  роль === r.id ? theme.cherry : theme.border
                }`,
                background: роль === r.id ? theme.cherry : theme.surface,
                color: роль === r.id ? "#fff" : theme.fg1,
                fontFamily: FONT,
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {r.label}
            </button>
          ))}
        </div>

        <div
          style={{
            fontSize: 12,
            lineHeight: 1.45,
            color: theme.fg2,
            fontFamily: FONT,
            marginBottom: 14,
          }}
        >
          {(ROLES.find((r) => r.id === роль) || {}).desc || ""}
        </div>

        {ошибка && (
          <div
            role="alert"
            style={{
              background: theme.errorBg,
              color: theme.errorFg,
              border: `1px solid ${theme.errorBd}`,
              borderRadius: 8,
              padding: "10px 12px",
              fontFamily: FONT,
              fontSize: 13,
              marginBottom: 10,
            }}
          >
            {ошибка}
          </div>
        )}

        <Btn full onClick={применить} disabled={busy || роль === user.role}>
          {busy ? "Меняем…" : "Изменить роль"}
        </Btn>
        <div style={{ height: 8 }} />
        <Btn full outline onClick={onClose}>
          Отмена
        </Btn>
      </div>
    </div>
  );
}

function InviteSheet({ onClose, onCreated }) {
  const [почта, setПочта] = useState("");
  const [имя, setИмя] = useState("");
  const [фамилия, setФамилия] = useState("");
  const [role, setRole] = useState("employee");
  // ⚠️ СРОК ВЫБРАН ВСЕГДА. Раньше здесь стоял `null` («Бессрочная»), и не
  // выбравший ничего выпускал ВЕЧНУЮ ссылку. Замер прода 04.09.2026: пять
  // бессрочных из восьми, включая последнюю выпущенную. Бэкенд с d376799
  // такую ссылку и не примет — но умолчание чинится здесь, а не отказом.
  const [hours, setHours] = useState(168);
  // Общая ссылка НИКОГДА не возникает сама: её открывают явно.
  const [общаяОткрыта, setОбщаяОткрыта] = useState(false);
  const [created, setCreated] = useState(null);
  const [busy, setBusy] = useState(false);
  const [ошибка, setОшибка] = useState("");
  const [copied, setCopied] = useState(false);

  // ⚠️ ТРИ РОЛИ, И «АДМИНИСТРАТОР» ЗДЕСЬ ПОЯВЛЯЕТСЯ ВПЕРВЫЕ. Замер
  // 31.08.2026: в форме его не было НИ В ОДНОЙ редакции с 13.06.2026, хотя
  // бэкенд принимает `admin` в приглашении всегда (`Role` в `auth.py:51`).
  // То есть второго администратора нельзя было позвать не по запрету,
  // а по недосмотру формы. Довод владельца: один админ — единая точка
  // отказа на живых людях; потеряет доступ — организацию некому вести,
  // и завести нового некому.
  // ⚠️ ПОРЯДОК ОТ МЕНЬШИХ ПРАВ К БОЛЬШИМ, умолчание — «Сотрудник»:
  // самый широкий доступ не должен стоять первым и ловить случайное нажатие.
  const ROLE_CHIPS = ROLES.map((r) => [r.id, r.label]);
  // ⚠️ «БЕССРОЧНАЯ» СНЯТА (05.09.2026). Приглашение — это вход в организацию,
  // лежащий в чужом почтовом ящике; ссылка без срока это дверь, которую забыли
  // закрыть, и никто не знает, что она открыта.
  const TTL_CHIPS = [
    [24, "1 день"],
    [168, "7 дней"],
    [720, "30 дней"],
  ];
  const chip = (on) => ({
    padding: "6px 12px",
    border: "none",
    borderRadius: 8,
    cursor: "pointer",
    fontFamily: FONT,
    fontSize: 12,
    fontWeight: on ? 600 : 500,
    background: on ? theme.cherry : theme.surfaceSunk,
    color: on ? "#fff" : theme.fg2,
  });
  const lbl = {
    fontSize: 11, // T139: было 10 — единый размер подписи

    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: theme.fg2,
    fontFamily: FONT,
    marginBottom: 8,
  };
  const inp = {
    width: "100%",
    boxSizing: "border-box",
    padding: "10px 12px",
    border: `1px solid ${theme.border}`,
    borderRadius: 8,
    fontSize: 13,
    fontFamily: FONT,
    color: theme.fg1,
    background: theme.surface,
    outline: "none",
  };

  // ⚠️ ОДИН ЗАПРОС НА ОБЕ КНОПКИ, И ОБЕ — С ПОЧТОЙ. Раньше «Скопировать
  // ссылку» слала `email: null`, и введённый адрес МОЛЧА ТЕРЯЛСЯ: человек
  // видел форму с почтой, а выпускал предъявительскую ссылку. Природу ссылки
  // определяла нажатая кнопка, и увидеть это было негде.
  // Теперь кнопки различаются ТОЛЬКО доставкой: письмо или буфер обмена.
  // `общая = true` — отдельная дорога ниже, где почты нет вовсе.
  async function создать({ общая = false } = {}) {
    if (busy) return null;
    setBusy(true);
    setОшибка("");
    try {
      const res = await authFetch("/api/invite/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // ⚠️ У ОБЩЕЙ ССЫЛКИ РОЛЬ И СРОК НЕ НАШИ: их ставит сервер
        // (employee, сутки) и из тела не читает вовсе. Поэтому не шлём их
        // и здесь — иначе форма делала бы вид, что решает, а решает не она.
        body: JSON.stringify(
          общая
            ? { max_uses: 1 }
            : {
                role,
                expires_hours: hours,
                max_uses: 1,
                email: почта.trim(),
                first_name: имя.trim(),
                last_name: фамилия.trim(),
              },
        ),
      });
      const тело = await res.json().catch(() => null);
      if (!res.ok) {
        // ⚠️ Отказ доходит до человека, а не глотается (класс T116)
        // ⚠️ ЧЕРЕЗ `текстОшибки`, А НЕ НАПРЯМУЮ: у FastAPI `detail` бывает
        // МАССИВОМ ОБЪЕКТОВ, и объект в детях React — это бросок (№31),
        // то есть белый экран вместо плашки. Блокер 31.08.2026.
        setОшибка(текстОшибки(тело, `Сервер ответил ${res.status}`));
        return null;
      }
      setCreated(тело);
      if (onCreated) onCreated();
      return тело;
    } catch {
      setОшибка("Нет связи с сервером");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function скопировать(текст) {
    try {
      await navigator.clipboard.writeText(текст);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ⚠️ РАНЬШЕ ЗДЕСЬ БЫЛО ПУСТО. Буфер мог не сработать (нет прав,
      // не защищённое соединение), и человек уходил с пустым буфером,
      // уверенный, что скопировал. Класс T116.
      setОшибка("Не удалось скопировать. Выделите ссылку и скопируйте вручную");
    }
  }

  const dialogRef = useModalA11y(onClose);
  const почтаВерна = /.+@.+\..+/.test(почта.trim());

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: theme.scrim || "rgba(0,0,0,0.3)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        zIndex: 300,
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Пригласить сотрудника"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: theme.surface,
          width: "100%",
          maxWidth: 480,
          borderRadius: "16px 16px 0 0",
          display: "flex",
          flexDirection: "column",
          maxHeight: "88dvh",
          paddingBottom: "env(safe-area-inset-bottom)",
          outline: "none",
        }}
      >
        <div
          style={{
            padding: "14px 16px",
            borderBottom: `1px solid ${theme.border}`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span
            style={{
              fontSize: 15,
              fontFamily: FONT,
              color: theme.fg1,
              fontWeight: 600,
            }}
          >
            Пригласить сотрудника
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            style={{
              border: "none",
              background: "none",
              color: theme.fg2,
              fontSize: 18,
              cursor: "pointer",
            }}
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>

        <div style={{ padding: 16, overflow: "auto" }}>
          {!created ? (
            <>
              <div style={lbl}>Почта сотрудника</div>
              <input
                style={{ ...inp, marginBottom: 4 }}
                type="email"
                inputMode="email"
                autoCapitalize="off"
                autoCorrect="off"
                placeholder="ivan@example.com"
                aria-label="Почта сотрудника"
                value={почта}
                onChange={(e) => setПочта(e.target.value)}
              />
              <div
                style={{
                  fontSize: 11,
                  color: theme.fg2,
                  fontFamily: FONT,
                  lineHeight: 1.5,
                  marginBottom: 14,
                }}
              >
                ⚠️ Проверьте адрес по буквам. Ошибётесь — человек заведёт
                собственную организацию и окажется в приложении один.
              </div>

              <div style={lbl}>Имя и фамилия — необязательно</div>
              <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                <input
                  style={inp}
                  placeholder="Имя"
                  aria-label="Имя"
                  value={имя}
                  onChange={(e) => setИмя(e.target.value)}
                />
                <input
                  style={inp}
                  placeholder="Фамилия"
                  aria-label="Фамилия"
                  value={фамилия}
                  onChange={(e) => setФамилия(e.target.value)}
                />
              </div>

              <div style={lbl}>Роль</div>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                  marginBottom: 16,
                }}
              >
                {ROLE_CHIPS.map(([v, l]) => (
                  <button
                    key={v}
                    onClick={() => setRole(v)}
                    style={chip(role === v)}
                  >
                    {l}
                  </button>
                ))}
              </div>
              {/* ⚠️ ПОДПИСЬ ВЫБРАННОЙ РОЛИ — ИЗ ТОГО ЖЕ СПРАВОЧНИКА, что
                  и «Ваша роль» в «Аккаунте», и написана по гейтам. Без неё
                  «Администратор» — просто слово, и разницу с «Бухгалтером»
                  видно только тому, кто читал исходники. */}
              <div
                style={{
                  fontSize: 12,
                  lineHeight: 1.45,
                  color: theme.fg2,
                  fontFamily: FONT,
                  margin: "-10px 0 16px",
                }}
              >
                {(ROLES.find((r) => r.id === role) || {}).desc || ""}
              </div>

              <div style={lbl}>Срок действия</div>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                  marginBottom: 18,
                }}
              >
                {TTL_CHIPS.map(([v, l]) => (
                  <button
                    key={l}
                    onClick={() => setHours(v)}
                    style={chip(hours === v)}
                  >
                    {l}
                  </button>
                ))}
              </div>

              {ошибка && (
                <div
                  role="alert"
                  style={{
                    background: theme.errorBg,
                    color: theme.errorFg,
                    border: `1px solid ${theme.errorBd}`,
                    borderRadius: 8,
                    padding: "10px 12px",
                    fontFamily: FONT,
                    fontSize: 13,
                    lineHeight: 1.4,
                    marginBottom: 10,
                  }}
                >
                  {ошибка}
                </div>
              )}

              {/* ⚠️ ДВЕ КНОПКИ — ОДНО ПРИГЛАШЕНИЕ. Способов доставки два:
                  письмом и ссылкой. Требование владельца дословно. */}
              <Btn
                full
                onClick={() => создать()}
                disabled={busy || !почтаВерна}
              >
                {busy ? "Отправляем…" : "Отправить приглашение"}
              </Btn>
              <div style={{ height: 8 }} />
              {/* ⚠️ ТА ЖЕ ССЫЛКА, ДРУГАЯ ДОСТАВКА — поэтому и почта тут
                  обязательна так же. Кнопка, выпускавшая «ссылку без адресата»
                  при заполненной почте, обманывала дважды: теряла адрес и
                  меняла природу приглашения молча. */}
              <Btn
                full
                outline
                onClick={() => создать()}
                disabled={busy || !почтаВерна}
              >
                Скопировать ссылку
              </Btn>
              {!почтаВерна && почта.trim() !== "" && (
                <div
                  style={{
                    fontSize: 12,
                    color: theme.fg2,
                    fontFamily: FONT,
                    marginTop: 8,
                    textAlign: "center",
                  }}
                >
                  Адрес не похож на почтовый — письмо отправить не получится
                </div>
              )}

              {/* ⚠️ ОБЩАЯ ССЫЛКА — ОТДЕЛЬНАЯ ДОРОГА, И ОНА НЕ ОТКРЫВАЕТСЯ САМА.
                  Раньше она получалась побочно: нажал «Скопировать ссылку» —
                  и вместо именного приглашения вышло предъявительское, о чём
                  форма не сказала ни слова. Теперь её берут осознанно, а что
                  именно берут — написано до нажатия. */}
              <div
                style={{
                  marginTop: 24,
                  paddingTop: 16,
                  borderTop: `1px solid ${theme.border}`,
                }}
              >
                <button
                  onClick={() => setОбщаяОткрыта((о) => !о)}
                  aria-expanded={общаяОткрыта}
                  style={{
                    border: "none",
                    background: "none",
                    padding: 0,
                    cursor: "pointer",
                    fontFamily: FONT,
                    fontSize: 13,
                    fontWeight: 600,
                    color: theme.fg1,
                  }}
                >
                  Общая ссылка {общаяОткрыта ? "▴" : "▾"}
                </button>
                {общаяОткрыта && (
                  <div style={{ marginTop: 12 }}>
                    <div
                      style={{
                        fontSize: 12,
                        lineHeight: 1.5,
                        color: theme.fg2,
                        fontFamily: FONT,
                        marginBottom: 12,
                      }}
                    >
                      Пускает любого, кто её получил — адресата у неё нет.
                      Поэтому роль всегда «Сотрудник», а срок — одни сутки.
                      Выбрать их нельзя: это её природа, а не настройка.
                    </div>
                    <Btn
                      full
                      outline
                      onClick={() => создать({ общая: true })}
                      disabled={busy}
                    >
                      Создать общую ссылку
                    </Btn>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <div
                style={{
                  fontSize: 13,
                  color: theme.fg1,
                  fontFamily: FONT,
                  marginBottom: 10,
                  lineHeight: 1.5,
                }}
              >
                {created.sent_at
                  ? `Приглашение отправлено на ${created.email}. Ссылка ниже — на случай, если письмо не дойдёт.`
                  : "Ссылка готова — отправьте её сотруднику."}
              </div>
              <div
                style={{
                  background: theme.surfaceSunk,
                  border: `1px solid ${theme.border}`,
                  borderRadius: 10,
                  padding: "10px 12px",
                  fontSize: 12,
                  color: theme.fg1,
                  fontFamily: theme.fontMono || "monospace",
                  wordBreak: "break-all",
                  marginBottom: 12,
                }}
              >
                {created.invite_url}
              </div>
              {ошибка && (
                <div
                  role="alert"
                  style={{
                    background: theme.errorBg,
                    color: theme.errorFg,
                    border: `1px solid ${theme.errorBd}`,
                    borderRadius: 8,
                    padding: "10px 12px",
                    fontFamily: FONT,
                    fontSize: 13,
                    marginBottom: 10,
                  }}
                >
                  {ошибка}
                </div>
              )}
              <Btn full onClick={() => скопировать(created.invite_url)}>
                {copied ? "Скопировано ✓" : "Скопировать ссылку"}
              </Btn>
              <div style={{ height: 8 }} />
              <Btn full outline onClick={onClose}>
                Готово
              </Btn>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── D2: управление справочником категорий (Настройки → Общие) ───
const FIELD_LBL = {
  display: "block",
  fontSize: 11,
  color: theme.fg2,
  fontFamily: FONT,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  margin: "12px 0 4px",
};
const FIELD_INP = {
  width: "100%",
  boxSizing: "border-box",
  border: `1px solid ${theme.border}`,
  borderRadius: 8,
  padding: "9px 11px",
  fontSize: 16 /* T138 */,
  fontFamily: FONT,
  color: C.dark,
  background: theme.surface,
  outline: "none",
};

// Переиспользуемая нижняя шторка — тот же паттерн анимации, что у CategorySheet (D1).
function BottomSheet({ title, onClose, children }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
  const close = () => {
    setShown(false);
    setTimeout(onClose, 220);
  };
  const dialogRef = useModalA11y(close);
  return (
    <div
      onClick={close}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.3)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        zIndex: 170,
        opacity: shown ? 1 : 0,
        transition: `opacity ${shown ? 280 : 220}ms ease`,
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: theme.surface,
          width: "100%",
          maxWidth: 480,
          borderRadius: "16px 16px 0 0",
          outline: "none",
          display: "flex",
          flexDirection: "column",
          maxHeight: "88dvh",
          paddingBottom: "env(safe-area-inset-bottom)",
          transform: shown ? "translateY(0)" : "translateY(100%)",
          transition: `transform ${shown ? 280 : 220}ms ${EASE}`,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            padding: "8px 0 2px",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              width: 36,
              height: 4,
              borderRadius: 2,
              background: "#D7DAE0",
            }}
          />
        </div>
        <div
          style={{
            padding: "4px 16px 12px",
            borderBottom: `1px solid ${theme.border}`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontSize: 15,
              fontFamily: FONT,
              color: C.dark,
              fontWeight: 600,
            }}
          >
            {title}
          </span>
          <button
            type="button"
            onClick={close}
            aria-label="Закрыть"
            style={{
              border: "none",
              background: "none",
              color: theme.fg2,
              fontSize: 18,
              cursor: "pointer",
            }}
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>
        <div style={{ padding: "12px 16px 20px", overflow: "auto", flex: 1 }}>
          {children}
        </div>
      </div>
    </div>
  );
}

function ActionRow({ children, onClick, danger }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        padding: "14px 6px",
        border: "none",
        borderBottom: `1px solid ${theme.border}`,
        background: "none",
        fontFamily: FONT,
        fontSize: 14,
        color: danger ? theme.cherry : C.dark,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

// Форма добавления/переименования статьи. Сама делает POST/PATCH; ошибки бэка
// (409 дубль, 400 tax_kind) показывает инлайн; при успехе → onSaved(msg)+закрытие.
function CategoryFormSheet({ mode, group, groups, cat, onClose, onSaved }) {
  const [name, setName] = useState(mode === "edit" ? cat.name : "");
  const [groupId, setGroupId] = useState(
    mode === "create" ? (group ? group.id : groups[0] && groups[0].id) : null,
  );
  const [taxKind, setTaxKind] = useState(
    mode === "edit" ? cat.tax_kind || DEFAULT_TAX_KIND : DEFAULT_TAX_KIND,
  );
  const [advOpen, setAdvOpen] = useState(false);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    const nm = name.trim();
    if (!nm) {
      setErr("Введите название");
      return;
    }
    setSaving(true);
    setErr("");
    let res;
    if (mode === "edit")
      res = await authFetch(`/api/categories/${cat.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nm, tax_kind: taxKind }),
      });
    else
      res = await authFetch(`/api/categories/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: nm,
          group_id: groupId,
          tax_kind: taxKind,
        }),
      });
    setSaving(false);
    if (res.ok) {
      onSaved(mode === "edit" ? "Статья сохранена" : "Статья добавлена");
      return;
    }
    if (res.status === 409) {
      setErr("Статья с таким названием уже существует");
      return;
    }
    if (res.status === 400) {
      setErr("Недопустимый вид расхода");
      return;
    }
    setErr("Не удалось сохранить, попробуйте ещё раз");
  };
  return (
    <BottomSheet
      title={mode === "edit" ? "Переименовать статью" : "Новая статья"}
      onClose={onClose}
    >
      <label style={FIELD_LBL}>Название</label>
      <input
        autoFocus={mode === "create"}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Например: Подписки на сервисы"
        aria-label="Название статьи"
        style={FIELD_INP}
      />
      <label style={FIELD_LBL}>Группа</label>
      {mode === "edit" ? (
        <div
          style={{
            ...FIELD_INP,
            color: theme.fg2,
            background: theme.surfaceSunk,
          }}
        >
          {group ? group.name : "—"}
        </div>
      ) : (
        <select
          value={groupId}
          onChange={(e) => setGroupId(Number(e.target.value))}
          style={FIELD_INP}
        >
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      )}
      <button
        onClick={() => setAdvOpen((o) => !o)}
        style={{
          border: "none",
          background: "none",
          color: theme.fg2,
          fontSize: 12,
          fontFamily: FONT,
          cursor: "pointer",
          padding: "12px 0 2px",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <span
          style={{
            transform: advOpen ? "rotate(90deg)" : "none",
            transition: "transform 0.15s",
            display: "inline-block",
          }}
        >
          ›
        </span>{" "}
        Расширенные настройки
      </button>
      {advOpen && (
        <div>
          <label style={FIELD_LBL}>Вид расхода для налогов</label>
          <select
            value={taxKind}
            onChange={(e) => setTaxKind(e.target.value)}
            style={FIELD_INP}
          >
            {TAX_KINDS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <div
            style={{
              fontSize: 11,
              color: theme.fg3,
              fontFamily: FONT,
              marginTop: 5,
              lineHeight: 1.4,
            }}
          >
            Это поле для бухгалтера. Если не уверены — оставьте «Прочие
            расходы».
          </div>
        </div>
      )}
      {err && (
        <div
          style={{
            fontSize: 12,
            color: theme.cherry,
            fontFamily: FONT,
            marginTop: 10,
          }}
        >
          {err}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
        <Btn full loading={saving} onClick={save}>
          Сохранить
        </Btn>
        <Btn full outline onClick={onClose}>
          Отменить
        </Btn>
      </div>
    </BottomSheet>
  );
}

// Аккордеон 11 групп со статьями; CRUD над статьёй — через шторки действий/формы.
function CategoriesSection({ catalog, onCatalogRefresh }) {
  const [expanded, setExpanded] = useState({});
  const [actionCat, setActionCat] = useState(null); // {cat, group}
  const [form, setForm] = useState(null); // {mode, group, cat?}
  const [blocked, setBlocked] = useState(null); // {cat, count}
  const [toast, setToast] = useState("");
  const groups = catalog?.groups || [];
  const refresh = () => {
    if (onCatalogRefresh) onCatalogRefresh();
  };
  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2200);
  };

  const toggleVisibility = async (cat) => {
    const next = !(cat.is_visible !== false); // сейчас видимая → скрываем
    const res = await authFetch(`/api/categories/${cat.id}/visibility`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_visible: next }),
    });
    setActionCat(null);
    if (res.ok) {
      refresh();
      showToast(next ? "Статья показана" : "Статья скрыта");
    } else showToast("Не удалось изменить видимость");
  };
  const doDelete = async (cat) => {
    const res = await authFetch(`/api/categories/${cat.id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      setActionCat(null);
      refresh();
      showToast("Статья удалена");
      return;
    }
    if (res.status === 409) {
      const body = await res.json().catch(() => null);
      const detail = body && body.detail;
      if (detail && detail.code === "category_has_receipts") {
        setActionCat(null);
        setBlocked({ cat, count: detail.count });
        return;
      }
    }
    showToast("Не удалось удалить");
  };
  const hideFromBlocked = async (cat) => {
    const res = await authFetch(`/api/categories/${cat.id}/visibility`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_visible: false }),
    });
    setBlocked(null);
    if (res.ok) {
      refresh();
      showToast("Статья скрыта");
    } else showToast("Не удалось скрыть");
  };

  return (
    <div>
      {groups.map((g) => {
        const col = groupColor(g.name);
        const open = !!expanded[g.id];
        const cats = g.categories || [];
        return (
          <div
            key={g.id}
            style={{
              marginBottom: 8,
              border: `1px solid ${theme.border}`,
              borderRadius: 10,
              overflow: "hidden",
            }}
          >
            <div
              onClick={() => setExpanded((e) => ({ ...e, [g.id]: !e[g.id] }))}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "11px 12px",
                cursor: "pointer",
                background: theme.surface,
              }}
            >
              <span
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: "50%",
                  background: col.fg,
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  flex: 1,
                  fontSize: 13,
                  fontWeight: 600,
                  color: C.dark,
                  fontFamily: FONT,
                }}
              >
                {g.name}
              </span>
              <span
                style={{ fontSize: 11, color: theme.fg3, fontFamily: FONT }}
              >
                {cats.length}
              </span>
              <span
                style={{
                  fontSize: 14,
                  color: theme.fg2,
                  transform: open ? "rotate(90deg)" : "none",
                  transition: "transform 0.15s",
                  display: "inline-block",
                }}
              >
                ›
              </span>
            </div>
            {open && (
              <div
                style={{ background: theme.surfaceSunk, padding: "2px 0 8px" }}
              >
                {cats.map((c) => {
                  const hidden = c.is_visible === false;
                  return (
                    <div
                      key={c.id}
                      onClick={() => setActionCat({ cat: c, group: g })}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "9px 14px",
                        cursor: "pointer",
                        opacity: hidden ? 0.5 : 1,
                      }}
                    >
                      <span
                        style={{
                          flex: 1,
                          fontSize: 13,
                          color: C.dark,
                          fontFamily: FONT,
                          textDecoration: hidden ? "line-through" : "none",
                        }}
                      >
                        {c.name}
                      </span>
                      {c.is_default && (
                        <span
                          title="Системная статья"
                          style={{ fontSize: 11, flexShrink: 0 }}
                        >
                          🔒
                        </span>
                      )}
                      <span
                        style={{
                          fontSize: 13,
                          color: theme.fg3,
                          flexShrink: 0,
                        }}
                      >
                        ›
                      </span>
                    </div>
                  );
                })}
                <div style={{ padding: "8px 14px 2px" }}>
                  <Btn
                    small
                    outline
                    onClick={() => setForm({ mode: "create", group: g })}
                  >
                    + Добавить статью
                  </Btn>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {actionCat && (
        <BottomSheet
          title={actionCat.cat.name}
          onClose={() => setActionCat(null)}
        >
          {actionCat.cat.is_default ? (
            <ActionRow onClick={() => toggleVisibility(actionCat.cat)}>
              {actionCat.cat.is_visible === false ? "Показать" : "Скрыть"}
            </ActionRow>
          ) : (
            <>
              <ActionRow
                onClick={() => {
                  const g = actionCat.group,
                    c = actionCat.cat;
                  setActionCat(null);
                  setForm({ mode: "edit", group: g, cat: c });
                }}
              >
                Переименовать
              </ActionRow>
              <ActionRow onClick={() => toggleVisibility(actionCat.cat)}>
                {actionCat.cat.is_visible === false ? "Показать" : "Скрыть"}
              </ActionRow>
              <ActionRow danger onClick={() => doDelete(actionCat.cat)}>
                Удалить
              </ActionRow>
            </>
          )}
        </BottomSheet>
      )}

      {form && (
        <CategoryFormSheet
          mode={form.mode}
          group={form.group}
          groups={groups}
          cat={form.cat}
          onClose={() => setForm(null)}
          onSaved={(msg) => {
            setForm(null);
            refresh();
            showToast(msg);
          }}
        />
      )}

      {blocked && (
        <BottomSheet title="Нельзя удалить" onClose={() => setBlocked(null)}>
          <div
            style={{
              fontSize: 14,
              color: C.dark,
              fontFamily: FONT,
              lineHeight: 1.5,
            }}
          >
            К статье «{blocked.cat.name}» привязано {blocked.count}{" "}
            {plural(blocked.count, ["чек", "чека", "чеков"])}. Их категория не
            будет потеряна — но если статья вам больше не нужна, её можно
            скрыть.
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
            <Btn full onClick={() => hideFromBlocked(blocked.cat)}>
              Скрыть статью
            </Btn>
            <Btn full outline onClick={() => setBlocked(null)}>
              Отменить
            </Btn>
          </div>
        </BottomSheet>
      )}

      {toast && (
        <div
          style={{
            position: "fixed",
            left: "50%",
            bottom: 90,
            transform: "translateX(-50%)",
            background: C.dark,
            color: theme.surface,
            padding: "10px 16px",
            borderRadius: 8,
            fontSize: 13,
            fontFamily: FONT,
            zIndex: 200,
            boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
            maxWidth: "90%",
            textAlign: "center",
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}

// ⚠️ КАНОН — design/handoff/templates/profile/Профиль.html, плотность
// «Плотный» (в каноне это data-density="dense"): ряд 11×15, отступ между
// группами 18, аватар 42. Значения взяты ИЗ ФАЙЛА, не на глаз.
// ⚠️ Расхождение с макетом — дефект, а не вкус: подписи, порядок групп
// и состав пунктов не меняются. Восьмого пункта здесь быть не может.
const ГРУППЫ_КАБИНЕТА = [
  {
    title: "Личные данные",
    items: [
      {
        key: "account",
        name: "Аккаунт",
        // ⚠️ ОТСТУПЛЕНИЕ ОТ КАНОНА, ОБЪЯВЛЕНО В T113. Канон: «Имя,
        // email, телефон». Канон не ошибался — содержимое изменили мы:
        // 29.08 «Мои карты» переехали сюда по решению владельца, и
        // подпись стала описывать три вещи из восьми. Подпись это
        // ОПИСАНИЕ содержимого, а не имя; имя «Аккаунт» не тронуто.
        // Три слова, потому что канон нигде не перечисляет больше трёх.
        sub: "Контакты, роль, карты",
        Icon: User,
        to: "Аккаунт",
      },
      {
        key: "security",
        name: "Безопасность",
        sub: "Пароль и вход",
        Icon: Shield,
        to: "Безопасность",
      },
    ],
  },
  {
    title: "Настройки",
    items: [
      {
        key: "cats",
        name: "Категории",
        sub: "Управление категориями",
        Icon: Tag,
        to: "Категории",
      },
      {
        key: "integrations",
        name: "Интеграции",
        sub: "ФНС, банк, распознавание",
        Icon: Plug,
        // ⚠️ Экран называется КАК ПУНКТ. Раньше вёл на "Сервисы",
        // и шапка показывала «Сервисы» при нажатии на «Интеграции» —
        // человек нажимал одно, попадал в другое. В каноне пункт
        // «Интеграции», значит и экран «Интеграции».
        to: "Интеграции",
      },
    ],
  },
  {
    title: "Компания",
    items: [
      {
        key: "org",
        name: "Организация",
        sub: "Реквизиты, налоговый режим",
        Icon: Building2,
        to: "Организация",
      },
      {
        key: "users",
        name: "Пользователи",
        sub: "Сотрудники и приглашения",
        Icon: Users,
        to: "Пользователи",
        adminOnly: true,
      },
      // ⚠️ У «Лицензий» подписи в каноне НЕТ — не дописываем свою.
      { key: "lic", name: "Лицензии", Icon: FileText, to: "Лицензии" },
    ],
  },
];

function инициалы(имя) {
  const части = (имя || "").trim().split(/\s+/).filter(Boolean);
  if (!части.length) return "—";
  return (части[0][0] + (части[1] ? части[1][0] : "")).toUpperCase();
}

// ⚠️ ОТДЕЛЬНЫЙ ЭКРАН, А НЕ СЕКЦИЯ. В каноне
// design/handoff/templates/profile/Профиль.html «Безопасность» — пункт
// хаба с подписью «Пароль и вход». До этапа ③ она была секцией внутри
// AccountTab, и пункт вёл на чужой экран с прокруткой — полумера,
// которую владелец и поймал приёмкой.
// ⚠️ САМОГО ЭКРАНА В КАНОНЕ НЕТ: во всём design/handoff/ слово
// «Безопасность» встречается только в хабе. Поэтому экран собран
// из существующей оболочки приложения — это не расхождение с макетом,
// макет об этом молчит.
export function SecurityTab({ me }) {
  const [showPwModal, setShowPwModal] = useState(false);
  // ⚠️ БЫЛО `alert("Скоро")` — системное окно с обещанием (Р-ОТКАЗЫ, T116).
  // Стало: подпись на месте. Обещание «скоро» без срока — то же, что мёртвая
  // кнопка: человек ждёт того, чего никто не обещал делать. Здесь сказано,
  // что доступно СЕЙЧАС, а не когда-нибудь.
  const [oauthПодсказка, setOauthПодсказка] = useState(false);
  const oauthSoon = () => setOauthПодсказка(true);
  const PROVIDERS = [
    ["yandex", "Я", "Яндекс", "#FC3F1D", "#fff"],
    ["google", "G", "Google", "#fff", "#4285F4"],
    ["mailru", "@", "Mail.ru", "#005FF9", "#fff"],
  ];
  const linked = (me && me.linked_providers) || [];
  const подписьOauth = oauthПодсказка && (
    <div
      style={{
        marginTop: 10,
        padding: "10px 12px",
        borderRadius: 8,
        background: "#FFFBEB",
        border: "1px solid #FDE68A",
        font: `400 12px/1.45 ${FONT}`,
        color: "#B45309",
      }}
    >
      Вход через сервисы пока не подключён. Работает вход по почте и паролю — им
      и пользуйтесь.
    </div>
  );
  return (
    <div style={{ padding: "12px 16px 80px" }}>
      {/* ⚠️ Заголовка «Безопасность» здесь нет намеренно: экран уже
          так назван в шапке. Тот же дубль, что сняли в «Аккаунте»
          вместе с «Личными данными» — T109. */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          background: theme.surface,
          border: `1px solid ${theme.border}`,
          borderRadius: 8,
          padding: "12px 14px",
          marginBottom: 14,
        }}
      >
        <span style={{ fontFamily: FONT, fontSize: 14, color: C.dark }}>
          Пароль ••••••••
        </span>
        <button
          onClick={() => setShowPwModal(true)}
          style={{
            border: `1px solid ${theme.border}`,
            background: theme.surface,
            borderRadius: 8,
            padding: "7px 14px",
            fontFamily: FONT,
            fontSize: 13,
            color: theme.cherry,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Изменить
        </button>
      </div>
      {/* ⚠️ БЫЛ ОБЫЧНЫЙ div, А НЕ ЗАГОЛОВОК: прибор его не видел вовсе,
          и начертание было не канонным (10px в разрядку вместо 600 15px).
          Второй блок экрана обязан иметь заголовок — правило вёрстки
          в docs/RULES-FRONTEND.md. */}
      <SectionHead title="Привязанные аккаунты" />
      {PROVIDERS.map(([key, icon, name, bg, fg]) => {
        const isLinked = linked.includes(key);
        return (
          <div
            key={key}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              background: theme.surface,
              border: `1px solid ${theme.border}`,
              borderRadius: 8,
              padding: "8px 12px",
              marginBottom: 6,
            }}
          >
            <span
              style={{
                width: 30,
                height: 30,
                borderRadius: "50%",
                background: bg,
                color: fg,
                border: bg === "#fff" ? `1px solid ${theme.border}` : "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: FONT,
                fontSize: 14,
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              {icon}
            </span>
            <span
              style={{ flex: 1, fontFamily: FONT, fontSize: 14, color: C.dark }}
            >
              {name}
            </span>
            <button
              onClick={oauthSoon}
              style={{
                border: `1px solid ${theme.border}`,
                background: theme.surface,
                borderRadius: 8,
                padding: "6px 12px",
                fontFamily: FONT,
                fontSize: 13,
                color: isLinked ? theme.cherry : theme.fg2,
                cursor: "pointer",
              }}
            >
              {isLinked ? "Отвязать" : "Привязать"}
            </button>
          </div>
        );
      })}
      {подписьOauth}
      {showPwModal && (
        <ChangePasswordModal onClose={() => setShowPwModal(false)} />
      )}
    </div>
  );
}

export function ProfileHub({ role, me, onOpen, onLogout }) {
  const [запрос, setЗапрос] = useState("");
  const текст = запрос.trim().toLowerCase();
  const группы = ГРУППЫ_КАБИНЕТА
    .map((г) => ({
      ...г,
      items: г.items.filter(
        (п) =>
          (!п.adminOnly || role === "admin") &&
          (!текст ||
            (п.name + " " + (п.sub || "")).toLowerCase().includes(текст)),
      ),
    }))
    .filter((г) => г.items.length);

  const имя =
    // ⚠️ ИМЯ ВПЕРЕДИ ФАМИЛИИ — так в каноне: «Иван Петров».
    // Было наоборот, поймано снимком, а не сверкой: сверка читала
    // список пунктов и карточку не смотрела вовсе.
    [me?.first_name, me?.last_name].filter(Boolean).join(" ") ||
    me?.email ||
    "Профиль";
  // ⚠️ ИЗ ОБЩЕГО СПРАВОЧНИКА, А НЕ ВТОРОЙ КОПИЕЙ. Две копии подписей
  // разошлись бы при первой же правке — ровно так «Руководитель» и жил
  // в двух местах при отсутствии роли.
  const РОЛИ = ROLE_LABEL;

  return (
    <div>
      {/* ⚠️ ОТСТУПЛЕНИЯ.ПоискБезПолосы (T142, решение владельца 31.08.2026):
          канон рисует поиск в БЕЛОЙ полосе с нижней рамкой — мы её сняли,
          эталон «Главная»: поле прямо на сером, боковые 16, до контента 22. */}
      <div style={{ padding: "16px 16px 22px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            background: theme.surfaceSunk,
            borderRadius: 10,
            padding: "11px 12px",
          }}
        >
          <Search size={18} color={theme.fg3} aria-hidden="true" />
          <input
            value={запрос}
            onChange={(e) => setЗапрос(e.target.value)}
            placeholder="Поиск по настройкам"
            aria-label="Поиск по настройкам"
            style={{
              flex: 1,
              minWidth: 0,
              border: "none",
              background: "none",
              outline: "none",
              /* T144-эталон 40: прошивка input даёт 1px/1px — обнулено */
              padding: 0,
              /* T138: кегль 16 (Safari не зумит), строка ФИКСОМ 18px — полоса остаётся 40 */
              font: `400 16px/18px ${FONT}`,
              color: theme.fg1,
            }}
          />
        </div>
      </div>

      <div
        style={{
          // ⚠️ 80px снизу, а не 24: нижняя навигация лежит ПОВЕРХ экрана,
          // и при 24px «Выйти» и строка сборки уходили под панель
          // «Главная · Сводка · Чеки · Отчёты». У прежних экранов настроек
          // тут и стоит 80 — я это при переносе потерял.
          /* T142-воздух: верхние 16 снят — их несёт полоса поиска (22),
             вместе выходило 38 против эталонных 22 «Главной» */
          padding: "0 16px 80px",
          display: "flex",
          flexDirection: "column",
          gap: 18,
        }}
      >
        <div
          style={{
            background: theme.surface,
            borderRadius: 12,
            boxShadow: "0 1px 3px rgba(17,19,24,.08)",
            display: "flex",
            alignItems: "center",
            gap: 13,
            padding: "12px 14px",
          }}
        >
          <div
            style={{
              width: 42,
              height: 42,
              borderRadius: 999,
              background: theme.surfaceSunk,
              color: theme.fg2,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              font: `600 15px/1 ${FONT}`,
              flexShrink: 0,
            }}
          >
            {инициалы(имя)}
          </div>
          <div>
            <div style={{ font: `600 16px/1.25 ${FONT}`, color: theme.fg1 }}>
              {имя}
            </div>
            {role && (
              <span
                style={{
                  display: "inline-block",
                  marginTop: 6,
                  background: theme.cherry,
                  color: "#fff",
                  borderRadius: 999,
                  font: `500 11px/1.3 ${FONT}`,
                  padding: "3px 9px",
                }}
              >
                {РОЛИ[role] || role}
              </span>
            )}
          </div>
        </div>

        {группы.map((г) => (
          <div key={г.title}>
            <div
              style={{
                font: `600 15px/1.2 ${FONT}`,
                color: theme.fg1,
                marginBottom: 10,
              }}
            >
              {г.title}
            </div>
            <div
              style={{
                background: theme.surface,
                borderRadius: 12,
                boxShadow: "0 1px 3px rgba(17,19,24,.08)",
                overflow: "hidden",
              }}
            >
              {г.items.map((п, i) => (
                <button
                  key={п.key}
                  data-ekran={п.to}
                  onClick={() => onOpen(п.to, п.anchor)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    width: "100%",
                    boxSizing: "border-box",
                    textAlign: "left",
                    background: "none",
                    border: "none",
                    borderTop: i ? `1px solid #F1F3F6` : "none",
                    cursor: "pointer",
                    fontFamily: FONT,
                    padding: "11px 15px",
                  }}
                >
                  <span
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 999,
                      background: theme.surfaceSunk,
                      color: theme.fg2,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <п.Icon size={18} strokeWidth={1.75} aria-hidden="true" />
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span
                      style={{
                        display: "block",
                        font: `500 15px/1.25 ${FONT}`,
                        color: theme.fg1,
                      }}
                    >
                      {п.name}
                    </span>
                    {п.sub && (
                      <span
                        style={{
                          display: "block",
                          font: `400 13px/1.2 ${FONT}`,
                          color: theme.fg2,
                          marginTop: 3,
                        }}
                      >
                        {п.sub}
                      </span>
                    )}
                  </span>
                  <ChevronRight
                    size={18}
                    color={theme.fg3}
                    aria-hidden="true"
                    style={{ flexShrink: 0 }}
                  />
                </button>
              ))}
            </div>
          </div>
        ))}

        {!группы.length && (
          <div
            style={{
              padding: "28px 0",
              textAlign: "center",
              color: theme.fg2,
              fontFamily: FONT,
              fontSize: 13,
            }}
          >
            Ничего не нашлось
          </div>
        )}

        <button
          onClick={onLogout}
          style={{
            display: "block",
            width: "100%",
            boxSizing: "border-box",
            textAlign: "center",
            // ⚠️ ОТСТУПЛЕНИЕ ОТ КАНОНА, ОБЪЯВЛЕНО В T113. В каноне .out
            // идёт без подложки, и код совпадал с ним дословно. Владелец:
            // кнопка теряется. Причина НЕ В ЦВЕТЕ, а в отсутствии
            // поверхности — на этом экране каждое действие лежит на белой
            // карточке, и «Выйти» была единственным действием прямо
            // на сером фоне. Добавлена та же подложка; НАЧЕРТАНИЕ И ЦВЕТ
            // НЕ ТРОНУТЫ — это не усиление акцентом, а приведение
            // к системе того же макета.
            background: theme.surface,
            borderRadius: 12,
            boxShadow: "0 1px 3px rgba(17,19,24,.08)",
            border: "none",
            font: `500 15px/1 ${FONT}`,
            color: theme.fg2,
            padding: "14px 0",
            cursor: "pointer",
          }}
        >
          Выйти
        </button>

        <div
          style={{
            fontSize: 10,
            color: theme.fg3,
            fontFamily: FONT,
            textAlign: "center",
            letterSpacing: "0.04em",
          }}
        >
          Сборка от {__BUILD_TIME__}
        </div>
      </div>
    </div>
  );
}

// ⚠️ ПОДЭКРАНЫ КАБИНЕТА — ОТДЕЛЬНЫЕ КОМПОНЕНТЫ, А НЕ ВЕТКИ ОДНОГО
// RETURN. NastroykiPage разбух до маршрутизатора с шестью встроенными
// экранами; теперь он только выбирает, что показать. Содержимое обоих
// перенесено ДОСЛОВНО — этап ② про маршрут, не про правку экранов.
// ⚠️ «Пользователи» СОЗНАТЕЛЬНО ОСТАВЛЕНЫ ВНУТРИ: их внутренности целиком
// переписывает T104 (одна кнопка «Пригласить» вместо двух, статус
// «приглашён, ожидает»). Двигать 126 строк за день до переписывания —
// шум в diff и лишний повод для конфликта.
export function ServicesTab({ servicesList, сбойУслуг, onRetry }) {
  return (
    <div style={{ padding: "12px 16px 80px" }}>
      {/* ⚠️ Пустой список читается как «других приложений нет» (T171). */}
      {сбойУслуг && (
        <div style={{ marginBottom: 12 }}>
          <LoadFailure что="список приложений" onRetry={onRetry} />
        </div>
      )}
      {/* ⚠️ Заголовка нет: экран уже назван «Интеграции» в шапке.
          Четвёртый дубль того же класса — и первый, который нашёл
          ПРИБОР, а не владелец глазами. */}
      {servicesList.map((s) => (
        <ServiceCard key={s.key} svc={s} />
      ))}
      {servicesList.length === 0 && (
        <div
          style={{
            fontSize: 12,
            color: theme.fg3,
            fontFamily: FONT,
            padding: "10px 0",
          }}
        >
          Загрузка…
        </div>
      )}
    </div>
  );
}

// ⚠️ ЭТО ЭКРАН «КАТЕГОРИИ», А НЕ «ОБЩИЕ». Прежняя вкладка «Общие» держала
// две несвязанные вещи — категории и карты. Карты уехали в «Аккаунт»
// (решение владельца: карта не интеграция, а личный справочник),
// в каноне восьмого пункта нет и заводить его нельзя.
export function CategoriesTab({ role, catalog, onCatalogRefresh }) {
  return (
    <div style={{ padding: "12px 16px 80px" }}>
      {/* ⚠️ Заголовка нет: экран уже назван «Категории» в шапке,
          а «Управление категориями» — это подпись пункта в хабе.
          Тот же дубль, что сняли в «Аккаунте» и «Безопасности». */}
      {role === "admin" || role === "accountant" ? (
        <CategoriesSection
          catalog={catalog}
          onCatalogRefresh={onCatalogRefresh}
        />
      ) : (
        <div
          style={{
            padding: "12px 2px",
            color: theme.fg2,
            fontSize: 13,
            fontFamily: FONT,
            lineHeight: 1.5,
          }}
        >
          Управление категориями доступно администратору и бухгалтеру
        </div>
      )}
    </div>
  );
}

export function NastroykiPage({
  me,
  экран,
  наЭкран,
  cards,
  onAddCard,
  onUpdateCard,
  onDeleteCard,
  onSetDefaultCard,
  users,
  onDeleteUser,
  // ⚠️ ОБЪЯВЛЕН ЯВНО, И ИМЕННО ЭТОГО НЕ ХВАТАЛО T118 С 13.06.2026:
  // `onUpdateUser` передавался сюда из App и молча выбрасывался, потому что
  // в этом списке его не было. Смена роли не работала вовсе, и увидеть это
  // было нельзя — ни ошибки, ни предупреждения.
  onUpdateUser,
  // ⚠️ ОБЪЯВЛЕН ЯВНО. `onUpdateUser` передавался сюда с 13.06.2026 и молча
  // выбрасывался, потому что в этом списке его не было — смена роли не
  // работала вовсе и никто этого не видел. Повторять не будем.
  onRestoreUser,
  role,
  catalog,
  onCatalogRefresh,
}) {
  // ⚠️ СВОЕГО СОСТОЯНИЯ ЭКРАНА ЗДЕСЬ НЕТ — оно поднято в App, потому
  // что подпись в шапке рисуется там. Компонент стал маршрутизатором:
  // null — хаб по канону, иначе подэкран с возвратом.
  const tab = экран;
  const setTab = наЭкран;
  const [якорь, setЯкорь] = useState(null);
  const [showInvite, setShowInvite] = useState(false);
  const [servicesList, setServicesList] = useState([]);
  useEffect(() => {
    if (!якорь) return;
    const t = setTimeout(() => {
      const у = document.getElementById(якорь);
      if (у) у.scrollIntoView({ block: "start", behavior: "smooth" });
      setЯкорь(null);
    }, 60);
    return () => clearTimeout(t);
  }, [якорь, tab]);

  const [invites, setInvites] = useState([]);
  const [copiedToken, setCopiedToken] = useState(null);
  const [историяОткрыта, setИсторияОткрыта] = useState(false);
  // Разбор списка на два: признак `отработала` считает сервер по `is_active`
  // (23db3b1). Порядок внутри каждого — уже правильный, его задаёт ORDER BY.
  const живыеПриглашения = invites.filter((i) => !i["отработала"]);
  const отработавшиеПриглашения = invites.filter((i) => i["отработала"]);

  const [resentToken, setResentToken] = useState(null);
  const [ошибкаПриглашений, setОшибкаПриглашений] = useState("");
  // T171: пустой переключатель приложений и «список услуг не пришёл».
  const [сбойУслуг, setСбойУслуг] = useState(false);
  const [попыткаУслуг, setПопыткаУслуг] = useState(0);

  // ⚠️ «СПИСОК ПУСТ» И «СПИСОК НЕ ЗАГРУЗИЛСЯ» — РАЗНЫЕ ВЕЩИ (класс T169, тот же
  // случай, что чинили на экране входа по ссылке). Отказ молча превращался в
  // пустой массив, и человек читал «нет ожидающих приглашений», хотя сервер
  // просто не ответил: он шёл выписывать второе приглашение вместо того, чтобы
  // обновить экран.
  const [сбойСписка, setСбойСписка] = useState(false);

  const loadInvites = () =>
    authFetch(`/api/invite/list`)
      .then((r) => r.json())
      .then((d) => {
        setInvites(Array.isArray(d) ? d : []);
        setСбойСписка(false);
      })
      .catch(() => setСбойСписка(true));
  // ⚠️ ОДНА РАЗМЕТКА НА ОБА СПИСКА. Живые и отработавшие показываются в разных
  // местах экрана, но это одна и та же карточка приглашения: вторая копия
  // разошлась бы с первой молча — тот же класс, что копии словарей и правил.
  const приглашение = (inv) => (
    <div
      key={inv.token}
      style={{
        background: theme.surface,
        border: `1px solid ${theme.border}`,
        borderRadius: 12,
        padding: "12px 14px",
        marginBottom: 8,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: theme.fg1,
            fontFamily: FONT,
          }}
        >
          {[inv.first_name, inv.last_name].filter(Boolean).join(" ") ||
            inv.email ||
            "Без имени"}
        </span>
        <span
          style={{
            fontSize: 12,
            color: theme.fg2,
            fontFamily: FONT,
          }}
        >
          {roleLabel(inv.role)}
        </span>
      </div>

      {/* ⚠️ СТАТУС СЛОВАМИ, А НЕ ДРОБЬЮ. Было «0/1 исп.» — человек
    не может по этому понять, ждут его или он уже вошёл. */}
      <div
        style={{
          fontSize: 12,
          color: theme.fg2,
          fontFamily: FONT,
          marginTop: 4,
        }}
      >
        {inv["статус"] || "приглашён, ожидает"}
        {inv.sent_at
          ? ` · письмо ${new Date(inv.sent_at).toLocaleDateString("ru-RU")}`
          : inv.email
            ? " · письмо не отправлялось"
            : " · общая ссылка, адресата нет"}
      </div>

      {/* ⚠️ СРОК И ПЕРЕХОДЫ ВИДНЫ У КАЖДОЙ ССЫЛКИ, а у общей это
    единственный способ понять, что с ней происходит: адресата
    у неё нет, и «ждут ли кого-то» по имени не прочитать.
    Оба числа приходят в /api/invite/list, показывать их было
    нечем — строки просто не было. */}
      <div
        style={{
          fontSize: 12,
          color: theme.fg2,
          fontFamily: FONT,
          marginTop: 2,
        }}
      >
        {inv.expires_at
          ? `действует до ${new Date(inv.expires_at).toLocaleString("ru-RU", {
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}`
          : "без срока"}
        {` · переходов ${inv.uses_count ?? 0} из ${inv.max_uses ?? 1}`}
      </div>

      {/* ⚠️ У ОТРАБОТАВШЕЙ ГЛАВНОЕ — КОГО ЗАВЕЛИ. Ради этого и заведена
        колонка `used_by_user_id` (23db3b1): раньше по погашенной ссылке
        нельзя было сказать, кто по ней вошёл, вообще никак. */}
      {inv["отработала"] && (
        <div
          style={{
            fontSize: 12,
            color: theme.fg2,
            fontFamily: FONT,
            marginTop: 2,
          }}
        >
          {inv["вошёл"]
            ? `вошёл: ${inv["вошёл"]}` +
              (inv.used_at
                ? ` · ${new Date(inv.used_at).toLocaleString("ru-RU", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}`
                : "")
            : // ⚠️ СЛОВОМ, А НЕ ПУСТОТОЙ И НЕ ДОГАДКОЙ. У восьми старых ссылок
              // отметки нет и быть не может: связи в базе не существовало, а
              // сопоставление по времени на проде дало НЕВЕРНЫЙ ответ. Пустое
              // место человек прочитал бы как «никто не вошёл» — это неправда.
              "кто вошёл — неизвестно: ссылка выдана до того, как это стали записывать"}
        </div>
      )}

      {/* ⚠️ ССЫЛКА ВИДНА ВСЕГДА. Раньше её показывали ровно один
    раз — в момент создания, — и скопировать вслепую было
    единственным способом. Находка владельца. */}
      <div
        style={{
          background: theme.surfaceSunk,
          borderRadius: 8,
          padding: "8px 10px",
          marginTop: 8,
          fontSize: 11,
          color: theme.fg2,
          fontFamily: theme.fontMono || "monospace",
          wordBreak: "break-all",
        }}
      >
        {inv.invite_url}
      </div>

      <div
        style={{
          display: "flex",
          gap: 8,
          marginTop: 10,
          flexWrap: "wrap",
        }}
      >
        <Btn small onClick={() => copyInvite(inv)}>
          {copiedToken === inv.token ? "Скопировано ✓" : "Скопировать"}
        </Btn>
        {inv.email && (
          <Btn small outline onClick={() => resendInvite(inv)}>
            {resentToken === inv.token ? "Отправлено ✓" : "Отправить ещё раз"}
          </Btn>
        )}
        <Btn small outline onClick={() => delInvite(inv.token)}>
          Отозвать
        </Btn>
      </div>
    </div>
  );

  // ⚠️ ДЕЙСТВИЕ, А НЕ ЗАГРУЗКА (класс T116): «Отозвать» молча ничего не
  // делало при отказе — ссылка оставалась живой, а человек считал её
  // погашенной и переставал следить за ней.
  const delInvite = (token) =>
    authFetch(`/api/invite/${token}`, { method: "DELETE" })
      .then((r) => {
        if (!r.ok) throw new Error("отказ");
        return loadInvites();
      })
      .catch(() =>
        setОшибкаПриглашений(
          "Не удалось отозвать приглашение — ссылка осталась рабочей. Попробуйте ещё раз",
        ),
      );
  const copyInvite = async (inv) => {
    setОшибкаПриглашений("");
    try {
      await navigator.clipboard.writeText(inv.invite_url);
      setCopiedToken(inv.token);
      setTimeout(() => setCopiedToken(null), 1500);
    } catch {
      // ⚠️ РАНЬШЕ ЗДЕСЬ БЫЛО ПУСТО. Буфер мог не сработать, и человек
      // уходил с пустым буфером, уверенный, что скопировал. Класс T116,
      // находка владельца.
      setОшибкаПриглашений(
        "Не удалось скопировать. Ссылка показана выше — выделите её вручную",
      );
    }
  };

  // ⚠️ ТОТ ЖЕ ТОКЕН, а не новое приглашение: иначе на каждое нажатие
  // в списке рос бы дубль на одного человека.
  const resendInvite = async (inv) => {
    setОшибкаПриглашений("");
    try {
      const res = await authFetch(`/api/invite/${inv.token}/resend`, {
        method: "POST",
      });
      const тело = await res.json().catch(() => null);
      if (!res.ok) {
        setОшибкаПриглашений(текстОшибки(тело, `Сервер ответил ${res.status}`));
        return;
      }
      setResentToken(inv.token);
      setTimeout(() => setResentToken(null), 2000);
      loadInvites();
    } catch {
      setОшибкаПриглашений("Нет связи с сервером");
    }
  };

  useEffect(() => {
    authFetch(`/api/services/`)
      .then((r) => r.json())
      .then((d) => {
        setServicesList(Array.isArray(d) ? d : []);
        setСбойУслуг(false);
      })
      // ⚠️ Пустой список приложений выглядит как «других приложений нет» (T171).
      .catch(() => setСбойУслуг(true));
    loadInvites();
  }, [попыткаУслуг]);

  // ⚠️ Считаем здесь, а не в строке: иначе счёт шёл бы на каждую строку
  // списка. Бэкенд остаётся хозяином правила — фронт лишь не предлагает
  // действие, которое всё равно будет отвергнуто (правило «интерфейс
  // не обещает больше, чем умеет бэкенд»).
  // ⚠️ ТОЛЬКО АКТИВНЫЕ. С 31.08.2026 список отдаёт и погашенных (T118/④),
  // и прежний счёт принял бы отключённого админа за живого: запрет «нельзя
  // снять последнего» перестал бы срабатывать ровно там, где он нужен.
  const [меняемРоль, setМеняемРоль] = useState(null);
  const активныхАдминов = (users || []).filter(
    (u) => u.role === "admin" && u.is_active !== false,
  ).length;

  // Хвост S-29: управление людьми на бэкенде только у админа
  // (_require_admin). Гейт переехал из ленты вкладок в состав хаба —
  // умолчание закрытое: role === null это «ещё не пришла с /api/users/me».
  if (tab === null)
    return (
      <ProfileHub
        role={role}
        me={me}
        onOpen={(куда, к) => {
          setTab(куда);
          setЯкорь(к || null);
        }}
        // ⚠️ ЗОВЁМ НАСТОЯЩИЙ logout(), а не чистим хранилище руками.
        // Он ещё и гасит сессию на бэкенде; моя первая редакция хаба
        // этого не делала, и refresh-токен оставался жить на сервере.
        // Всплыло, когда единственная кнопка «Выйти» осталась в хабе.
        onLogout={logout}
      />
    );

  return (
    <div>
      <button
        onClick={() => setTab(null)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: "none",
          border: "none",
          cursor: "pointer",
          fontFamily: FONT,
          fontSize: 14,
          color: theme.fg2,
          padding: "12px 14px",
        }}
      >
        <ChevronLeft size={18} aria-hidden="true" />
        Профиль
      </button>
      {tab === "Аккаунт" && (
        <AccountTab
          cards={cards}
          onAddCard={onAddCard}
          onUpdateCard={onUpdateCard}
          onDeleteCard={onDeleteCard}
          onSetDefaultCard={onSetDefaultCard}
        />
      )}
      {tab === "Безопасность" && <SecurityTab me={me} />}
      {tab === "Организация" && (
        <OrganizationTab
          authFetch={authFetch}
          role={role}
          Btn={Btn}
          fmtDate={fmtDate}
        />
      )}
      {tab === "Лицензии" && (
        <div style={{ padding: "60px 24px", textAlign: "center" }}>
          <div style={{ fontFamily: FONT, fontSize: 13, color: theme.fg3 }}>
            Управление лицензиями — скоро
          </div>
        </div>
      )}
      {tab === "Пользователи" && role === "admin" && (
        <div style={{ padding: "12px 16px 80px" }}>
          {/* ⚠️ Первый блок экрана идёт БЕЗ заголовка — правило вёрстки
              docs/RULES-FRONTEND.md, раздел о подэкранах. */}
          {users.map((u) => (
            <SwipeableUserRow
              key={u.id}
              user={u}
              // ⚠️ УСЛОВИЕ ОДНО, И ОНО ЗЕРКАЛИТ БЭКЕНД (порядок ③, 31.08.2026).
              // Раньше здесь стояло отдельное `u.id !== me?.id` — безусловный
              // запрет на себя. Он был верен ровно при одном администраторе;
              // при двух отменить может второй, и запрет только мешал уйти.
              // Две двери с разными условиями однажды чинят по одной.
              deletable={
                !(
                  u.role === "admin" &&
                  u.is_active !== false &&
                  активныхАдминов <= 1
                )
              }
              onDelete={() => onDeleteUser(u.id)}
              onRestore={onRestoreUser ? () => onRestoreUser(u.id) : undefined}
              // ⚠️ ТАП ОТКРЫВАЕТ РОЛЬ У ЛЮБОЙ СТРОКИ, включая свою и
              // последнего администратора. Отказ там объясняет сервер, и это
              // честнее немого ряда: спрятанная кнопка не говорит ничего.
              onTap={onUpdateUser ? () => setМеняемРоль(u) : undefined}
            />
          ))}
          {users.length === 0 && (
            <div
              style={{
                fontSize: 12,
                color: theme.fg3,
                fontFamily: FONT,
                padding: "10px 0",
              }}
            >
              Пока нет сотрудников
            </div>
          )}

          <div style={{ marginTop: 18 }}>
            <SectionHead title="Приглашения" />
            {/* ⚠️ ЖИВЫЕ И ОТРАБОТАВШИЕ — РАЗНЫЕ СПИСКИ, И ЭТО НЕ УКРАШЕНИЕ.
                С 23db3b1 бэкенд отдаёт ВСЕ приглашения: одноразовая ссылка
                гаснет сразу после регистрации, и без погашенных не видно
                истории вовсе. Но в базе их большинство — вперемешку они
                завалили бы собой те, с которыми ещё работают. */}
            {сбойСписка ? (
              <div
                style={{
                  fontSize: 12,
                  color: theme.fg2,
                  fontFamily: FONT,
                  padding: "4px 2px",
                  lineHeight: 1.5,
                }}
              >
                Не удалось загрузить приглашения — сервер не ответил. Это не
                значит, что их нет.{" "}
                <button
                  onClick={loadInvites}
                  style={{
                    border: "none",
                    background: "none",
                    padding: 0,
                    color: theme.cherry,
                    fontFamily: FONT,
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  Загрузить ещё раз
                </button>
              </div>
            ) : (
              живыеПриглашения.length === 0 && (
                <div
                  style={{
                    fontSize: 12,
                    color: theme.fg3,
                    fontFamily: FONT,
                    padding: "4px 2px",
                  }}
                >
                  Нет ожидающих приглашений
                </div>
              )
            )}
            {живыеПриглашения.map((inv) => приглашение(inv))}

            {отработавшиеПриглашения.length > 0 && (
              <div style={{ marginTop: 14 }}>
                {/* Свёрнуто по умолчанию: история нужна изредка, а места
                    занимает больше всего. */}
                <button
                  onClick={() => setИсторияОткрыта((о) => !о)}
                  aria-expanded={историяОткрыта}
                  style={{
                    border: "none",
                    background: "none",
                    padding: "6px 2px",
                    cursor: "pointer",
                    fontFamily: FONT,
                    fontSize: 12,
                    fontWeight: 600,
                    color: theme.fg2,
                  }}
                >
                  Отработавшие ({отработавшиеПриглашения.length}){" "}
                  {историяОткрыта ? "▴" : "▾"}
                </button>
                {историяОткрыта &&
                  отработавшиеПриглашения.map((inv) => приглашение(inv))}
              </div>
            )}
            {ошибкаПриглашений && (
              <div
                role="alert"
                style={{
                  background: theme.errorBg,
                  color: theme.errorFg,
                  border: `1px solid ${theme.errorBd}`,
                  borderRadius: 8,
                  padding: "10px 12px",
                  fontFamily: FONT,
                  fontSize: 13,
                  marginTop: 8,
                }}
              >
                {ошибкаПриглашений}
              </div>
            )}
          </div>

          {/* ⚠️ ОДНА КНОПКА. Было две — «Добавить сотрудника» и «Создать
              ссылку-приглашение», — и два пути к одному итогу, из которых
              первый заводил человека без пароля и не слал ему ничего. */}
          <div style={{ marginTop: 16 }}>
            <Btn full onClick={() => setShowInvite(true)}>
              + Пригласить сотрудника
            </Btn>
          </div>
        </div>
      )}
      {tab === "Интеграции" && (
        <ServicesTab
          servicesList={servicesList}
          сбойУслуг={сбойУслуг}
          onRetry={() => setПопыткаУслуг((н) => н + 1)}
        />
      )}
      {tab === "Категории" && (
        <CategoriesTab
          role={role}
          catalog={catalog}
          onCatalogRefresh={onCatalogRefresh}
        />
      )}
      {меняемРоль && (
        <RoleSheet
          user={меняемРоль}
          onClose={() => setМеняемРоль(null)}
          onApply={(роль) => onUpdateUser(меняемРоль.id, { role: роль })}
        />
      )}
      {showInvite && (
        <InviteSheet
          onClose={() => {
            setShowInvite(false);
            loadInvites();
          }}
          onCreated={loadInvites}
        />
      )}
    </div>
  );
}

// ─── CONSENT (152-FZ) ──────────────────────────────────────────────
//
// On first launch we present an opt-in screen with two unchecked boxes
// (privacy policy + personal-data processing). Both must be ticked before
// "Продолжить" enables. Tapping each link opens a bottom-sheet.
//
// S-34/S-36: НИ ОДНОГО юридического текста здесь больше нет — ни согласия,
// ни политики. Оба приходят ручкой GET /api/consent/policy (src/lib/policy.js),
// оба живут файлами юриста в docs/ репозитория бэкенда. Копия в этом файле
// уже расходилась с бэкендом молча, и в журнал сохранялась редакция, которой
// человек не видел; политика объявлена неотъемлемой частью согласия, поэтому
// держать её отдельно — та же мина с другой стороны.

function ConsentBottomSheet({ title, text, onClose }) {
  const dialogRef = useModalA11y(onClose);
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(22,26,29,0.5)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        zIndex: 300,
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: theme.surface,
          width: "100%",
          maxWidth: 480,
          maxHeight: "80dvh",
          borderRadius: "16px 16px 0 0",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          paddingBottom: "env(safe-area-inset-bottom)",
          outline: "none",
        }}
      >
        <div
          style={{
            padding: "14px 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: `1px solid ${theme.border}`,
          }}
        >
          <span
            style={{
              fontFamily: FONT,
              fontSize: 14,
              fontWeight: 600,
              color: C.dark,
            }}
          >
            {title}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            style={{
              border: "none",
              background: "none",
              color: theme.fg2,
              cursor: "pointer",
              fontSize: 20,
              padding: 4,
              lineHeight: 1,
            }}
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>
        <div style={{ overflow: "auto", padding: "16px 18px" }}>
          {/* S-36: редакция юриста — markdown с заголовками и таблицами
              правовых оснований. В простом тексте таблица приезжала бы
              палками, а согласие принимается на ПОЛНЫЙ документ. */}
          <LegalText text={text} />
        </div>
        <div
          style={{
            padding: "12px 16px",
            borderTop: `1px solid ${theme.border}`,
            background: theme.surfaceSunk,
          }}
        >
          <button
            onClick={onClose}
            style={{
              width: "100%",
              padding: "12px",
              background: theme.surface,
              border: `1px solid ${theme.border}`,
              borderRadius: 10,
              fontFamily: FONT,
              fontSize: 13,
              color: C.dark,
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}

function ConsentCheckbox({ checked, onToggleCheck, onOpenSheet, label }) {
  // Two distinct hit-targets:
  //   - the box itself toggles the checkbox
  //   - the label opens the corresponding bottom-sheet
  // This matches the spec: "тап на текст открывает bottom-sheet". Checking
  // the box requires an explicit, separate action.
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        padding: "4px 0",
      }}
    >
      <button
        onClick={onToggleCheck}
        aria-pressed={checked}
        aria-label="Отметить"
        style={{
          flexShrink: 0,
          width: 22,
          height: 22,
          marginTop: 1,
          borderRadius: 5,
          border: `1.5px solid ${checked ? theme.cherry : theme.border}`,
          background: checked ? theme.cherry : theme.surface,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          transition: "all 120ms ease",
          padding: 0,
        }}
      >
        {checked && (
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#fff"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </button>
      <button
        onClick={onOpenSheet}
        style={{
          flex: 1,
          textAlign: "left",
          background: "none",
          border: "none",
          padding: 0,
          cursor: "pointer",
          fontFamily: FONT,
          fontSize: 13,
          color: C.dark,
          lineHeight: 1.45,
        }}
      >
        {label}
      </button>
    </div>
  );
}

function ConsentScreen({ onAccept }) {
  const [policyChecked, setPolicyChecked] = useState(false);
  const [dataChecked, setDataChecked] = useState(false);
  const [sheet, setSheet] = useState(null); // null | "policy" | "consent"
  const [submitting, setSubmitting] = useState(false);
  // S-34: текст согласия и его версия приходят С БЭКЕНДА — там единственный
  // источник. Локальной копии здесь нет намеренно: две копии уже разошлись
  // молча, и в журнал сохранялась редакция, которой человек не видел.
  const [согласие, setСогласие] = useState(null); // {version, text}
  const [ошибкаТекста, setОшибкаТекста] = useState(false);
  useEffect(() => {
    загрузитьСогласие()
      .then(setСогласие)
      .catch(() => setОшибкаТекста(true));
  }, []);
  // Согласиться с текстом, которого не видел, нельзя — поэтому кнопка ждёт
  // загрузку. Подставлять локальную заглушку «чтобы не блокировать» значит
  // вернуть вторую редакцию целиком.
  const canSubmit = policyChecked && dataChecked && !submitting && !!согласие;

  async function handleAccept() {
    if (!canSubmit) return;
    setSubmitting(true);
    // POST is best-effort: if the server is down we still persist locally so
    // the user isn't locked out. A future sync job (or settings screen) can
    // re-post when connectivity returns.
    try {
      // Строка 9: тело пустое. Субъекта берёт бэкенд из токена, адрес —
      // из запроса; клиент не может быть источником доказательства о себе.
      await authFetch(`/api/consent/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
    } catch {
      /* network failure tolerated */
    }
    try {
      localStorage.setItem("consent_given", "true");
      localStorage.setItem("consent_version", согласие.version);
      localStorage.setItem("consent_at", new Date().toISOString());
    } catch {
      /* private mode / storage disabled */
    }
    onAccept();
  }

  return (
    <div
      style={{
        // Та же мина, что у корневого контейнера приложения ниже: авто-отступ
        // в колоночном флексе (#root) отменяет растяжение, и maxWidth
        // превращается в заданную ширину. boxSizing нужен потому, что здесь
        // ЕСТЬ горизонтальный padding: при content-box он прибавился бы
        // к 100% и снова вылез бы за экран (T13).
        width: "100%",
        boxSizing: "border-box",
        maxWidth: 480,
        margin: "0 auto",
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        background: theme.bg,
        fontFamily: FONT,
        padding:
          "calc(env(safe-area-inset-top) + 48px) 24px calc(env(safe-area-inset-bottom) + 24px)",
      }}
    >
      {/* Logo */}
      <div
        style={{ display: "flex", justifyContent: "center", marginBottom: 24 }}
      >
        <div
          style={{
            width: 72,
            height: 72,
            background: "#fff",
            border: `1px solid ${theme.border}`,
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <svg
            width="60"
            height="14"
            viewBox="0 0 770 180"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M286.511 0C304.22 2.1117e-07 321.53 5.25113 336.254 15.0893C350.978 24.9276 362.454 38.911 369.231 55.2714C376.008 71.6317 377.781 89.6342 374.326 107.002C370.871 124.37 362.344 140.324 349.822 152.846C337.3 165.367 321.347 173.895 303.979 177.349C286.611 180.804 268.608 179.031 252.248 172.254C235.888 165.478 221.904 154.002 212.066 139.278C202.228 124.554 196.977 107.243 196.977 89.5349H230.233C230.233 100.666 233.534 111.546 239.718 120.801C245.902 130.056 254.691 137.269 264.975 141.529C275.258 145.788 286.574 146.903 297.491 144.731C308.408 142.56 318.435 137.2 326.306 129.329C334.177 121.459 339.537 111.431 341.708 100.514C343.88 89.5973 342.765 78.2817 338.506 67.9982C334.246 57.7147 327.033 48.9253 317.778 42.7414C308.523 36.5575 297.642 33.2569 286.511 33.2569V0Z"
              fill="#161A1D"
            />
            <path
              d="M483.489 179.07C465.78 179.07 448.47 173.819 433.746 163.98C419.022 154.142 407.546 140.159 400.769 123.798C393.992 107.438 392.219 89.4357 395.674 72.0676C399.129 54.6995 407.656 38.7459 420.178 26.2243C432.7 13.7026 448.653 5.17523 466.021 1.7205C483.389 -1.73421 501.392 0.0388551 517.752 6.81554C534.112 13.5922 548.096 25.0681 557.934 39.7921C567.772 54.516 573.023 71.8266 573.023 89.535L539.767 89.535C539.767 78.4042 536.466 67.5235 530.282 58.2686C524.098 49.0137 515.309 41.8004 505.025 37.5409C494.742 33.2813 483.426 32.1668 472.509 34.3383C461.592 36.5098 451.565 41.8698 443.694 49.7404C435.823 57.611 430.463 67.6388 428.292 78.5557C426.12 89.4725 427.235 100.788 431.494 111.072C435.754 121.355 442.967 130.145 452.222 136.328C461.477 142.512 472.358 145.813 483.489 145.813L483.489 179.07Z"
              fill="#161A1D"
            />
            <path
              d="M770 89.5349C770 107.243 764.749 124.554 754.911 139.278C745.072 154.002 731.089 165.478 714.729 172.254C698.368 179.031 680.366 180.804 662.998 177.349C645.63 173.895 629.676 165.367 617.154 152.846C604.633 140.324 596.105 124.37 592.651 107.002C589.196 89.6342 590.969 71.6317 597.746 55.2713C604.522 38.911 615.998 24.9276 630.722 15.0893C645.446 5.25112 662.757 -5.11009e-06 680.465 -3.91369e-06L680.465 33.2569C669.334 33.2569 658.454 36.5575 649.199 42.7414C639.944 48.9253 632.731 57.7147 628.471 67.9982C624.211 78.2817 623.097 89.5973 625.269 100.514C627.44 111.431 632.8 121.459 640.671 129.329C648.541 137.2 658.569 142.56 669.486 144.731C680.403 146.903 691.718 145.788 702.002 141.529C712.285 137.269 721.075 130.056 727.259 120.801C733.442 111.546 736.743 100.666 736.743 89.5349L770 89.5349Z"
              fill="#161A1D"
            />
            <path
              d="M71.6279 0L0 179.07H35.814L89.5349 44.7674L143.256 179.07H179.07L107.442 0H71.6279Z"
              fill="#A4161A"
            />
          </svg>
        </div>
      </div>

      <h1
        style={{
          fontFamily: FONT,
          fontSize: 22,
          fontWeight: 700,
          color: C.dark,
          textAlign: "center",
          margin: "0 0 8px",
          lineHeight: 1.25,
        }}
      >
        Добро пожаловать в AOCG AI Офис
      </h1>
      <p
        style={{
          fontFamily: FONT,
          fontSize: 14,
          color: theme.fg2,
          textAlign: "center",
          margin: "0 0 32px",
          lineHeight: 1.45,
        }}
      >
        Перед началом работы ознакомьтесь с документами
      </p>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 14,
          marginBottom: 32,
        }}
      >
        <ConsentCheckbox
          checked={policyChecked}
          onToggleCheck={() => setPolicyChecked((v) => !v)}
          onOpenSheet={() => setSheet("policy")}
          label={
            <>
              Я ознакомился и согласен с{" "}
              <span
                style={{ color: theme.cherry, textDecoration: "underline" }}
              >
                Политикой конфиденциальности
              </span>
            </>
          }
        />
        <ConsentCheckbox
          checked={dataChecked}
          onToggleCheck={() => setDataChecked((v) => !v)}
          onOpenSheet={() => setSheet("consent")}
          label={
            <>
              Я даю{" "}
              <span
                style={{ color: theme.cherry, textDecoration: "underline" }}
              >
                согласие на обработку моих персональных данных
              </span>{" "}
              в соответствии с 152-ФЗ
            </>
          }
        />
      </div>

      <div style={{ marginTop: "auto" }}>
        {/* S-34: отказ загрузки виден человеку, а не только в консоли —
            иначе кнопка выглядит сломанной без объяснения. */}
        {ошибкаТекста && (
          <div
            style={{
              fontFamily: FONT,
              fontSize: 13,
              lineHeight: 1.4,
              color: theme.errorFg,
              textAlign: "center",
              marginBottom: 12,
            }}
          >
            Не удалось загрузить текст согласия. Проверьте связь и обновите
            страницу — согласиться с непрочитанным текстом нельзя.
          </div>
        )}
        <button
          onClick={handleAccept}
          disabled={!canSubmit}
          style={{
            width: "100%",
            padding: "14px",
            border: "none",
            borderRadius: 12,
            background: canSubmit ? theme.cherry : theme.surfaceSunk,
            color: canSubmit ? theme.surface : theme.fg3,
            fontFamily: FONT,
            fontSize: 14,
            fontWeight: 600,
            letterSpacing: "0.03em",
            cursor: canSubmit ? "pointer" : "default",
            transition: "background 150ms",
          }}
        >
          {submitting ? "Сохраняем…" : "Продолжить"}
        </button>
      </div>

      {sheet === "policy" && (
        <ConsentBottomSheet
          title="Политика конфиденциальности"
          text={согласие ? согласие.policy : "Текст политики не загрузился."}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === "consent" && (
        <ConsentBottomSheet
          title="Согласие на обработку ПДн"
          text={согласие ? согласие.text : "Текст согласия не загрузился."}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  );
}

// ─── AUTH SCREENS ───────────────────────────────────────────
function AocgLogo({ width, height }) {
  const w = height ? (height * 770) / 180 : width || 140;
  const h = height || ((width || 140) * 180) / 770;
  return (
    <svg
      width={w}
      height={h}
      viewBox="0 0 770 180"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M286.511 0C304.22 2.1117e-07 321.53 5.25113 336.254 15.0893C350.978 24.9276 362.454 38.911 369.231 55.2714C376.008 71.6317 377.781 89.6342 374.326 107.002C370.871 124.37 362.344 140.324 349.822 152.846C337.3 165.367 321.347 173.895 303.979 177.349C286.611 180.804 268.608 179.031 252.248 172.254C235.888 165.478 221.904 154.002 212.066 139.278C202.228 124.554 196.977 107.243 196.977 89.5349H230.233C230.233 100.666 233.534 111.546 239.718 120.801C245.902 130.056 254.691 137.269 264.975 141.529C275.258 145.788 286.574 146.903 297.491 144.731C308.408 142.56 318.435 137.2 326.306 129.329C334.177 121.459 339.537 111.431 341.708 100.514C343.88 89.5973 342.765 78.2817 338.506 67.9982C334.246 57.7147 327.033 48.9253 317.778 42.7414C308.523 36.5575 297.642 33.2569 286.511 33.2569V0Z"
        fill="#161A1D"
      />
      <path
        d="M483.489 179.07C465.78 179.07 448.47 173.819 433.746 163.98C419.022 154.142 407.546 140.159 400.769 123.798C393.992 107.438 392.219 89.4357 395.674 72.0676C399.129 54.6995 407.656 38.7459 420.178 26.2243C432.7 13.7026 448.653 5.17523 466.021 1.7205C483.389 -1.73421 501.392 0.0388551 517.752 6.81554C534.112 13.5922 548.096 25.0681 557.934 39.7921C567.772 54.516 573.023 71.8266 573.023 89.535L539.767 89.535C539.767 78.4042 536.466 67.5235 530.282 58.2686C524.098 49.0137 515.309 41.8004 505.025 37.5409C494.742 33.2813 483.426 32.1668 472.509 34.3383C461.592 36.5098 451.565 41.8698 443.694 49.7404C435.823 57.611 430.463 67.6388 428.292 78.5557C426.12 89.4725 427.235 100.788 431.494 111.072C435.754 121.355 442.967 130.145 452.222 136.328C461.477 142.512 472.358 145.813 483.489 145.813L483.489 179.07Z"
        fill="#161A1D"
      />
      <path
        d="M770 89.5349C770 107.243 764.749 124.554 754.911 139.278C745.072 154.002 731.089 165.478 714.729 172.254C698.368 179.031 680.366 180.804 662.998 177.349C645.63 173.895 629.676 165.367 617.154 152.846C604.633 140.324 596.105 124.37 592.651 107.002C589.196 89.6342 590.969 71.6317 597.746 55.2713C604.522 38.911 615.998 24.9276 630.722 15.0893C645.446 5.25112 662.757 -5.11009e-06 680.465 -3.91369e-06L680.465 33.2569C669.334 33.2569 658.454 36.5575 649.199 42.7414C639.944 48.9253 632.731 57.7147 628.471 67.9982C624.211 78.2817 623.097 89.5973 625.269 100.514C627.44 111.431 632.8 121.459 640.671 129.329C648.541 137.2 658.569 142.56 669.486 144.731C680.403 146.903 691.718 145.788 702.002 141.529C712.285 137.269 721.075 130.056 727.259 120.801C733.442 111.546 736.743 100.666 736.743 89.5349L770 89.5349Z"
        fill="#161A1D"
      />
      <path
        d="M71.6279 0L0 179.07H35.814L89.5349 44.7674L143.256 179.07H179.07L107.442 0H71.6279Z"
        fill="#A4161A"
      />
    </svg>
  );
}

// In-app brand mark (source of truth 2026-06-07): white Λ on a cherry plate,
// rounded square radius 8. Used everywhere a mark appears inside the app
// (Тип 2 header). The full «ΛOCG» wordmark (AocgLogo) is login/splash only.
function MarkPlate({ size = 40, radius = 8 }) {
  const glyph = Math.round(size * 0.52);
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: theme.cherry,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <svg
        width={glyph}
        height={glyph}
        viewBox="0 0 179.07 179.07"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path
          d="M71.6279 0L0 179.07H35.814L89.5349 44.7674L143.256 179.07H179.07L107.442 0H71.6279Z"
          fill="#ffffff"
        />
      </svg>
    </div>
  );
}

// Тип 2 header — left-block app switcher. Switches PLATFORM APPLICATIONS
// (Документы / Финансы / Инструменты), never «модули». «Финансы» is the
// current product (Чеки live inside it); the others are placeholders.
function AppSwitcher({ onClose, onPick }) {
  const apps = [
    {
      id: "documents",
      label: "Документы",
      sub: "Прима · документооборот",
      soon: true,
    },
    { id: "finance", label: "Финансы", sub: "Чеки, ДДС, ОПУ", active: true },
    {
      id: "tools",
      label: "Инструменты",
      sub: "Сервисы и интеграции",
      soon: true,
    },
  ];
  return (
    <>
      <div
        onClick={onClose}
        // 50/51, а не 40/41: на 40 живут плавающие кнопки, и меню
        // приложений сталкивалось с кнопкой «Новый отчёт» — кто выше,
        // решал порядок в DOM. Теперь порядок задан правилом.
        style={{ position: "fixed", inset: 0, zIndex: 50 }}
      />
      <div
        role="menu"
        style={{
          position: "absolute",
          top: "calc(100% + 2px)",
          left: 8,
          zIndex: 51,
          width: 256,
          background: theme.surface,
          border: `1px solid ${theme.border}`,
          borderRadius: 12,
          boxShadow: "0 8px 30px rgba(17,19,24,0.16)",
          padding: 6,
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            padding: "8px 10px 6px",
            fontFamily: FONT,
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: theme.fg2,
          }}
        >
          Приложения
        </div>
        {apps.map((a) => (
          <button
            key={a.id}
            disabled={a.soon}
            onClick={() => {
              if (a.active) {
                onPick && onPick(a.id);
              }
              onClose();
            }}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "9px 10px",
              border: "none",
              borderRadius: 8,
              cursor: a.soon ? "default" : "pointer",
              background: a.active ? "#FDF2F2" : "transparent",
              textAlign: "left",
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontFamily: FONT,
                  fontSize: 14,
                  fontWeight: a.active ? 600 : 500,
                  color: a.soon ? theme.fg3 : "#111318",
                }}
              >
                {a.label}
                {a.soon && (
                  <span
                    style={{ fontWeight: 400, fontSize: 12, color: theme.fg3 }}
                  >
                    {" "}
                    · Скоро
                  </span>
                )}
              </div>
              <div
                style={{
                  fontFamily: FONT,
                  fontSize: 12,
                  color: theme.fg2,
                  marginTop: 1,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {a.sub}
              </div>
            </div>
            {a.active && (
              <Check size={16} color={theme.cherry} strokeWidth={2.5} />
            )}
          </button>
        ))}
      </div>
    </>
  );
}

function AuthShell({ children }) {
  return (
    <div
      style={{
        minHeight: "100dvh",
        background: theme.surface,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        padding: "32px 24px",
        boxSizing: "border-box",
        fontFamily: FONT,
      }}
    >
      {children}
    </div>
  );
}

const A_INPUT = {
  width: "100%",
  padding: "13px 14px",
  border: `1px solid ${theme.border}`,
  borderRadius: 10,
  fontSize: 16 /* T138 */,
  fontFamily: FONT,
  color: C.dark,
  background: theme.surface,
  boxSizing: "border-box",
  outline: "none",
};

function LoginScreen({ onAuthed, navigate }) {
  const [ident, setIdent] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  // S-83: показывать ли кнопку «Выслать письмо ещё раз». Отдельный признак,
  // а не разбор текста ошибки: текст правят когда угодно, и сверка строк
  // развалилась бы молча — та же причина, по которой ниже ветвимся по `code`.
  const [нужноПисьмо, setНужноПисьмо] = useState(false);
  const [письмоОтправлено, setПисьмоОтправлено] = useState(false);
  async function отправитьПисьмоЗаново() {
    // Адрес берём из поля входа: другого у нас нет, а спрашивать второй раз
    // то, что человек только что ввёл, — лишний шаг ровно там, где он уже
    // раздражён. Если введён телефон, бэк ответит тем же общим сообщением.
    if (busy || !ident.trim()) return;
    setBusy(true);
    try {
      await fetch(API + "/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: ident.trim() }),
      });
      // ⚠️ ОТВЕТ НЕ РАЗБИРАЕМ И НЕ ПОКАЗЫВАЕМ РАЗНОГО. Бэк намеренно отвечает
      // одинаково на известный и неизвестный адрес — иначе экран входа стал бы
      // способом узнать, кто у нас зарегистрирован. Показываем то же самое.
      setПисьмоОтправлено(true);
      setErr("");
    } catch {
      setErr("Не удалось отправить письмо. Проверьте интернет");
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!ident.trim() || !password || busy) return;
    setНужноПисьмо(false);
    setПисьмоОтправлено(false);
    setBusy(true);
    setErr("");
    try {
      const res = await fetchWithTimeout(
        API + "/api/auth/login",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone_or_email: ident.trim(), password }),
        },
        15000,
      );
      const d = await res.json().catch(() => ({}));
      if (res.ok && d.access_token) {
        onAuthed(d);
        return;
      } // success flow unchanged
      if (res.status === 429) {
        // Бэк различает 429 по detail: русское «…через N мин» — реальная
        // блокировка аккаунта (locked_until, N считается вниз от 15).
        // «IP temporarily banned»/«Rate limit exceeded» — лимит по IP
        // (бан до 5 мин), это НЕ блокировка аккаунта. См. S-27.
        // ⚠️ ЧЕРЕЗ `текстОшибки`: при массиве `.match` ниже упал бы
        // с TypeError — то есть экран входа повторил бы белый экран.
        const detail = текстОшибки(d, "");
        const lock = detail.match(/(\d+)\s*мин/);
        if (lock)
          setErr(`Аккаунт заблокирован на ${lock[1]} мин. Попробуйте позже`);
        else
          setErr(
            "Слишком много попыток входа. Подождите до 5 минут и попробуйте снова",
          );
      } else if (d.code === "account_disabled") {
        // ⚠️ 403 НА ВХОДЕ БОЛЬШЕ НЕ ОЗНАЧАЕТ ОДНО, И ЭТА ВЕТКА ПОЯВИЛАСЬ
        // ИМЕННО ПОЭТОМУ. 31.08.2026 бэкенд научился отвергать погашенного
        // сотрудника (T115) — тоже 403, но с кодом account_disabled.
        // ⚠️ ДО ЭТОЙ ПРАВКИ отключённый сотрудник увидел бы «Почта
        // не подтверждена» и кнопку «Выслать письмо ещё раз», которая ему
        // не поможет НИКОГДА. Это хуже пустого экрана: пустой экран молчит,
        // а этот отправлял человека чинить не то. Комментарий ниже
        // утверждал «403 означает ровно одно» — правка бэкенда сделала
        // это утверждение ложным, и ветку пришлось заводить здесь же.
        setErr(
          текстОшибки(
            d,
            "Учётная запись отключена. Обратитесь к администратору организации",
          ),
        );
      } else if (res.status === 403 || d.code === "email_not_verified") {
        // ⚠️ 403 НА ВХОДЕ БЕЗ ИЗВЕСТНОГО КОДА — почта не подтверждена.
        // auth.py: после сброса счётчика попыток `if not
        // u.get("is_email_verified")` → 403 с телом
        // {"detail": "Подтвердите email", "code": "email_not_verified"}.
        //
        // ПОЛЕ `code` — РАБОЧЕЕ, И ЭТО ГЛАВНЫЙ ПРИЗНАК. Бэкенд отдаёт его
        // с 27.08.2026 (`8449999`, задеплоено). Ветвиться по нему, а не по
        // тексту: формулировку «Подтвердите email» правят когда угодно,
        // и сверка строк развалится молча. Статус 403 оставлен вторым
        // признаком — не подстраховка от текста, а страховка на случай,
        // если тело не разобралось (`res.json()` падает → d = {}).
        //
        // ⚠️ ЗДЕСЬ БЫЛО НАПИСАНО, ЧТО `code` НЕ СУЩЕСТВУЕТ. Так и было
        // в момент правки фронта: сессии по бэкенду и по интерфейсу шли
        // параллельно, поле появилось между чтением и коммитом.
        // Комментарий, описывающий чужой репозиторий, устаревает молча —
        // отсюда дата и номер коммита в тексте выше, чтобы следующий
        // читатель мог проверить, а не поверить.
        //
        // ⚠️ ЗДЕСЬ ДОЛГО НЕ БЫЛО КНОПКИ «Выслать письмо ещё раз», и это
        // было верно: ручки переотправки в бэкенде не существовало, а кнопка,
        // дёргающая несуществующий адрес, — кнопка, которая врёт (за то же
        // самое откатывали «скоро будет доступно», S-56).
        // POST /auth/resend-verification появился 28.08.2026 (S-83) — кнопка
        // ниже, признак `нужноПисьмо`.
        setНужноПисьмо(true);
        setПисьмоОтправлено(false);
        setErr(
          "Почта не подтверждена. Проверьте письмо со ссылкой подтверждения",
        );
      } else setErr("Неверный телефон/email или пароль");
    } catch {
      setErr("Не удалось войти. Проверьте интернет");
    } finally {
      setBusy(false);
    }
  }
  // ⚠️ БЫЛО `alert("OAuth скоро будет доступен")`. Системное окно вместо
  // нашего интерфейса, да ещё и с обещанием без срока (Р-ОТКАЗЫ, T116).
  const [oauthПодсказка, setOauthПодсказка] = useState(false);
  const oauthSoon = () => setOauthПодсказка(true);
  const fieldStyle = {
    width: "100%",
    height: 48,
    border: "1px solid #EEF0F4",
    borderRadius: 12,
    padding: "14px 16px",
    fontSize: 16 /* T138 */,
    fontFamily: FONT,
    color: "#111318",
    background: "#fff",
    boxSizing: "border-box",
    outline: "none",
  };
  // Stylized colored circles (20px) with provider letter — no official SVGs in project.
  const OAUTH = [
    ["yandex", "Я", "Войти через Яндекс ID", "#FC3F1D", "#fff"],
    ["google", "G", "Войти через Google", "#fff", "#4285F4"],
    ["mailru", "@", "Войти через Mail.ru", "#005FF9", "#fff"],
  ];
  return (
    <div
      style={{
        minHeight: "100dvh",
        background: "#F6F7F9",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        paddingBottom: "calc(24px + env(safe-area-inset-bottom))",
        boxSizing: "border-box",
        fontFamily: FONT,
      }}
    >
      <div style={{ width: "100%", maxWidth: 400 }}>
        {/* Header — logo 32px + «AI Офис», без слогана */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            marginBottom: 32,
          }}
        >
          <AocgLogo height={32} />
          <span
            style={{
              fontFamily: FONT,
              fontSize: 18,
              fontWeight: 600,
              color: "#111318",
            }}
          >
            AI Офис
          </span>
        </div>

        {/* Card */}
        <div
          style={{
            background: "#FFFFFF",
            borderRadius: 16,
            padding: 32,
            boxShadow: "0 1px 3px rgba(17,19,24,0.04)",
          }}
        >
          {/* OAuth — приоритетный путь */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              marginBottom: 24,
            }}
          >
            {OAUTH.map(([key, icon, label, bg, fg]) => (
              <button
                key={key}
                className="aocg-oauth-btn"
                onClick={oauthSoon}
                type="button"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  height: 48,
                  width: "100%",
                  background: "#fff",
                  border: "1px solid #EEF0F4",
                  borderRadius: 12,
                  padding: "0 16px",
                  cursor: "pointer",
                  transition: "background 120ms ease,border-color 120ms ease",
                }}
              >
                <span
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: "50%",
                    background: bg,
                    color: fg,
                    border: bg === "#fff" ? "1px solid #EEF0F4" : "none",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontFamily: FONT,
                    fontSize: 12,
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  {icon}
                </span>
                <span
                  style={{
                    fontFamily: FONT,
                    fontSize: 15,
                    fontWeight: 500,
                    color: "#111318",
                  }}
                >
                  {label}
                </span>
              </button>
            ))}
            {/* ⚠️ ПОДПИСЬ НА МЕСТЕ ВМЕСТО СИСТЕМНОГО ОКНА (Р-ОТКАЗЫ, T116).
                Было `alert("OAuth скоро будет доступен")`: чужой интерфейс
                и обещание без срока. Здесь сказано, что работает СЕЙЧАС —
                человеку нужен вход, а не наши планы. */}
            {oauthПодсказка && (
              <div
                style={{
                  padding: "10px 12px",
                  borderRadius: 8,
                  background: "#FFFBEB",
                  border: "1px solid #FDE68A",
                  font: `400 12px/1.45 ${FONT}`,
                  color: "#B45309",
                }}
              >
                Вход через сервисы пока не подключён. Войдите по почте и паролю
                — форма ниже.
              </div>
            )}
          </div>

          {/* Divider */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              marginBottom: 24,
            }}
          >
            <div style={{ flex: 1, height: 1, background: "#EEF0F4" }} />
            <span style={{ fontFamily: FONT, fontSize: 13, color: "#636B7D" }}>
              или
            </span>
            <div style={{ flex: 1, height: 1, background: "#EEF0F4" }} />
          </div>

          {/* Email / Password */}
          <input
            className="aocg-login-input"
            value={ident}
            onChange={(e) => setIdent(e.target.value)}
            placeholder="Телефон или Email"
            aria-label="Телефон или Email"
            autoCapitalize="none"
            autoCorrect="off"
            style={{ ...fieldStyle, marginBottom: 12 }}
          />
          <div style={{ position: "relative" }}>
            <input
              className="aocg-login-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type={showPw ? "text" : "password"}
              placeholder="Пароль"
              aria-label="Пароль"
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              style={{ ...fieldStyle, paddingRight: 44 }}
            />
            <button
              onClick={() => setShowPw((s) => !s)}
              type="button"
              aria-label={showPw ? "Скрыть пароль" : "Показать пароль"}
              style={{
                position: "absolute",
                right: 10,
                top: "50%",
                transform: "translateY(-50%)",
                border: "none",
                background: "none",
                cursor: "pointer",
                color: "#636B7D",
                display: "flex",
                padding: 4,
              }}
            >
              {showPw ? (
                <EyeOff size={18} aria-hidden="true" />
              ) : (
                <Eye size={18} aria-hidden="true" />
              )}
            </button>
          </div>

          {/* Забыли пароль? */}
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              marginTop: 12,
              marginBottom: 20,
            }}
          >
            <button
              onClick={() => navigate("/forgot-password")}
              type="button"
              className="aocg-cherry-link"
              style={{
                background: "none",
                border: "none",
                padding: 0,
                fontFamily: FONT,
                fontSize: 14,
                fontWeight: 500,
                color: "#A4161A",
                cursor: "pointer",
              }}
            >
              Забыли пароль?
            </button>
          </div>

          {/* S-83: выход из тупика «письмо не дошло» */}
          {нужноПисьмо && (
            <div style={{ marginBottom: 16 }}>
              {письмоОтправлено ? (
                <div
                  style={{
                    background: "#F0FDF4",
                    color: "#15803D",
                    padding: 12,
                    borderRadius: 8,
                    fontFamily: FONT,
                    fontSize: 13,
                  }}
                >
                  Если адрес есть и ещё не подтверждён, письмо отправлено.
                  Ссылка действует 72 часа.
                </div>
              ) : (
                <button
                  type="button"
                  onClick={отправитьПисьмоЗаново}
                  disabled={busy}
                  style={{
                    width: "100%",
                    padding: 12,
                    // Сторож вёрстки поймал: width:100% + padding при
                    // content-box делает элемент шире родителя всегда.
                    boxSizing: "border-box",
                    borderRadius: 8,
                    border: "1px solid #A4161A",
                    background: "transparent",
                    color: "#A4161A",
                    fontFamily: FONT,
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: busy ? "default" : "pointer",
                    opacity: busy ? 0.6 : 1,
                  }}
                >
                  Выслать письмо ещё раз
                </button>
              )}
            </div>
          )}

          {/* Ошибка */}
          {err && (
            <div
              style={{
                background: "#FEF2F2",
                color: "#B91C1C",
                padding: 12,
                borderRadius: 8,
                fontFamily: FONT,
                fontSize: 13,
                marginBottom: 16,
              }}
            >
              {err}
            </div>
          )}

          {/* Войти */}
          <button
            onClick={submit}
            disabled={busy}
            className="aocg-login-submit"
            style={{
              width: "100%",
              height: 48,
              background: "#A4161A",
              color: "#fff",
              border: "none",
              borderRadius: 12,
              fontFamily: FONT,
              fontSize: 15,
              fontWeight: 600,
              cursor: busy ? "not-allowed" : "pointer",
              opacity: busy ? 0.5 : 1,
              transition: "opacity 100ms ease,background 120ms ease",
            }}
          >
            {busy ? "Вход…" : "Войти"}
          </button>
        </div>

        {/* Регистрация */}
        <div
          style={{
            textAlign: "center",
            marginTop: 24,
            fontFamily: FONT,
            fontSize: 14,
          }}
        >
          <span style={{ color: "#636B7D" }}>Нет аккаунта? </span>
          <button
            onClick={() => navigate("/register")}
            type="button"
            className="aocg-cherry-link"
            style={{
              background: "none",
              border: "none",
              padding: 0,
              fontFamily: FONT,
              fontSize: 14,
              fontWeight: 500,
              color: "#A4161A",
              cursor: "pointer",
            }}
          >
            Зарегистрироваться
          </button>
        </div>
      </div>
    </div>
  );
}

function VerifyEmailScreen({ onAuthed, navigate }) {
  const token = new URLSearchParams(window.location.search).get("token");
  const [state, setState] = useState(token ? "loading" : "error"); // loading | error
  useEffect(() => {
    if (!token) return;
    fetchWithTimeout(
      API + "/api/auth/verify-email?token=" + encodeURIComponent(token),
      {},
      15000,
    )
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (r.ok && d.access_token) onAuthed(d);
        else setState("error");
      })
      .catch(() => setState("error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <AuthShell>
      <div style={{ textAlign: "center", maxWidth: 340 }}>
        <AocgLogo width={120} />
        <div
          style={{
            marginTop: 22,
            fontSize: 15,
            color: C.dark,
            fontFamily: FONT,
          }}
        >
          {state === "loading"
            ? "Подтверждаем email…"
            : "Ссылка недействительна или истекла"}
        </div>
        {state === "error" && (
          <button
            onClick={() => navigate("/login")}
            type="button"
            style={{
              marginTop: 16,
              background: "none",
              border: "none",
              color: theme.cherry,
              fontSize: 14,
              cursor: "pointer",
              fontFamily: FONT,
            }}
          >
            ← Ко входу
          </button>
        )}
      </div>
    </AuthShell>
  );
}

function CheckEmailScreen({ email, navigate }) {
  return (
    <AuthShell>
      <div
        style={{
          maxWidth: 340,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
        }}
      >
        <Mail size={48} color={theme.cherry} strokeWidth={1.5} />
        <h1
          style={{
            fontSize: 20,
            fontWeight: 700,
            color: C.dark,
            fontFamily: FONT,
            margin: "16px 0 8px",
          }}
        >
          Проверьте почту
        </h1>
        <div
          style={{
            fontSize: 14,
            color: "#636B7D",
            fontFamily: FONT,
            lineHeight: 1.5,
          }}
        >
          Мы отправили письмо на <b style={{ color: C.dark }}>{email}</b>.
          Откройте ссылку в письме, чтобы подтвердить аккаунт.
        </div>
        {/* ⚠️ КНОПКА «ОТКРЫТЬ ПОЧТУ» СНЯТА (находка владельца 04.09.2026).
            Она делала `window.location.href = "mailto:"`, а `mailto:` — это
            НЕ «открыть ящик», это «написать письмо»: на iPhone человек,
            нажавший «Открыть почту», попадал в ЧЕРНОВИК НОВОГО ПИСЬМА.
            Кнопка обещала одно, делала другое — тот же класс, что мёртвая
            кнопка, только хуже: она работала, но не туда.

            ПОЧЕМУ СНЯТА, А НЕ ПОЧИНЕНА. Способа открыть ЯЩИК из браузера
            не существует: `mailto:` умеет только составление письма.
            Обходной путь — угадывать веб-почту по домену адреса
            (`gmail.com` → mail.google.com и так далее) — работает для
            нескольких известных доменов и ломается на всех прочих, включая
            корпоративные; кнопка, работающая у половины, хуже отсутствующей.
            Человек знает, где его почта, лучше нас. */}
        <button
          onClick={() => navigate("/login")}
          type="button"
          style={{
            marginTop: 16,
            background: "none",
            border: "none",
            color: theme.cherry,
            fontSize: 14,
            cursor: "pointer",
            fontFamily: FONT,
          }}
        >
          ← Ко входу
        </button>
      </div>
    </AuthShell>
  );
}

// ─── Восстановление пароля (S-56): ДВА экрана, у них разные входы ───
// ForgotPasswordScreen открывают из приложения, ResetPasswordScreen — из письма.
// Слить их в один с двумя состояниями значило бы связать пути, которые
// никогда не встречаются.

function ForgotPasswordScreen({ navigate }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [ответ, setОтвет] = useState(null);

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const r = await fetchWithTimeout(
        API + "/api/auth/forgot-password",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email.trim() }),
        },
        15000,
      );
      const d = await r.json().catch(() => ({}));
      // ⚠️ ДОСЛОВНО ТО, ЧТО ОТВЕТИЛ СЕРВЕР, И НИ СЛОВОМ БОЛЬШЕ.
      // Ручка отвечает ОДИНАКОВО на существующий и несуществующий адрес —
      // это защита от перебора адресов, а не сухость формулировки. Написать
      // здесь «письмо отправлено на ваш адрес» значит вернуть утечку через
      // интерфейс: бэкенд промолчал, а фронт договорил за него.
      setОтвет(d.message || "Запрос принят");
    } catch {
      setОтвет("Не удалось отправить запрос. Проверьте интернет");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell>
      <div style={{ width: "100%", maxWidth: 340 }}>
        <AocgLogo width={120} />
        <div
          style={{
            marginTop: 22,
            fontSize: 15,
            color: C.dark,
            fontFamily: FONT,
          }}
        >
          Восстановление пароля
        </div>
        {ответ ? (
          <div
            style={{
              marginTop: 18,
              fontSize: 14,
              color: C.dark,
              fontFamily: FONT,
              lineHeight: 1.5,
            }}
          >
            {ответ}
          </div>
        ) : (
          <form onSubmit={submit}>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Ваш email"
              aria-label="Email для восстановления пароля"
              required
              style={{
                width: "100%",
                height: 48,
                border: "1px solid #EEF0F4",
                borderRadius: 12,
                padding: "14px 16px",
                fontSize: 16 /* T138 */,
                fontFamily: FONT,
                color: "#111318",
                background: "#fff",
                boxSizing: "border-box",
                marginTop: 18,
              }}
            />
            <button
              type="submit"
              disabled={busy}
              style={{
                width: "100%",
                height: 48,
                marginTop: 14,
                border: "none",
                borderRadius: 12,
                background: theme.cherry,
                color: "#fff",
                fontSize: 15,
                fontFamily: FONT,
                cursor: busy ? "default" : "pointer",
                opacity: busy ? 0.6 : 1,
              }}
            >
              {busy ? "Отправляем…" : "Прислать ссылку"}
            </button>
          </form>
        )}
        <button
          onClick={() => navigate("/login")}
          type="button"
          style={{
            marginTop: 16,
            background: "none",
            border: "none",
            color: theme.cherry,
            fontSize: 14,
            cursor: "pointer",
            fontFamily: FONT,
          }}
        >
          ← Ко входу
        </button>
      </div>
    </AuthShell>
  );
}

function ResetPasswordScreen({ navigate }) {
  const token = new URLSearchParams(window.location.search).get("token");
  const [пароль, setПароль] = useState("");
  const [повтор, setПовтор] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(token ? "" : "Ссылка недействительна");
  // ⚠️ ДВА РАЗНЫХ 400 ОТ ОДНОЙ РУЧКИ, И ОНИ ТРЕБУЮТ РАЗНОГО ОТ ЧЕЛОВЕКА:
  // «Ссылка недействительна» — исправить здесь нечего, нужна новая ссылка;
  // «не менее 8 символов» — поправимо тут же, форму убирать нельзя.
  // Свалить оба в «что-то пошло не так» значит отправить человека за новым
  // письмом из-за опечатки в пароле.
  const [ссылкаМертва, setСсылкаМертва] = useState(!token);
  // ⚠️ УСПЕХ БЫЛ НЕВИДИМ. Отправка (busy) и отказ (err) различались и до
  // сегодня, а вот удача делала navigate("/login") молча: человек оказывался
  // на форме входа без единого слова о том, что пароль сменился — то есть
  // там же, куда его уводил и мёртвый токен. Третье состояние — не украшение,
  // а единственное подтверждение, что смена вообще состоялась.
  const [готово, setГотово] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    if (пароль !== повтор) {
      setErr("Пароли не совпадают");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const r = await fetchWithTimeout(
        API + "/api/auth/reset-password",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, new_password: пароль }),
        },
        15000,
      );
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        // Токенов ручка не возвращает намеренно: сброс гасит все сессии,
        // выдавать новую тут же — обесценивать собственную защиту. Поэтому
        // на вход человек уходит САМ, кнопкой, уже увидев подтверждение.
        setГотово(true);
        return;
      }
      const текст = текстОшибки(d, "Не удалось сменить пароль");
      setErr(текст);
      setСсылкаМертва(текст.includes("Ссылка"));
    } catch {
      setErr("Не удалось сменить пароль. Проверьте интернет");
    } finally {
      setBusy(false);
    }
  }

  const поле = {
    width: "100%",
    height: 48,
    border: "1px solid #EEF0F4",
    borderRadius: 12,
    padding: "14px 16px",
    fontSize: 16 /* T138 */,
    fontFamily: FONT,
    color: "#111318",
    background: "#fff",
    boxSizing: "border-box",
    marginTop: 12,
  };

  return (
    <AuthShell>
      <div style={{ width: "100%", maxWidth: 340 }}>
        <AocgLogo width={120} />
        <div
          style={{
            marginTop: 22,
            fontSize: 15,
            color: C.dark,
            fontFamily: FONT,
          }}
        >
          Новый пароль
        </div>
        {!ссылкаМертва && !готово && (
          <form onSubmit={submit}>
            <input
              type="password"
              value={пароль}
              onChange={(e) => setПароль(e.target.value)}
              placeholder="Новый пароль"
              aria-label="Новый пароль"
              required
              style={поле}
            />
            <input
              type="password"
              value={повтор}
              onChange={(e) => setПовтор(e.target.value)}
              placeholder="Повторите пароль"
              aria-label="Повторите новый пароль"
              required
              style={поле}
            />
            <button
              type="submit"
              disabled={busy}
              style={{
                width: "100%",
                height: 48,
                marginTop: 14,
                border: "none",
                borderRadius: 12,
                background: theme.cherry,
                color: "#fff",
                fontSize: 15,
                fontFamily: FONT,
                cursor: busy ? "default" : "pointer",
                opacity: busy ? 0.6 : 1,
              }}
            >
              {busy ? "Меняем…" : "Сменить пароль"}
            </button>
          </form>
        )}
        {готово && (
          <div
            role="status"
            style={{
              marginTop: 14,
              background: theme.successBg,
              border: `1px solid ${theme.successBd}`,
              color: theme.successFg,
              padding: 12,
              borderRadius: 8,
              fontSize: 14,
              fontFamily: FONT,
              lineHeight: 1.5,
            }}
          >
            Пароль изменён, войдите с новым паролем
          </div>
        )}
        {err && (
          // ⚠️ ОТКАЗ КРАСИТСЯ ТОКЕНАМИ ОШИБКИ, А НЕ ВИШНЁВЫМ. Вишнёвый
          // #A4161A по дизайн-системе — цвет CTA. Покрашенный им текст отказа
          // стоял вплотную к вишнёвой кнопке «Сменить пароль» и читался как
          // ещё одно действие, а не как сообщение о неудаче. Токены
          // errorBg/errorFg/errorBd уже есть в ДС и уже так работают
          // на экране входа — новых цветов не заведено.
          <div
            role="alert"
            style={{
              marginTop: 14,
              background: theme.errorBg,
              border: `1px solid ${theme.errorBd}`,
              color: theme.errorFg,
              padding: 12,
              borderRadius: 8,
              fontSize: 14,
              fontFamily: FONT,
              lineHeight: 1.5,
            }}
          >
            {err}
          </div>
        )}
        {готово ? (
          <button
            onClick={() => navigate("/login")}
            type="button"
            style={{
              width: "100%",
              height: 48,
              marginTop: 16,
              border: "none",
              borderRadius: 12,
              background: theme.cherry,
              color: "#fff",
              fontSize: 15,
              fontFamily: FONT,
              cursor: "pointer",
            }}
          >
            Войти
          </button>
        ) : (
          <button
            onClick={() =>
              navigate(ссылкаМертва ? "/forgot-password" : "/login")
            }
            type="button"
            style={{
              marginTop: 16,
              background: "none",
              border: "none",
              color: theme.cherry,
              fontSize: 14,
              cursor: "pointer",
              fontFamily: FONT,
            }}
          >
            {ссылкаМертва ? "Запросить новую ссылку" : "← Ко входу"}
          </button>
        )}
      </div>
    </AuthShell>
  );
}

function RegisterScreen({ onAuthed, navigate }) {
  const [step, setStep] = useState(1); // 1: choose type, 2: form
  const [orgType, setOrgType] = useState(null); // 'person' | 'company'
  const [f, setF] = useState({
    inn: "",
    org_name: "",
    phone: "",
    email: "",
    password: "",
    password2: "",
    first_name: "",
    last_name: "",
  });
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  async function onInn(v) {
    set("inn", v);
    const digits = v.replace(/\D/g, "");
    if (digits.length === 10 || digits.length === 12) {
      try {
        const r = await fetchWithTimeout(
          API + "/api/egrul/" + digits,
          {},
          9000,
        );
        const d = await r.json().catch(() => null);
        if (d && d.name) set("org_name", d.name);
      } catch {
        /* manual entry */
      }
    }
  }

  async function submit() {
    setErr("");
    if (!f.email.trim() || !f.password) {
      setErr("Заполните email и пароль");
      return;
    }
    if (f.password.length < 8) {
      setErr("Пароль не менее 8 символов");
      return;
    }
    if (f.password !== f.password2) {
      setErr("Пароли не совпадают");
      return;
    }
    if (!f.first_name.trim()) {
      setErr("Укажите имя");
      return;
    }
    setBusy(true);
    try {
      const body = {
        phone: f.phone.trim() || null,
        email: f.email.trim(),
        password: f.password,
        first_name: f.first_name.trim(),
        last_name: f.last_name.trim(),
        org_type: orgType,
        org_name: orgType === "company" ? f.org_name.trim() : null,
        inn: orgType === "company" ? f.inn.replace(/\D/g, "") || null : null,
      };
      const res = await fetchWithTimeout(
        API + "/api/auth/register",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        15000,
      );
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        if (d.access_token) {
          onAuthed(d);
          return;
        } // auto-verified (no email provider)
        setSent(true);
        return; // verification email sent
      }
      setErr(текстОшибки(d, "Не удалось зарегистрироваться"));
    } catch {
      setErr("Нет связи с сервером");
    } finally {
      setBusy(false);
    }
  }

  if (sent) return <CheckEmailScreen email={f.email} navigate={navigate} />;

  const typeBtn = (label, desc, t) => (
    <button
      onClick={() => {
        setOrgType(t);
        setStep(2);
        setErr("");
      }}
      type="button"
      style={{
        width: "100%",
        textAlign: "left",
        padding: "14px 16px",
        border: `1px solid ${orgType === t ? theme.cherry : theme.border}`,
        borderRadius: 12,
        background: theme.surface,
        cursor: "pointer",
        marginBottom: 10,
      }}
    >
      <div
        style={{
          fontSize: 15,
          fontWeight: 600,
          color: C.dark,
          fontFamily: FONT,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 12,
          color: "#636B7D",
          fontFamily: FONT,
          marginTop: 2,
        }}
      >
        {desc}
      </div>
    </button>
  );

  return (
    <AuthShell>
      <div
        style={{
          width: "100%",
          maxWidth: 380,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <AocgLogo width={120} />
        {step === 1 ? (
          <div style={{ width: "100%", marginTop: 22 }}>
            <div
              style={{
                fontSize: 16,
                fontWeight: 600,
                color: C.dark,
                fontFamily: FONT,
                textAlign: "center",
                marginBottom: 18,
              }}
            >
              Как будете использовать AI Офис?
            </div>
            {typeBtn("Для себя", "ИП или физлицо", "person")}
            {typeBtn("Для компании", "ООО, АО — с ИНН", "company")}
            <button
              onClick={() => navigate("/login")}
              type="button"
              style={{
                marginTop: 8,
                width: "100%",
                background: "none",
                border: "none",
                color: theme.cherry,
                fontFamily: FONT,
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              Уже есть аккаунт? Войти
            </button>
          </div>
        ) : (
          <div
            style={{
              width: "100%",
              marginTop: 18,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <button
              onClick={() => setStep(1)}
              type="button"
              style={{
                alignSelf: "flex-start",
                background: "none",
                border: "none",
                color: "#636B7D",
                fontFamily: FONT,
                fontSize: 13,
                cursor: "pointer",
                padding: 0,
                marginBottom: 2,
              }}
            >
              ← Назад
            </button>
            {orgType === "company" && (
              <>
                <input
                  value={f.inn}
                  onChange={(e) => onInn(e.target.value)}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder="ИНН компании"
                  aria-label="ИНН компании"
                  style={A_INPUT}
                />
                <input
                  value={f.org_name}
                  onChange={(e) => set("org_name", e.target.value)}
                  placeholder="Название компании"
                  aria-label="Название компании"
                  style={A_INPUT}
                />
              </>
            )}
            <input
              value={f.first_name}
              onChange={(e) => set("first_name", e.target.value)}
              placeholder="Имя"
              aria-label="Имя"
              style={A_INPUT}
            />
            <input
              value={f.last_name}
              onChange={(e) => set("last_name", e.target.value)}
              placeholder="Фамилия"
              aria-label="Фамилия"
              style={A_INPUT}
            />
            <input
              value={f.phone}
              onChange={(e) => set("phone", e.target.value)}
              inputMode="tel"
              placeholder="Телефон"
              aria-label="Телефон"
              style={A_INPUT}
            />
            <input
              value={f.email}
              onChange={(e) => set("email", e.target.value)}
              autoCapitalize="none"
              autoCorrect="off"
              placeholder="Email"
              aria-label="Email"
              style={A_INPUT}
            />
            <div style={{ position: "relative" }}>
              <input
                value={f.password}
                onChange={(e) => set("password", e.target.value)}
                type={showPw ? "text" : "password"}
                placeholder="Пароль (от 8 символов)"
                aria-label="Пароль"
                style={{ ...A_INPUT, paddingRight: 44 }}
              />
              <button
                onClick={() => setShowPw((s) => !s)}
                type="button"
                aria-label={showPw ? "Скрыть пароль" : "Показать пароль"}
                style={{
                  position: "absolute",
                  right: 8,
                  top: "50%",
                  transform: "translateY(-50%)",
                  border: "none",
                  background: "none",
                  cursor: "pointer",
                  color: "#636B7D",
                  display: "flex",
                  padding: 6,
                }}
              >
                {showPw ? (
                  <EyeOff size={18} aria-hidden="true" />
                ) : (
                  <Eye size={18} aria-hidden="true" />
                )}
              </button>
            </div>
            <input
              value={f.password2}
              onChange={(e) => set("password2", e.target.value)}
              type={showPw ? "text" : "password"}
              placeholder="Повторите пароль"
              aria-label="Повторите пароль"
              style={A_INPUT}
            />
            {err && (
              <div
                style={{ color: theme.cherry, fontSize: 13, fontFamily: FONT }}
              >
                {err}
              </div>
            )}
            <button
              onClick={submit}
              disabled={busy}
              style={{
                marginTop: 4,
                padding: "13px",
                background: theme.cherry,
                color: "#fff",
                border: "none",
                borderRadius: 10,
                fontFamily: FONT,
                fontSize: 15,
                fontWeight: 600,
                cursor: busy ? "default" : "pointer",
                opacity: busy ? 0.7 : 1,
              }}
            >
              {busy ? "Создаём…" : "Зарегистрироваться"}
            </button>
          </div>
        )}
      </div>
    </AuthShell>
  );
}

function JoinScreen({ token, onAuthed, navigate }) {
  const [info, setInfo] = useState(null); // {is_valid, role, org_name, is_personal, email}
  const [loading, setLoading] = useState(true);
  // ⚠️ «СЕРВЕР НЕ ОТВЕТИЛ» И «ССЫЛКА НЕДЕЙСТВИТЕЛЬНА» — РАЗНЫЕ ВЕЩИ, и до
  // 06.09.2026 экран говорил про обе одно: `catch` клал `info = null`, и
  // человек читал «ссылка недействительна или истекла». Он шёл писать
  // администратору про сломанное приглашение, хотя чинить было нечего —
  // связь пропала на десять секунд. Отказ загрузки чинится обновлением,
  // мёртвая ссылка — новой ссылкой; это разные действия человека.
  const [сбой, setСбой] = useState(false);
  const [f, setF] = useState({
    first_name: "",
    last_name: "",
    phone: "",
    email: "",
    password: "",
    password2: "",
  });
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  // ⚠️ В САМОЙ ФУНКЦИИ СИНХРОННОГО setState НЕТ — только в ответах сервера.
  // Иначе её вызов из эффекта ловит правило react-hooks: синхронный setState
  // в эффекте даёт каскадные перерисовки. Сброс состояния перед повтором
  // делает кнопка, которая его и нажимает.
  const проверить = useCallback(() => {
    fetchWithTimeout(
      API + "/api/invite/validate/" + encodeURIComponent(token),
      {},
      12000,
    )
      .then(async (r) => {
        const d = await r.json().catch(() => null);
        setInfo(d);
        // ⚠️ АДРЕС ПОДСТАВЛЯЕМ СРАЗУ. Приглашение выписано на конкретного
        // человека, и сервер сверяет адрес (a5bcb13): пустое поле означало
        // «угадайте, кого звали» — ошибётся, получит отказ и не поймёт, чем
        // его почта не угодила.
        if (d && d.is_personal && d.email) {
          setF((p) => ({ ...p, email: d.email }));
        }
      })
      .catch(() => setСбой(true))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    проверить();
  }, [проверить]);

  async function submit() {
    setErr("");
    if (!f.email.trim() || !f.password) {
      setErr("Заполните email и пароль");
      return;
    }
    if (f.password.length < 8) {
      setErr("Пароль не менее 8 символов");
      return;
    }
    if (f.password !== f.password2) {
      setErr("Пароли не совпадают");
      return;
    }
    if (!f.first_name.trim()) {
      setErr("Укажите имя");
      return;
    }
    setBusy(true);
    try {
      const body = {
        token,
        phone: f.phone.trim() || null,
        email: f.email.trim(),
        password: f.password,
        first_name: f.first_name.trim(),
        last_name: f.last_name.trim(),
      };
      const res = await fetchWithTimeout(
        API + "/api/auth/register-by-invite",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
        15000,
      );
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        if (d.access_token) {
          onAuthed(d);
          return;
        }
        setSent(true);
        return;
      }
      setErr(текстОшибки(d, "Не удалось присоединиться"));
    } catch {
      setErr("Нет связи с сервером");
    } finally {
      setBusy(false);
    }
  }

  if (loading)
    return (
      <AuthShell>
        <div style={{ textAlign: "center" }}>
          <AocgLogo width={120} />
          <div
            style={{
              marginTop: 22,
              fontSize: 14,
              color: "#636B7D",
              fontFamily: FONT,
            }}
          >
            Проверяем приглашение…
          </div>
        </div>
      </AuthShell>
    );
  // ⚠️ СНАЧАЛА СБОЙ СВЯЗИ, ПОТОМ ПРИГОДНОСТЬ ССЫЛКИ. Порядок веток и есть
  // различение: пока они были одной, «не дозвонились до сервера» читалось
  // как «ссылку отозвали».
  if (сбой)
    return (
      <AuthShell>
        <div style={{ textAlign: "center", maxWidth: 340 }}>
          <AocgLogo width={120} />
          <div
            style={{
              marginTop: 22,
              fontSize: 15,
              color: C.dark,
              fontFamily: FONT,
              lineHeight: 1.5,
            }}
          >
            Не удалось проверить приглашение — сервер не ответил. Ссылка, скорее
            всего, цела: попробуйте ещё раз.
          </div>
          <button
            onClick={() => {
              setLoading(true);
              setСбой(false);
              проверить();
            }}
            type="button"
            style={{
              marginTop: 16,
              padding: "11px 20px",
              background: theme.cherry,
              color: "#fff",
              border: "none",
              borderRadius: 10,
              fontSize: 14,
              cursor: "pointer",
              fontFamily: FONT,
              fontWeight: 600,
            }}
          >
            Проверить ещё раз
          </button>
        </div>
      </AuthShell>
    );
  if (!info || !info.is_valid)
    return (
      <AuthShell>
        <div style={{ textAlign: "center", maxWidth: 340 }}>
          <AocgLogo width={120} />
          <div
            style={{
              marginTop: 22,
              fontSize: 15,
              color: C.dark,
              fontFamily: FONT,
            }}
          >
            Ссылка недействительна или истекла
          </div>
          <button
            onClick={() => navigate("/login")}
            type="button"
            style={{
              marginTop: 16,
              background: "none",
              border: "none",
              color: theme.cherry,
              fontSize: 14,
              cursor: "pointer",
              fontFamily: FONT,
            }}
          >
            ← Ко входу
          </button>
        </div>
      </AuthShell>
    );
  if (sent) return <CheckEmailScreen email={f.email} navigate={navigate} />;

  return (
    <AuthShell>
      <div
        style={{
          width: "100%",
          maxWidth: 380,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <AocgLogo width={120} />
        <div
          style={{
            fontSize: 16,
            fontWeight: 600,
            color: C.dark,
            fontFamily: FONT,
            marginTop: 18,
            textAlign: "center",
          }}
        >
          Присоединиться к «{info.org_name}»
        </div>
        <div
          style={{
            fontSize: 12,
            color: theme.fg2,
            fontFamily: FONT,
            marginBottom: 18,
          }}
        >
          Роль: {roleLabel(info.role)}
        </div>
        <div
          style={{
            width: "100%",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <input
            value={f.first_name}
            onChange={(e) => set("first_name", e.target.value)}
            placeholder="Имя"
            aria-label="Имя"
            style={A_INPUT}
          />
          <input
            value={f.last_name}
            onChange={(e) => set("last_name", e.target.value)}
            placeholder="Фамилия"
            aria-label="Фамилия"
            style={A_INPUT}
          />
          <input
            value={f.phone}
            onChange={(e) => set("phone", e.target.value)}
            inputMode="tel"
            placeholder="Телефон"
            aria-label="Телефон"
            style={A_INPUT}
          />
          {/* ⚠️ У ИМЕННОЙ ССЫЛКИ ПОЧТА НЕ РЕДАКТИРУЕТСЯ. Сервер сверяет её
              (a5bcb13), и правка поля может закончиться только отказом —
              поле, в котором можно набрать лишь один верный ответ, лучше
              показать готовым. У общей ссылки адресата нет, там поле своё. */}
          <input
            value={f.email}
            onChange={(e) => set("email", e.target.value)}
            readOnly={!!info.is_personal}
            autoCapitalize="none"
            autoCorrect="off"
            placeholder="Email"
            aria-label="Email"
            style={
              info.is_personal
                ? {
                    ...A_INPUT,
                    background: theme.surfaceSunk,
                    color: theme.fg2,
                  }
                : A_INPUT
            }
          />
          <div
            style={{
              fontSize: 12,
              color: theme.fg2,
              fontFamily: FONT,
              lineHeight: 1.45,
              marginTop: -4,
            }}
          >
            {info.is_personal
              ? "Приглашение выписано на этот адрес — войти можно только с него."
              : "Это общая ссылка: по ней входит любой, кто её получил. Укажите свою почту — роль будет «Сотрудник»."}
          </div>
          <div style={{ position: "relative" }}>
            <input
              value={f.password}
              onChange={(e) => set("password", e.target.value)}
              type={showPw ? "text" : "password"}
              placeholder="Пароль (от 8 символов)"
              aria-label="Пароль"
              style={{ ...A_INPUT, paddingRight: 44 }}
            />
            <button
              onClick={() => setShowPw((s) => !s)}
              type="button"
              aria-label={showPw ? "Скрыть пароль" : "Показать пароль"}
              style={{
                position: "absolute",
                right: 8,
                top: "50%",
                transform: "translateY(-50%)",
                border: "none",
                background: "none",
                cursor: "pointer",
                color: "#636B7D",
                display: "flex",
                padding: 6,
              }}
            >
              {showPw ? (
                <EyeOff size={18} aria-hidden="true" />
              ) : (
                <Eye size={18} aria-hidden="true" />
              )}
            </button>
          </div>
          <input
            value={f.password2}
            onChange={(e) => set("password2", e.target.value)}
            type={showPw ? "text" : "password"}
            placeholder="Повторите пароль"
            aria-label="Повторите пароль"
            style={A_INPUT}
          />
          {err && (
            <div
              style={{ color: theme.cherry, fontSize: 13, fontFamily: FONT }}
            >
              {err}
            </div>
          )}
          <button
            onClick={submit}
            disabled={busy}
            style={{
              marginTop: 4,
              padding: "13px",
              background: theme.cherry,
              color: "#fff",
              border: "none",
              borderRadius: 10,
              fontFamily: FONT,
              fontSize: 15,
              fontWeight: 600,
              cursor: busy ? "default" : "pointer",
              opacity: busy ? 0.7 : 1,
            }}
          >
            {busy ? "Присоединяем…" : "Присоединиться"}
          </button>
        </div>
      </div>
    </AuthShell>
  );
}

export default function App() {
  // Gate the entire UI behind the consent screen on first launch.
  // The flag is checked synchronously during the first render via lazy
  // initial state, so we don't flash the main interface for a frame.
  const [consentGiven, setConsentGiven] = useState(() => {
    try {
      return localStorage.getItem("consent_given") === "true";
    } catch {
      return false;
    }
  });
  // Строка 9: повторный сбор согласия решается по СЕРВЕРНОЙ записи, а не по
  // флагу в браузере. Флаг пропадает при чистке кэша и не переезжает на другое
  // устройство — по нему человек получил бы экран повторно без причины.
  // Сервер знает, на какой редакции он остановился; это и есть источник.
  const [page, setPage] = useState("glavnaya");
  const [appMenu, setAppMenu] = useState(false); // Тип 2 header — app switcher dropdown

  // ── УВЕДОМЛЕНИЯ (T159) ─────────────────────────────────────────────────────
  // ⚠️ ТОЧКА СЧИТАЕТ, А НЕ РИСУЕТСЯ ВСЕГДА. До 04.09.2026 колокольчик показывал
  // `alert("Уведомления — скоро")`, а красная точка стояла в разметке
  // БЕЗУСЛОВНО: она обещала непрочитанное, которого не существует. Это хуже
  // мёртвой кнопки — кнопка молчит, а точка утверждает.
  const [уведомления, setУведомления] = useState([]);
  const [непрочитано, setНепрочитано] = useState(0);
  const [показатьУведомления, setПоказатьУведомления] = useState(false);

  // ⚠️ БЕЗ useCallback НАМЕРЕННО. Обёртка здесь ничего не экономит (функция
  // зовётся при смене экрана, не в списке), а компилятор React из-за неё
  // переставал сохранять мемоизацию соседнего `loadCatalog` — линт показал
  // это сразу же, «Existing memoization could not be preserved».
  async function перечитатьУведомления() {
    try {
      const res = await authFetch("/api/notifications/");
      if (!res.ok) return; // молчим: колокольчик не повод для тоста
      const d = await res.json();
      setУведомления(Array.isArray(d.items) ? d.items : []);
      setНепрочитано(Number(d.unread) || 0);
    } catch {
      /* офлайн — оставляем прежнее число */
    }
  }

  async function открытьУведомления() {
    setПоказатьУведомления(true);
    // Открыл список — увидел всё (решение владельца: прочитанность
    // открытием, а не поштучно). Гасим точку сразу, не дожидаясь ответа:
    // человек УЖЕ смотрит, и мигание точки после закрытия выглядело бы
    // как новое событие.
    if (непрочитано > 0) {
      setНепрочитано(0);
      try {
        await authFetch("/api/notifications/read", { method: "POST" });
      } catch {
        /* не дошло — перечитаем при следующей смене экрана */
      }
      перечитатьУведомления();
    }
  }

  // ── ОТМЕНА ДЕЙСТВИЯ ────────────────────────────────────────────────────────
  // Свайп — жест лёгкий, промахнуться легко, поэтому у удаления обязана быть
  // либо модалка подтверждения, либо отмена. Модалку убрали (смахнуть и тапнуть
  // — уже два осознанных действия), значит нужна отмена: запрос уходит не сразу,
  // а через UNDO_MS, и всё это время висит тост с «Отменить».
  //
  // ЖИВЁТ В ОБОЛОЧКЕ, А НЕ НА ЭКРАНЕ, — намеренно: и таймер, и тост переживают
  // переход между вкладками нижнего меню. Держи мы их внутри «Отчётов», уход
  // на «Чеки» размонтировал бы экран, таймер бы умер и удаление не состоялось,
  // а человек считал бы, что отчёт удалён.
  //
  // ЕСЛИ СТРАНИЦУ ЗАКРЫЛИ ИЛИ ОБНОВИЛИ, ПОКА ТОСТ ВИСИТ, — таймер умирает
  // вместе со страницей, запрос не уходит, ОТЧЁТ ОСТАЁТСЯ. Это принято
  // осознанно (05.08): цена — «удалил и сразу вышел» иногда значит «не удалил»;
  // выигрыш — не трогаем схему БД (мягкое удаление потребовало бы колонки,
  // фильтрации всех выборок и ручки восстановления). Это НЕ баг.
  const UNDO_MS = 6000;
  const [undo, setUndo] = useState(null); // {message, actionLabel} — только для тоста
  const undoRef = useRef(null); // {commit, cancel} — актуальные обработчики
  const undoTimer = useRef(null);

  const finishUndo = useCallback((run) => {
    clearTimeout(undoTimer.current);
    const p = undoRef.current;
    undoRef.current = null;
    setUndo(null);
    if (p && run) p[run]?.();
  }, []);

  // ВТОРОЕ УДАЛЕНИЕ, ПОКА ВИСИТ ПЕРВОЕ: очередь длиной один. Предыдущее
  // действие подтверждается немедленно, и тост показывает уже новое. Два
  // таймера и два тоста означали бы, что «Отменить» отменяет неизвестно что.
  const scheduleUndo = useCallback(
    ({ message, actionLabel = "Отменить", commit, cancel }) => {
      finishUndo("commit");
      undoRef.current = { commit, cancel };
      setUndo({ message, actionLabel });
      undoTimer.current = setTimeout(() => finishUndo("commit"), UNDO_MS);
    },
    [finishUndo],
  );

  useEffect(() => () => clearTimeout(undoTimer.current), []);
  // ⚠️ ОДНО МЕСТО, ГДЕ ЗАПОМИНАЕТСЯ ОТКАЗ ЗАГРУЗКИ (T171, 06.09.2026).
  // Загрузчики оболочки глушили отказ пустым `catch`, состояние оставалось
  // пустым, и экран говорил «данных нет» — человек шёл делать лишнюю работу.
  // Ключ на каждый источник: экран показывает беду там, где она видна ему.
  const [сбоиЗагрузки, setСбоиЗагрузки] = useState({});
  // Счётчик попыток: кнопка «Загрузить ещё раз» просто крутит его, и эффект
  // загрузки идёт заново — одно место повтора вместо копии запросов рядом.
  const [попыткаЗагрузки, setПопыткаЗагрузки] = useState(0);
  const пометитьСбой = useCallback(
    (ключ, плохо) => setСбоиЗагрузки((п) => ({ ...п, [ключ]: плохо })),
    [],
  );
  const [receipts, setReceipts] = useState([]);
  const [cards, setCards] = useState([]);
  const [users, setUsers] = useState([]);
  const [catalog, setCatalog] = useState(null); // D1: справочник категорий (группы+статьи)
  const [role, setRole] = useState(null); // D2: роль текущего юзера для гейта управления категориями
  // REP-CRUD ЧП5г: id текущего юзера. Отчёт собирается только из СВОИХ чеков
  // (инвариант АО-1 на бэке), а бухгалтер видит чеки всей орг — без этого id
  // он выбрал бы чужой чек и упёрся в 409 «Чек другого сотрудника».
  const [userId, setUserId] = useState(null);
  const [me, setMe] = useState(null);
  // ⚠️ ПОДЭКРАН КАБИНЕТА ЖИВЁТ ЗДЕСЬ, А НЕ ВНУТРИ NastroykiPage.
  // Шапка Тип-2 рисуется на уровне App, и подпись экрана она берёт
  // отсюда. Держать состояние ниже — значит либо дублировать его,
  // либо оставить шапку без имени, а именно этого экран и лишился
  // (T106). null — хаб «Профиль».
  const [подэкран, setПодэкран] = useState(null);
  // Плитки «Главной» — прямые действия (решение владельца 03.09.2026):
  // тап открывает сканер/шторку СРАЗУ. ⚠️ СИГНАЛ ОДНОРАЗОВЫЙ: экран,
  // употребив его, обязан обнулить (onSignalConsumed) — иначе эффект при
  // ПОВТОРНОМ монтировании экрана видел живой счётчик и открывал окно
  // заново: «на Чеках висит сканер» (дефект 03.09, найден владельцем).
  // Возврата на «Главную» больше нет — решение сменено: закрыл сканер —
  // остаёшься на «Чеках» и видишь свой чек в списке; то же с отчётом.
  const [сигналСканера, setСигналСканера] = useState(0);
  const [сигналОтчёта, setСигналОтчёта] = useState(0);
  const [org, setOrg] = useState(null); // INT: профиль орг (нужен режим tax_system для Сводки/Главной)
  const [activePeriod, setActivePeriod] = useState("month");
  const scrollRef = useRef(null); // общий скроллер страниц (FAB прячется по нему)
  // ⚠️ T150: скроллер ОДИН на все экраны, и его позиция переживала смену
  // экрана — прокрутил «Главную», открыл «Профиль», и хаб рисовался в уже
  // прокрученном контейнере (поиск уходил ПОД шапку, замер: верх −10 при
  // ожидаемых 77). Три захода искали причину в вёрстке полос — она была
  // здесь. Решение владельца: ВПЕРЁД — всегда с верха, НАЗАД — на прежнее
  // место. Позиция каждой вкладки запоминается по скроллу и возвращается
  // при повторном входе; подэкраны профиля — всегда с верха.
  const позицииПрокрутки = useRef({});
  const ключПрокрутки = подэкран == null ? page : null;
  useEffect(() => {
    const с = scrollRef.current;
    if (!с) return;
    с.scrollTop =
      ключПрокрутки != null ? позицииПрокрутки.current[ключПрокрутки] ?? 0 : 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, подэкран]);

  // ─── Auth & lightweight routing ───
  const [authed, setAuthed] = useState(() => {
    try {
      return !!localStorage.getItem("access_token");
    } catch {
      return false;
    }
  });
  const [route, setRoute] = useState(() =>
    typeof window !== "undefined" ? window.location.pathname : "/",
  );
  const navigate = (path) => {
    try {
      window.history.pushState({}, "", path);
    } catch {
      /* ignore */
    }
    setRoute(path);
  };
  const onAuthed = (data) => {
    tokens.set(data);
    setAuthed(true);
    navigate("/");
  };
  useEffect(() => {
    const onPop = () => setRoute(window.location.pathname);
    const onLogout = (е) => {
      setAuthed(false);
      // ⚠️ Экран НЕ сохранялся никогда — он просто оставался в живом
      // дереве компонентов, потому что выход его не размонтирует.
      // Человек нажимал «Выйти» в профиле и после входа возвращался
      // ровно туда же, на экран выхода: читается как «не сработало».
      if (е && е.detail && е.detail.явный) {
        setPage("glavnaya");
        // ⚠️ СЕГОДНЯ ЭТА СТРОКА ИЗБЫТОЧНА, И ЭТО ИЗМЕРЕНО, а не додумано:
        // вход в профиль ровно один — круглая иконка в шапке, — и он сам
        // сбрасывает подэкран. Мутация «убрать сброс подэкрана отсюда»
        // оказалась ЭКВИВАЛЕНТНОЙ: сценарий не различает её никаким шагом.
        // Оставлена как защита на случай второго входа в профиль; если
        // он появится, сбрасывать придётся здесь.
        setПодэкран(null);
      }
    };
    window.addEventListener("popstate", onPop);
    window.addEventListener("auth:logout", onLogout);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("auth:logout", onLogout);
    };
  }, []);

  // D1/D2: загрузка каталога вынесена в callback — используется и при первичной
  // загрузке, и как onCatalogRefresh после CRUD в управлении категориями (Настройки).
  const loadCatalog = useCallback(() => {
    authFetch(`/api/categories/`)
      .then((r) => r.json())
      .then((data) => {
        setCatalogMaps(data);
        setCatalog(data && Array.isArray(data.groups) ? data : { groups: [] });
        пометитьСбой("категории", false);
      })
      .catch(() => пометитьСбой("категории", true));
  }, [пометитьСбой]);

  // ⚠️ ПЕРЕЧИТЫВАЕМ ПРИ СМЕНЕ ЭКРАНА, А НЕ ПО ТАЙМЕРУ. События рождаются
  // редко (отчёт одобрили, отклонили, прислали на проверку), а опрос каждые
  // 30 секунд — это запрос на каждого человека круглосуточно ради новости,
  // которая подождёт до следующего касания. Дешевле и честнее: человек
  // переключил экран — заодно узнали, есть ли новое.
  useEffect(() => {
    if (!me) return;
    // ⚠️ ЧЕРЕЗ setTimeout, И ЭТО НЕ УКРАШЕНИЕ: правило react-hooks запрещает
    // менять состояние синхронно внутри эффекта (каскад перерисовок).
    // Наступали дважды — на поиске и на плитках «Главной».
    const т = setTimeout(перечитатьУведомления, 0);
    return () => clearTimeout(т);
  }, [me, page]);

  // Don't fetch receipts/cards until the user has consented — keeps the
  // consent screen network-quiet, and re-runs the moment they accept.
  useEffect(() => {
    if (!consentGiven || !authed) return;
    // ⚠️ «ЧЕКОВ НЕТ» ПРИ 88 ЧЕКАХ — так выглядел отказ этого запроса.
    authFetch(`/api/receipts/`)
      .then((r) => r.json())
      .then((data) => {
        setReceipts(каноничныеЧеки(data));
        пометитьСбой("чеки", false);
      })
      .catch(() => пометитьСбой("чеки", true));
    authFetch(`/api/cards/`)
      .then((r) => r.json())
      .then((data) => {
        setCards(Array.isArray(data) ? data : []);
        пометитьСбой("карты", false);
      })
      .catch(() => пометитьСбой("карты", true));
    // ⚠️ ЭТО ТОТ САМЫЙ ЗАГРУЗЧИК ЛЮДЕЙ (T171). Отказ здесь гасит имена ВЕЗДЕ:
    // «Автор не указан» в чеках, пустой фильтр «Сотрудник», пустой список
    // сотрудников — и всё это выглядит как правда о данных.
    authFetch(`/api/users/`)
      .then((r) => r.json())
      .then((data) => {
        setUsers(Array.isArray(data) ? data : []);
        пометитьСбой("люди", false);
      })
      .catch(() => пометитьСбой("люди", true));
    loadCatalog(); // D1: каталог категорий (группы+статьи)
    authFetch(`/api/users/me`) // D2: роль текущего юзера для гейта управления категориями
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        // ⚠️ Карточка в каноне показывает ЧЕЛОВЕКА (инициалы, имя, бейдж
        // роли), а не организацию — решение владельца по снимку канона.
        // Ответ уже приходит, раньше из него брали только роль и id.
        if (data) setMe(data);
        if (data && data.role) setRole(data.role);
        if (data && typeof data.id === "number") setUserId(data.id);
        // Строка 9: редакция, на которой человек остановился ПО СЕРВЕРУ,
        // против действующей. Разошлись — показываем экран согласия снова.
        // Объяснения на экране нет намеренно: журнал очищен, для всех это
        // первый раз. Механика останется нужной при следующей смене редакции.
        if (data) {
          загрузитьСогласие()
            .then((политика) => {
              const было = data.consent && data.consent.policy_version;
              if (было !== политика.version) setConsentGiven(false);
            })
            .catch(() => {}); // сеть упала — ворота не трогаем
        }
        // Роль пришла — значит гейты закрыты по праву, а не по молчанию.
        пометитьСбой("роль", !data);
      })
      // ⚠️ САМОЕ ДОРОГОЕ МЕСТО ИЗ ВСЕХ: без роли гейты закрываются, и человек
      // видит урезанное приложение — читает это как «у меня отняли права» и
      // идёт выяснять к администратору. Отказ обязан назвать себя.
      .catch(() => пометитьСбой("роль", true));
    authFetch(`/api/organizations/me`) // INT: режим налогообложения для Сводки/Главной
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && data.id) setOrg(data);
        пометитьСбой("организация", false);
      })
      .catch(() => пометитьСбой("организация", true));
  }, [consentGiven, authed, loadCatalog, пометитьСбой, попыткаЗагрузки]);

  // ⚠️ ОТКАЗ СЕРВЕРА ГОВОРИТ ЧЕЛОВЕКУ, А НЕ ПРОПАДАЕТ (Р-ОТКАЗЫ, T116).
  // Замер 04.09.2026: справочники карт и людей молчали при любом отказе —
  // нажал «Добавить карту», сервер ответил 403 или 500, экран не изменился
  // и не сказал ничего. Хуже пустого экрана: человек считает, что действие
  // прошло, и узнаёт правду через сутки, когда карты нет.
  //
  // Текст берём ИЗ ОТВЕТА (`текстОшибки`): у сервера он человеческий и точный
  // («последний администратор», «нельзя себя»), а наше «что-то пошло не так»
  // отправляет чинить наугад.
  // Тост оболочки для отказов: он должен пережить и прокрутку, и переход
  // между вкладками — как тост отмены рядом.
  const [отказТост, setОтказТост] = useState(null);

  async function сказатьОбОтказе(res, запасной) {
    let тело = null;
    try {
      тело = await res.json();
    } catch {
      /* тело может быть пустым — тогда говорим запасным текстом */
    }
    setОтказТост({
      type: "error",
      message: текстОшибки(тело, запасной),
      duration: 5000,
    });
  }

  // Тост гаснет сам: держать отказ на экране до следующего действия — значит
  // мешать работать. Пять секунд хватает прочитать две строки.
  useEffect(() => {
    if (!отказТост) return;
    const т = setTimeout(() => setОтказТост(null), отказТост.duration || 5000);
    return () => clearTimeout(т);
  }, [отказТост]);

  async function addCard(name) {
    const res = await authFetch(`/api/cards/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      await сказатьОбОтказе(res, "Не удалось добавить карту");
      return;
    }
    const c = await res.json();
    setCards((prev) => [...prev, c]);
  }

  async function updateCard(id, name) {
    const res = await authFetch(`/api/cards/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      await сказатьОбОтказе(res, "Не удалось переименовать карту");
      return;
    }
    const c = await res.json();
    setCards((prev) => prev.map((x) => (x.id === id ? c : x)));
  }

  async function deleteCard(id) {
    // ⚠️ РАНЬШЕ КАРТА ИСЧЕЗАЛА С ЭКРАНА НЕЗАВИСИМО ОТ ОТВЕТА — сервер мог
    // отказать (у сотрудника нет прав), а человек видел успех. Это худший
    // вид молчания: экран расходится с базой, и обнаруживается это после
    // перезагрузки.
    const res = await authFetch(`/api/cards/${id}`, { method: "DELETE" });
    if (!res.ok) {
      await сказатьОбОтказе(res, "Не удалось удалить карту");
      return;
    }
    setCards((prev) => prev.filter((x) => x.id !== id));
  }

  async function setDefaultCard(id) {
    const res = await authFetch(`/api/cards/${id}/default`, {
      method: "PATCH",
    });
    if (!res.ok) {
      await сказатьОбОтказе(res, "Не удалось назначить карту основной");
      return;
    }
    setCards((prev) => prev.map((x) => ({ ...x, is_default: x.id === id })));
  }

  async function updateUser(id, patch) {
    const res = await authFetch(`/api/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const тело = await res.json().catch(() => null);
    if (res.ok) {
      setUsers((prev) => prev.map((x) => (x.id === id ? тело : x)));
      return { ok: true, user: тело };
    }
    // ⚠️ ПРИЧИНА ВОЗВРАЩАЕТСЯ, А НЕ ГЛОТАЕТСЯ. Прежняя редакция отдавала
    // `null` — и вызывающий не мог отличить «нельзя понизить последнего
    // администратора» от «нет связи». Через `текстОшибки`, потому что у
    // FastAPI `detail` бывает массивом объектов (T125).
    return {
      ok: false,
      причина: текстОшибки(тело, `Сервер ответил ${res.status}`),
    };
  }

  async function deleteUser(id) {
    const res = await authFetch(`/api/users/${id}`, { method: "DELETE" });
    if (!res.ok) {
      // Здесь у сервера самые нужные тексты: «единственный администратор,
      // пригласите второго», «последний администратор, назначьте другого».
      // Проглотить их — значит оставить человека в тупике без объяснения.
      await сказатьОбОтказе(res, "Не удалось отключить сотрудника");
      return;
    }
    // ⚠️ СТРОКА НЕ ВЫБРАСЫВАЕТСЯ ИЗ СПИСКА (T118/④). Прежняя редакция
    // удаляла её из состояния — и человек пропадал с экрана, как пропадал
    // и с сервера. Гашение мягкое: строка остаётся, помечается неактивной,
    // и её видно, чтобы ошибочный свайп можно было отменить.
    if (res.ok)
      setUsers((prev) =>
        prev.map((x) => (x.id === id ? { ...x, is_active: false } : x)),
      );
  }

  // ⚠️ ВОЗВРАТ ПОГАШЕННОГО. Обратного действия не было ни одного, и
  // ошибочный свайп чинился только руками в базе.
  async function restoreUser(id) {
    const res = await authFetch(`/api/users/${id}/restore`, { method: "POST" });
    if (!res.ok) return null;
    const u = await res.json();
    setUsers((prev) => prev.map((x) => (x.id === id ? u : x)));
    return u;
  }

  function handleAdd(created) {
    // ⚠️ ФОРМА — общей функцией, а логика списка («заменить или положить
    // в начало») остаётся ЗДЕСЬ: она про список, а не про чек (T177).
    const norm = каноничныйЧек(created);
    setReceipts((prev) =>
      prev.some((x) => x.id === norm.id)
        ? prev.map((x) => (x.id === norm.id ? norm : x))
        : [norm, ...prev],
    );
  }

  // ⚠️ УСПЕХ — ЭТО ПОДТВЕРЖДЁННОЕ УДАЛЕНИЕ, А НЕ КОД 200 (05.09.2026).
  //
  // ЗАМЕР: `DELETE /api/receipts/{id}` отвечает 200 `{"ok": true}` ВСЕГДА —
  // и когда чек удалён, и когда нет (`receipts.py:1009-1010`, анти-разведка:
  // чужой чек обязан быть неотличим от несуществующего). Прежний код считал
  // успехом любой `res.ok` и убирал строку с экрана: бухгалтер удалял чужой
  // чек, экран говорил «удалено», а после перезагрузки чек был на месте.
  // Экран расходился с базой молча — это хуже отказа.
  //
  // ⚠️ ЗА СЕРВЕР НИЧЕГО НЕ ВЫДУМЫВАЕМ: из ответа удаление неотличимо от
  // отказа, поэтому спрашиваем ФАКТ — перечитываем чек. Нет его (404) —
  // удалён; отвечает — не удалён, и мы об этом говорим, а строку не трогаем.
  // Лишний запрос здесь дешевле вранья на экране.
  //
  // ЧТО ЭТО СТОИТ ИСПРАВИТЬ В БЭКЕНДЕ (отдельной работой, здесь не трогаем):
  // вернуть в теле `{"ok": true, "deleted": true|false}`. Разведки это не
  // открывает — для чужого чека и для несуществующего id ответ одинаков
  // (`deleted: false`), а фронт перестанет ходить вторым запросом.
  async function handleDelete(id) {
    const res = await authFetch(`/api/receipts/${id}`, { method: "DELETE" });
    if (!res.ok) {
      // 409 «чек входит в отчёт «X»» — текст берём у сервера, он точнее.
      await сказатьОбОтказе(res, "Не удалось удалить чек");
      return false;
    }
    const проверка = await authFetch(`/api/receipts/${id}`);
    if (проверка.ok) {
      setОтказТост({
        type: "error",
        message: "Чек не удалён: удалять чужие чеки может только администратор",
        duration: 5000,
      });
      return false;
    }
    setReceipts((prev) => prev.filter((x) => x.id !== id));
    return true;
  }

  // Массовое удаление дублей из баннера (задача №9 фаза D). Возвращает тело ответа
  // {deleted, blocked_fns, blocked_in_report} (или null при сбое); на успехе
  // убирает удалённые id из списка (как handleDelete, но для массива).
  async function handleBulkDelete(ids, force = false) {
    try {
      const res = await authFetch(`/api/receipts/bulk-delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, force }),
      });
      if (!res.ok) return null;
      const body = await res.json();
      if (body.deleted?.length)
        setReceipts((prev) => prev.filter((x) => !body.deleted.includes(x.id)));
      return body;
    } catch {
      return null;
    }
  }

  // Перечитать ВЕСЬ список чеков. Нужен, когда изменение пришло не из самого
  // списка и затронуло сразу несколько строк: удалили отчёт → все его чеки
  // освободились, у них сменился in_report/report_title, и карточка чека
  // должна снова показывать «Прикрепить к отчёту», а не пометку.
  async function reloadReceipts() {
    try {
      const res = await authFetch(`/api/receipts/`);
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data)) setReceipts(каноничныеЧеки(data));
    } catch {
      /* офлайн — оставляем текущий список */
    }
  }

  // Перечитать ОДИН чек канонической формой и обновить строку в списке.
  // Нужен там, где данные могли протухнуть без нашего участия: открытие
  // карточки (список грузится раз за сессию) и прикрепление к отчёту
  // (меняются вычисляемые in_report / report_title).
  async function handleRefreshReceipt(id) {
    try {
      const res = await authFetch(`/api/receipts/${id}`);
      if (!res.ok) return null;
      const fresh = await res.json();
      const norm = каноничныйЧек(fresh);
      setReceipts((prev) => prev.map((r) => (r.id === id ? norm : r)));
      return norm;
    } catch {
      return null;
    }
  }

  async function handleUpdate(id, patch) {
    try {
      const res = await authFetch(`/api/receipts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) return null;
      const updated = await res.json();
      const norm = каноничныйЧек(updated);
      setReceipts((prev) => prev.map((r) => (r.id === id ? norm : r)));
      return norm;
    } catch {
      return null;
    }
  }

  // First-launch gate — show the consent screen until the user accepts. The
  // 152-FZ POST + localStorage flip happens inside onAccept; once flipped,
  // the main UI mounts and the receipts/cards effect re-runs.
  // ─── Auth & route gate ───
  const isRegister = route === "/register";
  const isVerify = route.startsWith("/verify-email");
  const isJoin = route.startsWith("/join/");
  // ⚠️ ОБА МАРШРУТА ВОССТАНОВЛЕНИЯ ОБЯЗАНЫ БЫТЬ ИМЕННО В ЭТОМ УСЛОВИИ.
  // Оно решает, съест ли экран входа чужой путь. Ссылка из письма ведёт
  // на /reset-password?token=…; не будь его здесь, человек попал бы на форму
  // логина, а токен молча потерялся — ровно ту ошибку сторож и ловит.
  const isForgot = route === "/forgot-password";
  const isReset = route.startsWith("/reset-password");
  if (
    route === "/login" ||
    (!authed && !isRegister && !isVerify && !isJoin && !isForgot && !isReset)
  ) {
    return <LoginScreen onAuthed={onAuthed} navigate={navigate} />;
  }
  if (isForgot) return <ForgotPasswordScreen navigate={navigate} />;
  if (isReset) return <ResetPasswordScreen navigate={navigate} />;
  if (isRegister)
    return <RegisterScreen onAuthed={onAuthed} navigate={navigate} />;
  if (isVerify)
    return <VerifyEmailScreen onAuthed={onAuthed} navigate={navigate} />;
  if (isJoin)
    return (
      <JoinScreen
        token={route.split("/join/")[1] || ""}
        onAuthed={onAuthed}
        navigate={navigate}
      />
    );

  // Authed beyond this point.
  if (!consentGiven) {
    return <ConsentScreen onAccept={() => setConsentGiven(true)} />;
  }

  // Тип 2: нижнее меню — Главная · Сводка · Чеки · Отчёты.
  // «Настройки» убраны из таб-бара — открываются по иконке аккаунта в шапке.
  const NAV = [
    { id: "glavnaya", Icon: Home, label: "Главная" },
    { id: "svodka", Icon: ChartColumn, label: "Сводка" },
    { id: "operacii", Icon: ReceiptText, label: "Чеки" },
    { id: "otchety", Icon: ClipboardList, label: "Отчёты" },
  ];
  return (
    <div
      style={{
        // width:100% обязателен. #root — колоночный флекс-контейнер, а в нём
        // поперечная ось ГОРИЗОНТАЛЬНАЯ: элемент по умолчанию растягивается
        // на ширину родителя, но авто-отступ (margin:"0 auto") растяжение
        // ОТМЕНЯЕТ и переводит элемент в режим «по содержимому». Тогда
        // ширина = min(содержимое, maxWidth), и maxWidth из ограничителя
        // превращается в ЗАДАННУЮ ширину: на телефоне 383px колонка брала
        // все 480 и уезжала за экран вместе с шапкой и нижним меню.
        // С width:100% колонка занимает доступное (383 на телефоне),
        // maxWidth снова только ограничивает (480 на десктопе),
        // а авто-отступы центрируют её там, где место есть.
        width: "100%",
        maxWidth: 480,
        margin: "0 auto",
        height: "100dvh",
        display: "flex",
        flexDirection: "column",
        background: theme.bg,
        fontFamily: FONT,
        overflow: "hidden",
      }}
    >
      <div
        // role="banner" — не украшение: это опора и для скринридера, и для
        // сторожа, которому нужно найти шапку, чтобы проверить, не легла ли
        // на неё плашка отказа.
        role="banner"
        style={{
          background: theme.surface,
          borderBottom: `1px solid ${theme.border}`,
          flexShrink: 0,
          paddingTop: "env(safe-area-inset-top)",
        }}
      >
        <div
          style={{
            padding: "10px 12px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            position: "relative",
          }}
        >
          {/* LEFT — only the plate Λ is clickable (→ app switcher); the section title is a plain label (Тип 2) */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              minWidth: 0,
            }}
          >
            <button
              onClick={() => setAppMenu((o) => !o)}
              aria-label="Переключить приложение"
              style={{
                display: "flex",
                border: "none",
                background: "none",
                cursor: "pointer",
                padding: 2,
                borderRadius: 8,
                flexShrink: 0,
              }}
            >
              <MarkPlate size={34} />
            </button>
            <span
              style={{
                fontSize: 17,
                fontFamily: FONT,
                fontWeight: 600,
                color: "#111318",
                whiteSpace: "nowrap",
              }}
            >
              {/* ⚠️ У ЭКРАНА НАСТРОЕК ПОДПИСИ НЕ БЫЛО ВООБЩЕ: NAV его
                  не содержит, и шапка показывала пустоту. Отсюда T106 —
                  я назвал экран «Настройки» по имени компонента, а на
                  экране не было НИКАКОГО слова. В каноне он «Профиль». */}
              {(NAV.find((n) => n.id === page) || {}).label ||
                (page === "nastroyki" ? подэкран || "Профиль" : "")}
            </span>
          </div>
          {appMenu && <AppSwitcher onClose={() => setAppMenu(false)} />}
          {/* RIGHT — account (человечек) then bell (rightmost, cherry unread dot) */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexShrink: 0,
            }}
          >
            <button
              onClick={() => {
                setПодэкран(null);
                setPage("nastroyki");
              }}
              aria-label="Аккаунт"
              style={{
                width: 40,
                height: 40,
                borderRadius: "50%",
                background: "#FFFFFF",
                border: "none",
                boxShadow: "0 1px 3px rgba(17,19,24,0.10)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                flexShrink: 0,
                transition: "opacity 120ms ease",
              }}
            >
              <User
                size={20}
                color="#111318"
                strokeWidth={1.75}
                aria-hidden="true"
              />
            </button>
            <button
              onClick={открытьУведомления}
              aria-label="Уведомления"
              style={{
                position: "relative",
                width: 40,
                height: 40,
                borderRadius: "50%",
                background: "#FFFFFF",
                border: "none",
                boxShadow: "0 1px 3px rgba(17,19,24,0.10)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                flexShrink: 0,
                transition: "opacity 120ms ease",
              }}
            >
              <Bell
                size={20}
                color="#111318"
                strokeWidth={1.75}
                aria-hidden="true"
              />
              {/* ⚠️ ТОЧКА ПОЯВЛЯЕТСЯ ТОЛЬКО ПРИ НЕПРОЧИТАННЫХ (T159).
                  Канон рисует её у колокольчика — и это верно, но канон
                  описывает вид, а не обещание: точка, горящая всегда,
                  врёт про непрочитанное. */}
              {непрочитано > 0 && (
                <span
                  style={{
                    position: "absolute",
                    top: 8,
                    right: 9,
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: theme.cherry,
                    border: "1.5px solid #fff",
                  }}
                />
              )}
            </button>
          </div>
        </div>
      </div>
      {/* ⚠️ СПИСОК СОБЫТИЙ (T159). Экрана уведомлений в каноне НЕТ ни одного
          (в макетах шесть страниц, этой среди них нет) — канон нарисовал
          индикатор, не нарисовав того, что за ним. Отступление именованное:
          ЭкранУведомленийВнеКанона. Форма взята у существующих шторок
          приложения, чтобы не изобретать новый язык. */}
      {показатьУведомления && (
        <div
          onClick={() => setПоказатьУведомления(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 60,
            background: "rgba(17,19,24,.35)",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
          }}
        >
          <div
            onClick={(е) => е.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 480,
              maxHeight: "78dvh",
              overflowY: "auto",
              background: theme.surface,
              borderRadius: "16px 16px 0 0",
              padding: "16px 16px calc(env(safe-area-inset-bottom) + 20px)",
              // width:100% вместе с padding при content-box делает элемент
              // ШИРЕ родителя всегда — сторож вёрстки (T14) поймал это сразу.
              boxSizing: "border-box",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 12,
              }}
            >
              <span style={{ font: `600 17px/1.2 ${FONT}`, color: "#111318" }}>
                Уведомления
              </span>
              <button
                onClick={() => setПоказатьУведомления(false)}
                aria-label="Закрыть"
                style={{
                  border: "none",
                  background: "none",
                  font: `400 15px/1 ${FONT}`,
                  color: theme.fg2,
                  cursor: "pointer",
                  padding: 6,
                }}
              >
                Закрыть
              </button>
            </div>

            {/* ⚠️ ПУСТО — ЭТО ТОЖЕ ОТВЕТ, и он честный: список работает,
                событий пока нет. Отличается от прежнего «Уведомления — скоро»,
                которое обещало несделанное. */}
            {уведомления.length === 0 ? (
              <div
                style={{
                  font: `400 14px/1.5 ${FONT}`,
                  color: theme.fg2,
                  padding: "18px 4px 24px",
                  textAlign: "center",
                }}
              >
                Пока ничего нового.
                <br />
                Здесь появятся решения по вашим отчётам.
              </div>
            ) : (
              уведомления.map((н) => (
                <div
                  key={н.id}
                  style={{
                    padding: "12px 0",
                    borderBottom: `1px solid ${theme.border}`,
                    display: "flex",
                    gap: 10,
                  }}
                >
                  {/* Непрочитанное отмечено точкой у строки — той же вишнёвой,
                      что на колокольчике: один цвет, один смысл. */}
                  <span
                    style={{
                      flexShrink: 0,
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      marginTop: 6,
                      background: н.read ? "transparent" : theme.cherry,
                    }}
                  />
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        font: `${н.read ? 400 : 600} 14px/1.35 ${FONT}`,
                        color: "#111318",
                      }}
                    >
                      {н.title}
                    </div>
                    {н.body && (
                      <div
                        style={{
                          marginTop: 3,
                          font: `400 13px/1.4 ${FONT}`,
                          color: theme.fg2,
                          wordBreak: "break-word",
                        }}
                      >
                        {н.body}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ⚠️ ОТКАЗ ЗАГРУЗКИ ВИДЕН НА ЛЮБОМ ЭКРАНЕ (T171). Данные оболочки
          кормят все экраны сразу: не пришли люди — исчезли имена авторов,
          не пришла роль — закрылись гейты, и человек читает это как правду
          о своих правах. Поэтому плашка стоит под шапкой, а не внутри
          одного экрана, и перечисляет ИМЕННО ТО, чего не хватает. */}
      {Object.values(сбоиЗагрузки).some(Boolean) && (
        <div style={{ padding: "8px 12px 0" }}>
          <LoadFailure
            что={Object.keys(сбоиЗагрузки)
              .filter((к) => сбоиЗагрузки[к])
              .join(", ")}
            onRetry={() => setПопыткаЗагрузки((н) => н + 1)}
          />
        </div>
      )}

      {/* Единственный скроллер страниц: к нему привязано прятанье
          плавающей кнопки на всех экранах, где она есть. */}
      <div
        ref={scrollRef}
        onScroll={(е) => {
          // Позиция пишется ПО ХОДУ прокрутки, а не в момент ухода: при
          // смене экрана содержимое уже подменено и scrollTop обрезан
          // новой высотой — сохранять поздно, сохранилось бы враньё.
          if (ключПрокрутки != null)
            позицииПрокрутки.current[ключПрокрутки] = е.currentTarget.scrollTop;
        }}
        style={{ flex: 1, overflow: "auto" }}
      >
        {page === "glavnaya" && (
          <GlavnayaPage
            receipts={receipts}
            onScan={() => {
              setPage("operacii");
              setСигналСканера((с) => с + 1);
            }}
            onNewReport={() => {
              setPage("otchety");
              setСигналОтчёта((с) => с + 1);
            }}
            catalog={catalog}
            org={org}
            setPage={setPage}
            authFetch={authFetch}
            fmtDate={fmtDate}
            plural={plural}
            inPeriod={inPeriod}
            catName={catName}
            catColor={catColor}
          />
        )}
        {page === "svodka" && (
          <SvodkaPage
            receipts={receipts}
            activePeriod={activePeriod}
            setActivePeriod={setActivePeriod}
            users={users}
            cards={cards}
            catalog={catalog}
            org={org}
            role={role}
          />
        )}
        {page === "operacii" && (
          <OperaciiPage
            scrollRef={scrollRef}
            сигналСканера={сигналСканера}
            onScanSignalConsumed={() => setСигналСканера(0)}
            receipts={receipts}
            users={users}
            cards={cards}
            catalog={catalog}
            handleAdd={handleAdd}
            handleDelete={handleDelete}
            handleUpdate={handleUpdate}
            handleRefreshReceipt={handleRefreshReceipt}
            role={role}
            handleBulkDelete={handleBulkDelete}
            activePeriod={activePeriod}
            setActivePeriod={setActivePeriod}
          />
        )}
        {page === "otchety" && (
          <OtchetyPage
            сигналНовогоОтчёта={сигналОтчёта}
            onReportSignalConsumed={() => setСигналОтчёта(0)}
            scheduleUndo={scheduleUndo}
            scrollRef={scrollRef}
            receipts={receipts}
            users={users}
            FiltersModal={FiltersModal}
            FilterIcon={FilterIcon}
            userId={userId}
            role={role}
            authFetch={authFetch}
            reloadReceipts={reloadReceipts}
            plural={plural}
            TabBar={TabBar}
            Btn={Btn}
            Modal={Modal}
            RuleInput={RuleInput}
            Block={Block}
            Toast={Toast}
          />
        )}
        {page === "nastroyki" && (
          <NastroykiPage
            cards={cards}
            onAddCard={addCard}
            onUpdateCard={updateCard}
            onDeleteCard={deleteCard}
            onSetDefaultCard={setDefaultCard}
            users={users}
            onUpdateUser={updateUser}
            onDeleteUser={deleteUser}
            onRestoreUser={restoreUser}
            role={role}
            me={me}
            экран={подэкран}
            наЭкран={setПодэкран}
            catalog={catalog}
            onCatalogRefresh={loadCatalog}
          />
        )}
      </div>
      {/* Тост отмены — в ОБОЛОЧКЕ: переживает и прокрутку, и переход между
          вкладками нижнего меню. Внутри экрана он умирал бы вместе с ним. */}
      <Toast
        toast={
          // ⚠️ ОДИН ТОСТ НА ДВА ПОВОДА, А НЕ ДВА РЯДОМ: наложенные друг
          // на друга сообщения читаются хуже одного. Отмена важнее отказа —
          // в ней есть действие с коротким сроком.
          undo
            ? {
                type: "success",
                message: undo.message,
                action: {
                  label: undo.actionLabel,
                  onClick: () => finishUndo("cancel"),
                },
              }
            : отказТост
        }
      />
      <div
        style={{
          background: theme.surface,
          borderTop: `1px solid ${theme.border}`,
          display: "flex",
          flexShrink: 0,
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        {NAV.map((n) => {
          const Icon = n.Icon;
          const active = page === n.id;
          const color = active ? theme.cherry : "#636B7D";
          return (
            <button
              key={n.id}
              onClick={() => setPage(n.id)}
              style={{
                flex: 1,
                // Та же мина, что в SegmentedControl: без minWidth:0 кнопка
                // не сжимается уже своей подписи. Четыре подписи («Главная»,
                // «Сводка», «Чеки», «Отчёты») на узком экране перестают
                // помещаться, строка меню становится шире вьюпорта, документ
                // получает горизонтальную прокрутку — и весь каркас уезжает
                // влево вместе с шапкой, а первый пункт уходит за край.
                minWidth: 0,
                padding: "8px 0 7px",
                border: "none",
                background: "transparent",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 3,
                cursor: "pointer",
                transition: "opacity 100ms ease",
              }}
            >
              <Icon size={22} color={color} strokeWidth={1.25} />
              <span
                style={{
                  fontSize: 11,
                  fontWeight: active ? 600 : 500,
                  fontFamily: FONT,
                  color,
                  // Кнопке разрешено сжиматься (minWidth:0 выше), поэтому
                  // подпись обязана уметь обрезаться — иначе она просто
                  // вылезет за кнопку и вернёт ту же переполненную строку.
                  maxWidth: "100%",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {n.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
