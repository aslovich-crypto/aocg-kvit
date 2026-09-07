import { useState, useEffect, useRef } from "react";
import { имяАвтора } from "../lib/people";
import { canApprove } from "../lib/reports";
import { snapdom } from "@zumer/snapdom";
import {
  ChevronLeft,
  Share2,
  MoreHorizontal,
  Trash2,
  MapPin,
  BadgeCheck,
  ChevronDown,
  ChevronRight,
  CreditCard,
  Banknote,
  Landmark,
  Check,
  Paperclip,
  Plus,
} from "lucide-react";
import { FONT, theme } from "../lib/theme";
import { shortOrg, fmtDate, fmtDateTime, money } from "../lib/format";
import { catName, catColor } from "../lib/categories";
import { useModalA11y } from "../hooks/useModalA11y";
import { authFetch } from "../lib/api";
import CategorySheet from "./CategorySheet";
import ReportDetailModal from "./ReportDetailModal";

// Токены дизайн-системы (colors_and_type.css), смапленные на палитру C +
// несколько литералов, которых нет в C (success/error/cherry-hover).
const T = {
  fg1: "#111318",
  fg2: theme.fg2, // #636B7D
  fg3: theme.fg3, // #9CA3AF
  border: theme.border, // #EEF0F4
  borderStrong: theme.borderStrong, // #E2E5EB
  chipBg: "#EEF0F4",
  successBg: "#F0FDF4",
  successFg: "#15803D",
  errorFg: "#B91C1C",
  cherry: theme.cherry,
  cherryTint: theme.cherryTint, // Brand Tint — подсветка выбранного пункта
  cherryHover: "#8B1218",
  white: theme.surface,
};

// Коды СНО колонки receipts.tax_system (мэппинг бэка fns_parser) → русские метки.
// Это НЕ TAX_LABELS из lib/tax — там другой набор кодов (для организаций).
const TAX_LABELS_RECEIPT = {
  osno: "ОСНО",
  usn_income: "УСН «Доходы»",
  usn_income_minus_expense: "УСН «Доходы−Расходы»",
  envd: "ЕНВД",
  eshn: "ЕСХН",
  psn: "Патент",
  npd: "НПД",
};

// Количество позиции: целое → «N шт», дробное (весовой товар) → как есть.
function qtyLabel(q) {
  if (q === undefined || q === null || q === "") return "";
  const n = Number(q);
  if (!isFinite(n)) return "";
  return Number.isInteger(n) ? `${n} шт` : n.toLocaleString("ru-RU");
}

// Тег 1199 ФФД (Таблица 8): код ставки → подпись. Расчётные помечены форматом «X/Y».
const TAG_1199 = {
  1: "НДС 20%",
  3: "НДС 20/120",
  2: "НДС 10%",
  4: "НДС 10/110",
  5: "НДС 0%",
  6: "Без НДС",
  7: "НДС 5%",
  9: "НДС 5/105",
  8: "НДС 7%",
  10: "НДС 7/107",
  11: "НДС 22%",
  12: "НДС 22/122",
};

// Подпись ставки НДС позиции по коду ФФД (tag 1199, все 12) ИЛИ строке (OCR).
// Расчётные (3/4/9/10/12) — форматом «X/Y». «НДС 0%» ≠ «Без НДС». Не падает без поля.
function vatRateLabel(nds) {
  if (nds === undefined || nds === null || nds === "") return "";
  const s = String(nds).trim();
  if (TAG_1199[s]) return TAG_1199[s]; // код 1..12
  // OCR-строки ("22"/"20"/"10"/"7"/"5"/"0"/"без НДС") — не падать без поля
  const m = s.match(/\b(22|20|10|7|5|0)\b/);
  if (m) return m[1] === "0" ? "НДС 0%" : `НДС ${m[1]}%`;
  if (/без/i.test(s)) return "Без НДС";
  return "";
}

// Иконка способа оплаты — статический компонент (объявлен вне render, чтобы не
// плодить «компонент при рендере»): карта по умолчанию, наличные, счёт компании.
function PayGlyph({ value, size = 16, color, style }) {
  if (value && /нал/i.test(value))
    return <Banknote size={size} color={color} style={style} />;
  if (value && /сч[её]т/i.test(value))
    return <Landmark size={size} color={color} style={style} />;
  return <CreditCard size={size} color={color} style={style} />;
}
function payLabel(v) {
  if (!v) return "Оплата";
  const i = v.indexOf("•");
  return i >= 0 ? v.slice(i + 1).trim() : v;
}

// ── внутренняя нижняя шторка (оплата + подтверждение удаления) ──────────────
function Sheet({ title, onClose, children }) {
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
        position: "absolute",
        inset: 0,
        background: "rgba(22,26,29,0.45)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        zIndex: 60,
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
          background: T.white,
          width: "100%",
          borderRadius: "20px 20px 0 0",
          transform: shown ? "translateY(0)" : "translateY(100%)",
          transition: `transform ${shown ? 280 : 220}ms ${EASE}`,
          padding: "8px 16px calc(16px + env(safe-area-inset-bottom))",
          maxHeight: "80%",
          overflowY: "auto",
          outline: "none",
        }}
      >
        <div
          style={{
            width: 38,
            height: 4,
            borderRadius: 999,
            background: "#D7DAE0",
            margin: "8px auto 14px",
          }}
        />
        {title && (
          <h3
            style={{
              font: `600 17px/1 ${FONT}`,
              color: T.fg1,
              margin: "0 0 12px",
              padding: "0 2px",
            }}
          >
            {title}
          </h3>
        )}
        {children}
      </div>
    </div>
  );
}

const optStyle = (sel) => ({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  width: "100%",
  background: sel ? T.cherryTint : "none",
  border: "none",
  cursor: "pointer",
  padding: "14px 12px",
  borderRadius: 10,
  font: `500 15px/1 ${FONT}`,
  color: T.fg1,
  textAlign: "left",
});

function PaymentSheet({ options, selected, onPick, onClose }) {
  return (
    <Sheet title="Метод оплаты" onClose={onClose}>
      {options.map((opt) => {
        const sel = selected === opt;
        return (
          <button key={opt} onClick={() => onPick(opt)} style={optStyle(sel)}>
            <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <PayGlyph value={opt} size={18} color={T.fg2} />
              {opt}
            </span>
            {sel && <Check size={20} color={T.cherry} />}
          </button>
        );
      })}
      {options.length === 0 && (
        <div
          style={{
            padding: "20px 12px",
            fontFamily: FONT,
            fontSize: 13,
            color: T.fg3,
            textAlign: "center",
          }}
        >
          Нет доступных способов оплаты
        </div>
      )}
    </Sheet>
  );
}

// Показываем только те отчёты, куда бэк реально пустит: состав можно менять
// в «Черновике» и «Отклонён», а «На проверке»/«Одобрен» заморожены (409).
// Замороженные не показываем вовсе — предлагать вариант, который отвергнется,
// хуже, чем не предлагать.
const ATTACHABLE_STATUSES = ["Черновик", "Отклонён"];

function ReportPickSheet({
  reports,
  receiptId,
  loading,
  error,
  busy,
  onPick,
  onCreate,
  onClose,
}) {
  return (
    <Sheet title="Прикрепить к отчёту" onClose={onClose}>
      {/* «+ Новый отчёт» первым пунктом: без него у пользователя без
          черновиков пустая шторка и тупик. */}
      <button
        onClick={onCreate}
        disabled={busy}
        style={{
          ...optStyle(false),
          color: T.cherry,
          opacity: busy ? 0.6 : 1,
          cursor: busy ? "default" : "pointer",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Plus size={18} color={T.cherry} />
          Новый отчёт
        </span>
      </button>

      {loading && <div style={sheetHintStyle}>Загружаем отчёты…</div>}
      {!loading && error && (
        <div style={{ ...sheetHintStyle, color: T.errorFg }}>{error}</div>
      )}
      {!loading && !error && reports.length === 0 && (
        <div style={sheetHintStyle}>
          Нет отчётов, куда можно добавить. Создайте новый — отчёты «На
          проверке» и «Одобрен» изменять нельзя
        </div>
      )}
      {/* Страховка на случай разъехавшегося состояния (чек приложили в другой
          вкладке, а список тут старый): отчёт, где чек УЖЕ лежит, помечаем
          «здесь» и выбрать не даём — иначе тап вернул бы 409 «Чек уже в другом
          отчёте». Данных хватает своих: receiptIds приходят в каждом отчёте,
          доп. запрос не нужен. */}
      {!loading &&
        !error &&
        reports.map((rep) => {
          const here = (rep.receiptIds || []).includes(receiptId);
          return (
            <button
              key={rep.id}
              onClick={() => !here && onPick(rep)}
              disabled={busy || here}
              aria-disabled={here}
              style={{
                ...optStyle(false),
                opacity: busy || here ? 0.6 : 1,
                cursor: busy || here ? "default" : "pointer",
              }}
            >
              <span
                style={{ display: "flex", flexDirection: "column", gap: 3 }}
              >
                <span>{rep.title}</span>
                <span style={{ font: `400 12px/1 ${FONT}`, color: T.fg3 }}>
                  {rep.status} · {(rep.receiptIds || []).length} чек(ов)
                </span>
              </span>
              {here && (
                <span
                  style={{
                    font: `500 12px/1 ${FONT}`,
                    color: T.successFg,
                    whiteSpace: "nowrap",
                  }}
                >
                  здесь
                </span>
              )}
            </button>
          );
        })}
    </Sheet>
  );
}

const sheetHintStyle = {
  padding: "18px 12px",
  fontFamily: FONT,
  fontSize: 13,
  color: T.fg3,
  textAlign: "center",
  lineHeight: 1.4,
};

// ⚠️ ОДНО ПОДТВЕРЖДЕНИЕ НА ВСЕ МЕСТА, ГДЕ УДАЛЯЮТ ЧЕК (05.09.2026). Экспорт
// появился потому, что свайп в списке удалял БЕЗ спроса: жест, который легко
// сделать случайно, был необратимым действием. Второе такое же окно рядом со
// временем разошлось бы с этим — «готовое прежде своего».
export function ConfirmDeleteSheet({ onConfirm, onClose, чек }) {
  // ⚠️ ПРО ОТЧЁТ ГОВОРИМ ДО ЖЕСТА, А НЕ ОТКАЗОМ ПОСЛЕ. Бэкенд с c0f2963
  // отвечает 409 «чек входит в отчёт», но человек к этому моменту уже нажал
  // «Удалить» и ждёт результата. Признак `in_report` приходит в списке чеков —
  // значит предупредить можно заранее, ничего не спрашивая у сервера.
  const вОтчёте = !!(чек && чек.in_report);
  const названиеОтчёта = (чек && чек.report_title) || "";
  return (
    <Sheet title={вОтчёте ? "Чек в отчёте" : "Удалить чек?"} onClose={onClose}>
      <p
        style={{
          font: `400 14px/1.45 ${FONT}`,
          color: T.fg2,
          margin: "0 2px 16px",
        }}
      >
        {вОтчёте
          ? `Чек входит в отчёт${
              названиеОтчёта ? ` «${названиеОтчёта}»` : ""
            } — удалить его не получится. Сначала уберите чек из отчёта.`
          : "Чек будет удалён без возможности восстановления."}
      </p>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={onClose}
          style={{
            flex: 1,
            height: 48,
            borderRadius: 8,
            border: `1px solid ${T.borderStrong}`,
            background: T.white,
            font: `500 15px/1 ${FONT}`,
            color: T.fg1,
            cursor: "pointer",
          }}
        >
          {вОтчёте ? "Понятно" : "Отмена"}
        </button>
        {/* ⚠️ КНОПКИ «УДАЛИТЬ» У ЧЕКА В ОТЧЁТЕ НЕТ ВОВСЕ. Оставить её значило бы
            звать человека на действие, которое сервер заведомо отклонит: мёртвая
            кнопка хуже отсутствующей — она обещает работу и отдаёт отказ. */}
        {!вОтчёте && (
          <button
            onClick={onConfirm}
            style={{
              flex: 1,
              height: 48,
              borderRadius: 8,
              border: "none",
              background: T.errorFg,
              font: `600 15px/1 ${FONT}`,
              color: "#fff",
              cursor: "pointer",
            }}
          >
            Удалить
          </button>
        )}
      </div>
    </Sheet>
  );
}

// ── карточка чека (вложенный экран, Тип 3) ─────────────────────────────────
export default function ReceiptDetailModal({
  receipt,
  onClose,
  onDelete,
  onChangeCategory,
  onChangePayment,
  // Связь чека с отчётом изменилась (приложили ИЛИ убрали в деталях
  // отчёта) → родитель перечитывает чек и строку списка: in_report,
  // report_id и report_title считает бэк, локально их не выводим.
  // ⚠️ ОБЪЯВЛЕН ЯВНО (класс T130): необъявленный проп выбрасывается молча.
  onRefetchFns,
  onReportLinkChanged,
  role, // ЧП5б: прокидывается дальше в детали отчёта
  // ⚠️ ОБЪЯВЛЕН ЯВНО (класс T130): необъявленный проп выбрасывается молча.
  люди = [], // список людей организации — для подписи автора по user_id
  catalog,
  paymentOptions = [],
}) {
  const r = receipt;
  const [дозапрос, setДозапрос] = useState(null);
  const raw = r.raw_data || {};
  const isFns = r.source === "fns" || r.source === "qr_scan";
  // raw_data-суммы (ФНС) — в копейках; колонки (amount, vat_*) — уже в рублях.
  const fromKop = (v) => (v == null || v === "" ? null : Number(v) / 100);

  // ── шапка: основа из колонок (работает для fns/qr/photo_ocr/manual) ──
  const mname = r.org_brand || shortOrg(r.org_legal || r.org) || "Чек";
  // Юрлицо — через shortOrg: до 06.08.2026 здесь стояло СЫРОЕ org_legal, и
  // строка выглядела как «ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТС…». shortOrg в этом
  // блоке была, но только в ЗАПАСНОЙ ветке заголовка — а org_brand заполнен
  // у всех чеков прода, так что ветка не срабатывала никогда.
  // Сравнение с заголовком — уже по сокращённому виду: без бренда заголовок
  // сам становится сокращённым юрлицом, и строка иначе задвоилась бы.
  const legalShort = r.org_legal ? shortOrg(r.org_legal) : "";
  const seller = legalShort && legalShort !== mname ? legalShort : "";
  const inn = r.org_inn || "";
  const taxLabel = r.tax_system ? TAX_LABELS_RECEIPT[r.tax_system] || "" : "";
  const innLine = inn
    ? `ИНН ${inn}${taxLabel ? ` · ${taxLabel}` : ""}`
    : taxLabel;
  const address = r.address || "";
  const totalSum = Number(r.amount) || fromKop(raw.totalSum) || 0;
  const when = r.datetime
    ? fmtDateTime(r.datetime)
    : r.date
      ? fmtDate(r.date)
      : "";
  const fnsVerified = isFns;

  // ── признак расчёта: тег только когда ≠ «Приход» (D4) ──
  const OP_LABELS = {
    purchase: "Приход",
    refund: "Возврат прихода",
    expense: "Расход",
    expense_refund: "Возврат расхода",
  };
  const opLabel =
    r.operation_type && r.operation_type !== "purchase"
      ? OP_LABELS[r.operation_type] || ""
      : "";
  const opTag = /возврат/i.test(opLabel)
    ? { bg: "#FEF2F2", fg: "#B91C1C" } // возврат → красный
    : { bg: "#FFFBEB", fg: "#B45309" }; // расход → янтарный

  // ── НДС-итоги из vat_breakdown (JSONB {ставка: сумма}); ВСЕ ненулевые ставки
  // отдельными строками, порядок по убыванию. NULL breakdown → [] → блок не рисуем.
  // Колонок vat_20/vat_10 в БД больше нет (NDS-CLEANUP ③, 10.08.2026): до этого
  // входящий НДС в src/lib/tax.js считался как vat_20+vat_10 и не видел ставку 22
  // — занижение 70,5% по замеру прода. Утверждение о СОСЕДНЕМ файле, написанное
  // здесь, полтора месяца выглядело фактом; поэтому и теперь тут сказано только
  // про этот файл — что читается ЗДЕСЬ, а не «во фронте вообще». ──
  // ⚠️ БЕЛОГО СПИСКА СТАВОК ЗДЕСЬ БОЛЬШЕ НЕТ, И ЭТО ГЛАВНОЕ В ПРАВКЕ.
  // Было: VAT_ORDER = ["22","20","10","7","5","0"] и .filter по нему — ключ,
  // которого в списке нет, отбрасывался МОЛЧА. После №28 ② бэкенд начал
  // выдавать расчётные ставки ("20/120", "10/110", "5/105", "7/107",
  // "22/122") — ни одна не прошла бы. Тот же дефект, что NDS-VAT22, где
  // список из двух ставок не знал про 22 и занизил входящий НДС на 70,5%;
  // предупреждение об этом написано четырьмя строками выше самого списка,
  // и список всё равно остался.
  //
  // ⚠️ СТАЛО: ПОРЯДОК — это порядок, а НЕ РАЗРЕШЕНИЕ. Знакомые ставки идут
  // в заданной последовательности, всё остальное — следом, как есть.
  // Ставка, которой мы не предвидели, попадёт на экран сырым ключом:
  // некрасиво, но ВИДНО. Молчаливое отбрасывание не остаётся нигде.
  const ПОРЯДОК_СТАВОК = [
    "22",
    "22/122",
    "20",
    "20/120",
    "10",
    "10/110",
    "7",
    "7/107",
    "5",
    "5/105",
  ];
  // Расчётная ставка пишется без процента: «НДС 20/120», не «НДС 20/120%».
  const подписьСтавки = (k) => (/^\d+$/.test(k) ? `НДС ${k}%` : `НДС ${k}`);
  const bd = r.vat_breakdown || {};
  const ключиСтавок = Object.keys(bd);
  const vatRows = [
    ...ПОРЯДОК_СТАВОК.filter((k) => ключиСтавок.includes(k)),
    ...ключиСтавок.filter((k) => !ПОРЯДОК_СТАВОК.includes(k)).sort(),
  ]
    .filter((k) => Number(bd[k]) > 0)
    .map((k) => [подписьСтавки(k), Number(bd[k])]);
  // ── разбивка оплаты — ТОЛЬКО при смешанной (и наличные, и безнал > 0);
  // при одном способе равна Итого → дублирует, не рисуем. raw_data, ÷100 при isFns. ──
  const cashSum = isFns ? fromKop(raw.cashTotalSum) : null;
  const cardSum = isFns ? fromKop(raw.ecashTotalSum) : null;
  const payRows =
    cashSum > 0 && cardSum > 0
      ? [
          ["Наличными", cashSum],
          ["Картой", cardSum],
        ]
      : [];
  const totalRows = [...vatRows, ...payRows];
  // ── ОБОРОТЫ БЕЗ НАЛОГА — ОТДЕЛЬНЫЙ БЛОК, НЕ СТРОКИ НДС (№30) ──
  //
  // Раньше здесь стояла пометка «Без НДС» БЕЗ СУММЫ — заменитель данных,
  // которых не было: колонка vat_0 наполнялась двумя разными тегами ФФД
  // через тернарник и на чеке целиком по ставке 0% давала ноль. Замер
  // 28.08.2026, чек id=61: 2670 ₽ не показывались нигде, и пометка тоже
  // не вставала — код 5 в позициях её гасил.
  //
  // ⚠️ ПОЧЕМУ ОТДЕЛЬНЫМ БЛОКОМ, А НЕ СТРОКОЙ В «НДС-ИТОГАХ». Там суммы
  // НАЛОГА. Оборот — другая величина: положить 2670 ₽ туда, где читатель
  // ждёт налог, значит получить вторую ошибку вместо первой.
  //
  // ⚠️ НУЛЕВАЯ СТРОКА ПОКАЗЫВАЕТСЯ НАМЕРЕННО. «Без НДС 0,00» и отсутствие
  // строки — разные утверждения: первое значит «проверено, таких позиций
  // нет», второе — «не знаем». На id=61 позиции с кодом 6 в чеке ЕСТЬ,
  // просто с нулевой ценой (замер владельца) — без явной строки они
  // исчезали бесследно.
  //
  // 1104 sum_vat_0  — оборот по ставке 0%: операция ОБЛАГАЕТСЯ
  // 1105 sum_no_vat — оборот без НДС: освобождение либо не плательщик
  const обороты = [
    ["Оборот по ставке 0%", r.sum_vat_0],
    ["Оборот без НДС", r.sum_no_vat],
  ].filter(([, v]) => v !== null && v !== undefined);

  // ── ТРИ ЯВНЫХ СОСТОЯНИЯ НДС — приёмка владельца 13.08.2026, пункт ⑤ ──
  //
  // ① НДС есть        → разбивка по ставкам (vatRows выше)
  // ② НДС нет по закону → сказать это СЛОВОМ
  // ③ данных нет      → «Нет данных о НДС», а НЕ «без НДС» и НЕ пустота
  //
  // ⚠️ ПУСТОТА — САМАЯ ОПАСНАЯ ИЗ ТРЁХ ОШИБОК, потому что не выглядит
  // ошибкой: бухгалтер читает её как «налога нет». До этой правки чек
  // Максидома (свод от ФНС ЕСТЬ, 1277.62 ₽) рисовал ровно пустоту.
  //
  // ⚠️ ПОЧЕМУ ② МОЛЧИТ, КОГДА ЕСТЬ ОБОРОТЫ. Строка «Без НДС» рядом со
  // строкой «Оборот по ставке 0% — 2 670,00» противоречила бы ей: чек
  // id=61 не «без НДС», он ОБЛАГАЕТСЯ по нулевой ставке. Когда обороты
  // показаны, причина отсутствия налога уже названа точнее, чем одним
  // словом, и повторять её общим ярлыком значит спорить с самим собой.
  // ⚠️ ПЕРВАЯ РЕДАКЦИЯ ЭТОГО МЕСТА БЫЛА НЕВЕРНОЙ, И ОШИБКА БЫЛА ОПАСНОЙ.
  // Она гласила «есть ставки в позициях → Без НДС» — то есть чек Максидома
  // (позиции несут код 11 = 22%, свода нет) объявлялся чеком БЕЗ НДС.
  // Ровно та ложь, ради устранения которой заведена вся строка №28.
  // Поймано прогоном логики на семи реальных формах чека, случай 3 из 7;
  // и случай этот НЕ выдуманный — по замеру 28.08 таких чеков в базе три.
  //
  // Различать надо не «есть ставка / нет ставки», а ТРИ РАЗНЫХ НЕЗНАНИЯ:
  //   налог ЕСТЬ, сумма неизвестна  → сказать про сумму, не про налог
  //   налога НЕТ, и это известно     → «Без НДС»
  //   не известно НИЧЕГО             → «Нет данных о НДС»
  const ставкиПозиций = (Array.isArray(raw.items) ? raw.items : [])
    .map((it) => vatRateLabel(it && it.nds))
    .filter(Boolean);
  // «НДС 0%» сюда НЕ входит: там налог существует и равен нулю, то есть
  // сумма известна, а не потеряна. Смешать — снова спутать код 5 и код 6.
  const ставкиСНалогом = ставкиПозиций.filter(
    (v) => v !== "Без НДС" && v !== "НДС 0%",
  );
  const состояниеНДС =
    vatRows.length > 0 || обороты.length > 0
      ? null // ① и ② — уже сказано числами выше
      : ставкиСНалогом.length > 0
        ? "Сумма не указана" // налог ЕСТЬ, величины нет — молчать нельзя
        : ставкиПозиций.length > 0
          ? "Без НДС" // ② налога нет, и позиции это подтверждают
          : "Нет данных о НДС"; // ③ честно: не знаем ничего

  // ── позиции: только из raw_data (receipt_items фронту не отдаётся, D1);
  // единицы — по источнику: ФНС → копейки (÷100), OCR → уже рубли (D2). ──
  const items = Array.isArray(raw.items) ? raw.items : [];
  const itemSum = (it) =>
    isFns ? Number(it.sum || 0) / 100 : Number(it.sum || 0);

  // ── фискалка: из колонок; Смена·Чек — из raw_data (есть только у fns/qr) ──
  const shiftCheck = [raw.shiftNumber, raw.requestNumber]
    .filter((x) => x !== undefined && x !== null && x !== "")
    .join(" · ");
  const fiscalRows = [
    ["Рег. номер ККТ", r.kkt_rn, true],
    ["ФН №", r.kkt_fn, true],
    ["ФД №", r.fd_num, true],
    ["ФПД", r.fpd, true],
    ["ЗН ККТ", r.kkt_serial, true],
    ["Смена № · Чек №", shiftCheck, true],
    ["Кассир", r.cashier, false], // sans, не моно
  ].filter((x) => x[1]);

  // ⚠️ АВТОР ЧЕКА — ОТДЕЛЬНО ОТ ФИСКАЛЬНЫХ РЕКВИЗИТОВ, и это не украшение.
  // Реквизиты — то, что напечатала касса; автор — то, кто чек снял, и это
  // наша запись. Показывается ВСЕГДА (в отличие от списка, где подпись
  // видна только ролям, читающим чужие чеки): карточку чужого чека
  // сотрудник открыть не может — бэкенд отдаёт ему 404.
  //
  // Неизвестный автор называется «Автор не указан», а не подменяется именем
  // владельца: подстановка выдавала бы чужой чек за его (замер 04.09.2026 —
  // колонка `employee` пуста во всех 88 чеках прода, и фронт подставлял туда
  // жёстко вписанное имя).
  // ⚠️ ПОДПИСЬ — ТОЛЬКО ТЕМ, КТО ВИДИТ ЧУЖИЕ ЧЕКИ (решение владельца
  // 08.09.2026, ВЕЧЕР). Условие то же, что в списке чеков (App.jsx) и
  // в списке отчётов (OtchetyPage.jsx): `canApprove(role)`.
  //
  // ⚠️ ЭТО ОТМЕНА РЕШЕНИЯ ТОГО ЖЕ ДНЯ, УТРОМ, И ОТМЕНА ЗАПИСАНА, А НЕ
  // ПОДМЕНЕНА МОЛЧА. Утром стояло «автор виден ВСЕМ», довод: сотрудник
  // чужую карточку открыть не может — бэкенд отдаёт ему 404, — значит
  // вреда нет. Вечером владелец перевернул довод: значит и ПОЛЬЗЫ нет —
  // подпись у сотрудника ВСЕГДА одна и та же и не различает ничего, то
  // есть это шум на каждом чеке.
  //
  // ⚠️ ЗАМЕР, ИЗ КОТОРОГО ВЫРОСЛА ПРАВКА: карточка была ЕДИНСТВЕННЫМ из
  // трёх мест без проверки роли. Список чеков (App.jsx:3541) и список
  // отчётов (OtchetyPage.jsx:862) спрашивали `canApprove` с 04.09, здесь
  // условия не было вовсе. Три места — теперь одно условие.
  const подписьАвтора = canApprove(role) ? имяАвтора(r.user_id, люди) : "";

  // Категория и оплата сохраняются мгновенно: тап в шторке → сразу PATCH через
  // onChangeCategory/onChangePayment (как в дореформенной модалке). Локального
  // накопления правок и кнопки «Сохранить» нет.
  const [showCat, setShowCat] = useState(false);
  const [showPay, setShowPay] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showTip, setShowTip] = useState(false);
  const [fiscalOpen, setFiscalOpen] = useState(false);
  // «Прикрепить к отчёту»: шторка выбора + состояние запроса.
  const [showAttach, setShowAttach] = useState(false);
  const [reportsList, setReportsList] = useState([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [attachError, setAttachError] = useState("");
  // Отказ подготовки снимка — на месте, а не системным окном (Р-ОТКАЗЫ).
  const [shareError, setShareError] = useState("");
  const [attachBusy, setAttachBusy] = useState(false);
  // Переход «В отчёте „…“» → детали отчёта поверх карточки. Глубина ровно
  // одна: из деталей отчёта чек НЕ открывается, поэтому цикла чек → отчёт →
  // чек не возникает и стопка модалок не растёт.
  // Держим {id,title} КОПИЕЙ, а не читаем r.report_id при рендере: если в
  // деталях убрать этот самый чек, родитель перечитает его, report_id станет
  // пустым — и открытый экран отчёта схлопнулся бы под пальцем.
  const [openReport, setOpenReport] = useState(null);
  // Карточку могут закрыть, пока запрос в полёте — после размонтирования
  // setState запрещён. Ref сбрасывается в cleanup ниже.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // PNG-шеринг карточки (контейнер контента, без шапки и футера).
  const contentRef = useRef(null);
  const [sharing, setSharing] = useState(false);
  async function handleShare() {
    setShareError("");
    const node = contentRef.current;
    if (!node || sharing) return;
    setSharing(true);
    try {
      const scale = Math.min(window.devicePixelRatio || 1, 2);
      const snap = await snapdom(node, {
        scale,
        backgroundColor: "#F6F7F9",
        embedFonts: true,
      });
      const canvas = await snap.toCanvas();
      const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
      // ДАТА В ИМЕНИ ФАЙЛА — ТА ЖЕ, ЧТО НА ЭКРАНЕ, И БЕЗ ПЕРЕВОДА ЗОН.
      // Было `new Date(raw.dateTime * 1000)`, а dateTime приходит СТРОКОЙ
      // ISO ("2026-08-11T21:34:00"): умножение строки на 1000 даёт NaN,
      // и файл сохранялся с именем вида receipt-7085-NaN-NaN-NaN.png.
      // Ошибка молчала, потому что имя файла никто не проверяет тестами.
      // Берём поле datetime (его же показывает карточка) и читаем UTC-части
      // по той же причине, что и в fmtDateTime: время чека — стенное.
      const pad = (n) => String(n).padStart(2, "0");
      const src = r.datetime || raw.dateTime || r.date || null;
      const d = src ? new Date(src) : null;
      const valid = d && !isNaN(d.getTime());
      const datePart = valid
        ? `${pad(d.getUTCDate())}-${pad(
            d.getUTCMonth() + 1,
          )}-${d.getUTCFullYear()}`
        : (() => {
            const now = new Date();
            return `${pad(now.getDate())}-${pad(
              now.getMonth() + 1,
            )}-${now.getFullYear()}`;
          })();
      const amountPart = String(Math.round(totalSum || 0)).replace(
        /[^0-9]/g,
        "",
      );
      const filename = `receipt-${amountPart}-${datePart}.png`;
      const file = new File([blob], filename, { type: "image/png" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file] });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      if (!(e && e.name === "AbortError")) {
        console.error("receipt share failed", e);
        // ⚠️ БЫЛО СИСТЕМНОЕ ОКНО (Р-ОТКАЗЫ, T116): чужой интерфейс поверх
        // нашего, да ещё и блокирующий. Тост говорит то же самое, но не
        // перехватывает управление и гаснет сам.
        setShareError("Не удалось подготовить изображение чека");
      }
    } finally {
      setSharing(false);
    }
  }

  // Текст ошибки берём из тела ответа: бэк отдаёт готовые русские фразы
  // («Чек уже в другом отчёте», «Отчёт на проверке — сначала отзовите его»).
  async function apiError(res) {
    try {
      const body = await res.json();
      if (typeof body?.detail === "string" && body.detail.trim())
        return body.detail;
    } catch {
      /* пустое или не-JSON тело */
    }
    if (res && res.status === 404) return "Отчёт не найден";
    return "Не удалось прикрепить чек, попробуйте ещё раз";
  }

  async function openAttach() {
    setShowAttach(true);
    setAttachError("");
    setReportsLoading(true);
    try {
      const res = await authFetch(`/api/reports/`);
      if (!aliveRef.current) return; // карточку закрыли, пока грузили
      if (!res.ok) {
        setAttachError(await apiError(res));
        setReportsList([]);
        return;
      }
      const data = await res.json();
      if (!aliveRef.current) return;
      setReportsList(
        Array.isArray(data)
          ? data.filter((rep) => ATTACHABLE_STATUSES.includes(rep.status))
          : [],
      );
    } catch {
      if (aliveRef.current) setAttachError("Нет связи с сервером");
    } finally {
      if (aliveRef.current) setReportsLoading(false);
    }
  }

  // Приложить чек к существующему отчёту.
  async function attachTo(rep) {
    if (attachBusy) return; // защита от двойного тапа
    setAttachBusy(true);
    setAttachError("");
    try {
      const res = await authFetch(`/api/reports/${rep.id}/receipts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receiptIds: [r.id] }),
      });
      if (!aliveRef.current) return;
      if (!res.ok) {
        setAttachError(await apiError(res));
        return;
      }
      setShowAttach(false);
      onReportLinkChanged && onReportLinkChanged();
    } catch {
      if (aliveRef.current) setAttachError("Нет связи с сервером");
    } finally {
      if (aliveRef.current) setAttachBusy(false);
    }
  }

  // Создать отчёт и сразу положить в него этот чек — один запрос.
  // Название автоматическое: переименования пока нет, а требовать ввод
  // прямо в шторке — лишний шаг на пути «приложить чек».
  async function createAndAttach() {
    if (attachBusy) return;
    setAttachBusy(true);
    setAttachError("");
    try {
      const res = await authFetch(`/api/reports/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `Отчёт от ${fmtDate(new Date().toISOString())}`,
          receiptIds: [r.id],
        }),
      });
      if (!aliveRef.current) return;
      if (!res.ok) {
        setAttachError(await apiError(res));
        return;
      }
      setShowAttach(false);
      onReportLinkChanged && onReportLinkChanged();
    } catch {
      if (aliveRef.current) setAttachError("Нет связи с сервером");
    } finally {
      if (aliveRef.current) setAttachBusy(false);
    }
  }

  const dialogRef = useModalA11y(onClose);
  const catCol = catColor(catName(r));

  const blockStyle = {
    background: T.white,
    borderRadius: 12,
    boxShadow: "0 1px 3px rgba(17,19,24,.04)",
  };
  const hbtn = {
    display: "flex",
    alignItems: "center",
    gap: 2,
    background: "none",
    border: "none",
    cursor: "pointer",
    color: T.fg1,
    padding: 8,
    borderRadius: 8,
    font: `400 16px/1 ${FONT}`,
  };
  const iconBtn = {
    ...hbtn,
    width: 40,
    height: 40,
    justifyContent: "center",
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(22,26,29,0.5)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        zIndex: 150,
      }}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Детали чека"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "relative",
          background: theme.bg,
          width: "100%",
          maxWidth: 480,
          maxHeight: "calc(100dvh - env(safe-area-inset-top) - 8px)",
          display: "flex",
          flexDirection: "column",
          borderRadius: "16px 16px 0 0",
          overflow: "hidden",
          outline: "none",
        }}
      >
        {/* ── header (Тип 3) ── */}
        <header
          style={{
            background: T.white,
            borderBottom: `1px solid ${T.border}`,
            flexShrink: 0,
            position: "relative",
            // Слой из диапазона «внутри страницы» (1-39): шапка модалки —
            // липкая шапка своего контейнера, а не плавающая кнопка. На 40 она
            // стояла по недосмотру, а 40 в таблице слоёв отдано ровно одной
            // роли — плавающим кнопкам действия. Их больше нет (полоса стоит
            // в потоке), но правило «одно число — одна роль» держим: иначе
            // следующий, кто увидит 40 здесь, решит, что так и надо.
            zIndex: 20,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              minHeight: 52,
              padding: "6px 8px",
            }}
          >
            <button
              type="button"
              onClick={onClose}
              aria-label="Назад"
              style={{ ...hbtn, marginLeft: -2 }}
            >
              <ChevronLeft size={22} />
              Назад
            </button>
            <div
              style={{
                flex: 1,
                textAlign: "center",
                font: `600 17px/1 ${FONT}`,
                color: T.fg1,
              }}
            >
              Чек
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
              <button
                type="button"
                onClick={handleShare}
                disabled={sharing}
                aria-label="Поделиться"
                style={{ ...iconBtn, color: sharing ? T.fg3 : T.fg1 }}
              >
                <Share2 size={21} />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen((v) => !v);
                }}
                aria-label="Ещё"
                style={iconBtn}
              >
                <MoreHorizontal size={22} />
              </button>
            </div>
          </div>
          {/* ⚠️ ОТКАЗ ПОДГОТОВКИ СНИМКА — НА ЭКРАНЕ, А НЕ СИСТЕМНЫМ ОКНОМ
              (Р-ОТКАЗЫ, T116). Гаснет при следующей попытке: держать
              старую ошибку рядом с новой кнопкой — врать про состояние. */}
          {shareError && (
            <div
              style={{
                margin: "8px 0 0",
                padding: "8px 10px",
                borderRadius: 8,
                background: "#FEF2F2",
                border: "1px solid #FECACA",
                font: `400 12px/1.4 ${FONT}`,
                color: "#B91C1C",
              }}
            >
              {shareError}
            </div>
          )}
          {menuOpen && (
            <>
              <div
                onClick={() => setMenuOpen(false)}
                style={{ position: "fixed", inset: 0, zIndex: 49 }}
              />
              <div
                style={{
                  position: "absolute",
                  top: 54,
                  right: 10,
                  background: T.white,
                  borderRadius: 12,
                  boxShadow: "0 8px 30px rgba(17,19,24,.18)",
                  border: `1px solid ${T.border}`,
                  minWidth: 200,
                  padding: 6,
                  zIndex: 50,
                  overflow: "hidden",
                }}
              >
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    setConfirmDel(true);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    width: "100%",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    padding: "11px 12px",
                    borderRadius: 8,
                    font: `400 15px/1 ${FONT}`,
                    color: T.errorFg,
                    textAlign: "left",
                  }}
                >
                  <Trash2 size={18} />
                  Удалить чек
                </button>
              </div>
            </>
          )}
        </header>

        {/* ── scroll body ── */}
        <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
          <div
            ref={contentRef}
            style={{
              padding: "16px 16px 20px",
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            {/* 1 · hero */}
            <section style={{ ...blockStyle, padding: 16 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  gap: 16,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 5,
                    minWidth: 0,
                    flex: 1,
                    textAlign: "left",
                  }}
                >
                  {/* ⚠️ ЗАГОЛОВОК — ДВЕ СТРОКИ, А НЕ МНОГОТОЧИЕ (UX-26).
                      Правило взято из КРАЕВОГО макета
                      `compare/Длинное название - деталь чека.html`, где оно
                      записано для длинных названий; основной макет даёт одну
                      строку, и код следовал ему. Замер владельца 06.09.2026:
                      «ООО «Виза менеджмент сер…»» — название нельзя дочитать,
                      а это первое, чем человек узнаёт чек.
                      ⚠️ `overflow-wrap: anywhere` — из того же макета, дословно
                      («let the long compound word fill line 1 instead of
                      orphaning «ООО»»): без него длинное слово переносится
                      целиком и первая строка остаётся почти пустой.
                      ⚠️ ПОДПИСЬ НИЖЕ ОСТАЁТСЯ ОДНОСТРОЧНОЙ — решение владельца
                      07.09.2026: заголовок человек ищет глазами первым, там
                      обрезка мешает узнать чек; юрлицо — уточнение, его
                      обрезка терпима. В краевом макете `.legal` тоже nowrap.
                      Стережёт `npm run geroy`, шаг ⑦. */}
                  <div
                    style={{
                      font: `600 18px/1.25 ${FONT}`,
                      color: T.fg1,
                      display: "-webkit-box",
                      WebkitBoxOrient: "vertical",
                      WebkitLineClamp: 2,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      overflowWrap: "anywhere",
                      hyphens: "auto",
                    }}
                  >
                    {mname}
                  </div>
                  {seller && (
                    <div
                      style={{
                        font: `400 13px/1.4 ${FONT}`,
                        color: T.fg2,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {seller}
                    </div>
                  )}
                  {innLine && (
                    <div
                      style={{
                        font: `400 13px/1.4 ${FONT}`,
                        color: T.fg2,
                        fontVariantNumeric: "tabular-nums",
                        // Одна строка с многоточием — как в макете (.hero-top
                        // .legal: white-space nowrap). Без этого «ИНН … · УСН
                        // «Доходы−Расходы»» переносилось на второй ряд, и герой
                        // рос, хотя соседние строки блока уже были в одну.
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        maxWidth: "100%",
                      }}
                    >
                      {innLine}
                    </div>
                  )}
                  {address && (
                    <div
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                        font: `400 13px/1.4 ${FONT}`,
                        color: T.fg2,
                        minWidth: 0,
                      }}
                    >
                      <MapPin
                        size={13}
                        color={T.fg3}
                        style={{ flexShrink: 0, transform: "translateY(.5px)" }}
                      />
                      <span
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {address}
                      </span>
                    </div>
                  )}
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-end",
                    gap: 6,
                    flexShrink: 0,
                  }}
                >
                  <div
                    style={{
                      font: `700 26px/1.05 ${FONT}`,
                      color: T.fg1,
                      fontVariantNumeric: "tabular-nums",
                      letterSpacing: "-.02em",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {money(totalSum)}
                  </div>
                  {opLabel && (
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        background: opTag.bg,
                        color: opTag.fg,
                        borderRadius: 999,
                        padding: "3px 8px",
                        font: `600 12px/1 ${FONT}`,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {opLabel}
                    </span>
                  )}
                  {fnsVerified && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowTip((v) => !v);
                      }}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        border: "none",
                        cursor: "pointer",
                        background: T.successBg,
                        color: T.successFg,
                        borderRadius: 999,
                        padding: "3px 8px",
                        font: `500 13px/1 ${FONT}`,
                        position: "relative",
                      }}
                    >
                      <BadgeCheck
                        size={14}
                        style={{ transform: "translateY(.5px)" }}
                      />
                      <span>ФНС</span>
                      {showTip && (
                        <span
                          style={{
                            position: "absolute",
                            top: "calc(100% + 6px)",
                            right: 0,
                            whiteSpace: "nowrap",
                            background: T.fg1,
                            color: "#fff",
                            font: `400 12px/1 ${FONT}`,
                            padding: "7px 10px",
                            borderRadius: 8,
                            boxShadow: "0 4px 14px rgba(17,19,24,.18)",
                            zIndex: 6,
                          }}
                        >
                          Проверен в ФНС
                        </span>
                      )}
                    </button>
                  )}
                  <div
                    style={{
                      font: `400 13px/1.3 ${FONT}`,
                      color: T.fg2,
                      fontVariantNumeric: "tabular-nums",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {when}
                  </div>
                  {/* ⚠️ АВТОР — В ШАПКЕ, ПОД ДАТОЙ (решение владельца
                      08.09.2026). Раньше он стоял отдельной строкой между
                      «Итого» и фискальным блоком: оторван от того, к чему
                      относится, и на длинном чеке не виден без прокрутки.
                      ⚠️ ИМЕННО СПРАВА, А НЕ ПЯТОЙ СТРОКОЙ СЛЕВА: справа
                      блок «про наш чек» — сумма, ФНС, дата, — а слева «про
                      продавца» (бренд, юрлицо, ИНН, адрес). Автор — НАША
                      запись, а не то, что напечатала касса. Замер 08.09 при
                      320: слева 289×92 (четыре строки), справа 111×50 (три);
                      четвёртая строка справа уменьшает разрыв колонок
                      42 → 24px, пятая слева увеличила бы его до 60.
                      ⚠️ ДЛИННОЕ ИМЯ — МНОГОТОЧИЕМ, НЕ ПЕРЕНОСОМ: колонка
                      узкая (111px при подписи «Шукалович А.» 96.9px), перенос
                      разъехал бы разрыв обратно. Это НЕ то же решение, что
                      в заголовке слева (UX-26): там места 289px и расти вниз
                      было куда.
                      ⚠️ ВИДЕН ВСЕМ, И ЭТО РЕШЕНИЕ, А НЕ НЕДОСМОТР (владелец,
                      08.09.2026). В списке и в отчётах подпись показывается
                      только ролям, видящим чужие чеки (`canApprove`), здесь
                      условия нет: сотрудник чужую карточку открыть НЕ МОЖЕТ —
                      бэкенд отдаёт ему 404, — значит в своей он видит себя. */}
                  {подписьАвтора ? (
                    <div
                      style={{
                        maxWidth: "100%",
                        font: `400 13px/1.3 ${FONT}`,
                        color: T.fg2,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {подписьАвтора}
                    </div>
                  ) : null}
                </div>
              </div>
            </section>

            {/* 5 · items (скрыт, если состав недоступен) */}
            {items.length > 0 && (
              <section style={{ ...blockStyle, padding: "14px 16px 6px" }}>
                <div
                  style={{
                    font: `600 13px/1 ${FONT}`,
                    color: T.fg2,
                    marginBottom: 4,
                  }}
                >
                  Позиции
                </div>
                {items.map((it, i) => {
                  const lineSum = itemSum(it);
                  const unitPrice = isFns
                    ? Number(it.price || 0) / 100
                    : Number(it.price || 0);
                  const qNum = Number(it.quantity);
                  const qStr =
                    isFinite(qNum) && qNum
                      ? Number.isInteger(qNum)
                        ? String(qNum)
                        : qNum.toLocaleString("ru-RU")
                      : "";
                  // ненулевая цена → «кол-во × цена»; нулевая (модификаторы) → просто «N шт»
                  const meta =
                    unitPrice > 0
                      ? `${qStr || "1"} × ${money(unitPrice)}`
                      : qtyLabel(it.quantity);
                  // ⚠️ ПРИЁМКА ВЛАДЕЛЬЦА 13.08.2026, ПУНКТ ③, ДОСЛОВНО:
                  // «ставка или "Без НДС" у ВСЕХ строк, независимо от того,
                  // одинаковые они в чеке или разные». До этой правки бейдж
                  // ГАСИЛСЯ на «Без НДС» — прямо против требования, и гасился
                  // у 448 позиций из 595 по замеру прода 28.08.2026, то есть
                  // у трёх четвертей всех строк товаров в базе.
                  //
                  // Довод владельца дословно: чек — ПЕРВИЧНЫЙ ДОКУМЕНТ;
                  // бухгалтер должен видеть по каждой строке, что по ней,
                  // и не гадать, «нет НДС» это или «нам не показали».
                  // Правило, зависящее от состава чека, делает поведение
                  // непредсказуемым, а непредсказуемому не доверяют.
                  //
                  // Пустая подпись значит «кода ставки в чеке НЕ БЫЛО» —
                  // это третье состояние, и оно тоже обязано быть названо.
                  const vat = vatRateLabel(it.nds) || "Нет данных";
                  const showVat = true;
                  return (
                    <div
                      key={i}
                      style={{
                        display: "flex",
                        alignItems: "baseline",
                        justifyContent: "space-between",
                        gap: 14,
                        padding: "11px 0",
                        borderTop: i === 0 ? "none" : `1px solid ${T.border}`,
                      }}
                    >
                      <div
                        style={{
                          minWidth: 0,
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "flex-start",
                          gap: 3,
                        }}
                      >
                        <span
                          style={{
                            font: `400 14px/1.35 ${FONT}`,
                            color: T.fg1,
                            textAlign: "left",
                          }}
                        >
                          {it.name || "—"}
                        </span>
                        {(meta || showVat) && (
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 8,
                              flexWrap: "wrap",
                            }}
                          >
                            {meta && (
                              <span
                                style={{
                                  font: `400 12px/1.2 ${FONT}`,
                                  color: T.fg2,
                                  fontVariantNumeric: "tabular-nums",
                                }}
                              >
                                {meta}
                              </span>
                            )}
                            {showVat && (
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  background: T.chipBg,
                                  color: T.fg2,
                                  borderRadius: 999,
                                  padding: "1px 7px",
                                  font: `500 11px/1.5 ${FONT}`,
                                }}
                              >
                                {vat}
                              </span>
                            )}
                          </span>
                        )}
                      </div>
                      <span
                        style={{
                          font: `500 14px/1.3 ${FONT}`,
                          color: T.fg1,
                          fontVariantNumeric: "tabular-nums",
                          whiteSpace: "nowrap",
                          flexShrink: 0,
                          textAlign: "right",
                        }}
                      >
                        {money(lineSum)}
                      </span>
                    </div>
                  );
                })}
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    padding: "13px 0 4px",
                    borderTop: `1px solid ${T.borderStrong}`,
                    marginTop: 2,
                  }}
                >
                  <span style={{ font: `600 14px/1 ${FONT}`, color: T.fg1 }}>
                    Итого
                  </span>
                  <span
                    style={{
                      font: `700 16px/1 ${FONT}`,
                      color: T.fg1,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {money(totalSum)}
                  </span>
                </div>
                {обороты.map(([k, v]) => (
                  <div
                    key={k}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      padding: "5px 0",
                      font: `400 13px/1.3 ${FONT}`,
                      color: T.fg2,
                    }}
                  >
                    <span>{k}</span>
                    <span
                      style={{
                        color: T.fg1,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {money(v)}
                    </span>
                  </div>
                ))}
                {состояниеНДС && (
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      padding: "5px 0",
                      font: `400 13px/1.3 ${FONT}`,
                      color: T.fg2,
                    }}
                  >
                    <span>НДС</span>
                    <span style={{ color: T.fg1 }}>{состояниеНДС}</span>
                  </div>
                )}
                {totalRows.map(([k, v]) => (
                  <div
                    key={k}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      padding: "5px 0",
                      font: `400 13px/1.3 ${FONT}`,
                      color: T.fg2,
                    }}
                  >
                    <span>{k}</span>
                    <span
                      style={{
                        color: T.fg1,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {money(v)}
                    </span>
                  </div>
                ))}
              </section>
            )}

            {/* 6 · fiscal (сворачиваемый; скрыт, если реквизитов нет) */}
            {fiscalRows.length > 0 && (
              <section style={{ ...blockStyle, overflow: "hidden" }}>
                <button
                  type="button"
                  onClick={() => setFiscalOpen((v) => !v)}
                  aria-expanded={fiscalOpen}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    padding: 16,
                    cursor: "pointer",
                    background: "none",
                    border: "none",
                    width: "100%",
                    font: `600 14px/1 ${FONT}`,
                    color: T.fg1,
                  }}
                >
                  <span>Фискальные реквизиты</span>
                  <ChevronDown
                    size={20}
                    color={T.fg3}
                    style={{
                      transition: "transform 200ms ease",
                      transform: fiscalOpen ? "rotate(180deg)" : "none",
                    }}
                  />
                </button>
                {fiscalOpen && (
                  <div style={{ padding: "0 16px 18px" }}>
                    {fiscalRows.map(([k, v, mono], i) => (
                      <div
                        key={k}
                        style={{
                          display: "flex",
                          alignItems: "baseline",
                          justifyContent: "space-between",
                          gap: 16,
                          padding: "10px 0",
                          borderTop: i === 0 ? "none" : `1px solid ${T.border}`,
                        }}
                      >
                        <span
                          style={{
                            font: `400 13px/1.3 ${FONT}`,
                            color: T.fg2,
                            flexShrink: 0,
                          }}
                        >
                          {k}
                        </span>
                        <span
                          style={{
                            fontFamily: mono
                              ? "'Courier New', Courier, ui-monospace, monospace"
                              : FONT,
                            fontSize: 13,
                            lineHeight: 1.3,
                            color: T.fg1,
                            fontVariantNumeric: "tabular-nums",
                            textAlign: "right",
                            wordBreak: "break-all",
                          }}
                        >
                          {v}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}
          </div>
        </div>

        {/* ── sticky footer: чипы правки + Сохранить (только при изменениях) ── */}
        <div
          style={{
            background: "rgba(255,255,255,.92)",
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
            borderTop: `1px solid ${T.border}`,
            padding: "12px 16px calc(12px + env(safe-area-inset-bottom))",
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={() => catalog && onChangeCategory && setShowCat(true)}
              disabled={!catalog || !onChangeCategory}
              style={{
                flex: 1.5,
                minWidth: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 6,
                background: T.chipBg,
                border: "none",
                borderRadius: 999,
                padding: "11px 12px 11px 14px",
                cursor: catalog && onChangeCategory ? "pointer" : "default",
                font: `500 13px/1.2 ${FONT}`,
                color: T.fg1,
              }}
            >
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  minWidth: 0,
                }}
              >
                <span
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: 999,
                    flexShrink: 0,
                    background: catCol.fg,
                  }}
                />
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {catName(r)}
                </span>
              </span>
              <ChevronDown size={16} color={T.fg2} style={{ flexShrink: 0 }} />
            </button>
            {onChangePayment && (
              <button
                type="button"
                onClick={() => setShowPay(true)}
                style={{
                  flex: 1,
                  minWidth: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 6,
                  background: T.chipBg,
                  border: "none",
                  borderRadius: 999,
                  padding: "11px 12px 11px 14px",
                  cursor: "pointer",
                  font: `500 13px/1.2 ${FONT}`,
                  color: T.fg1,
                }}
              >
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    minWidth: 0,
                  }}
                >
                  <PayGlyph
                    value={r.payment}
                    size={16}
                    color={T.fg2}
                    style={{ flexShrink: 0 }}
                  />
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {payLabel(r.payment)}
                  </span>
                </span>
                <ChevronDown
                  size={16}
                  color={T.fg2}
                  style={{ flexShrink: 0 }}
                />
              </button>
            )}
          </div>
          {/* Чек живёт ровно в одном отчёте (uq_report_items_receipt_id).
              Занят — показываем ГДЕ он и даём туда перейти: иначе пользователь
              в тупике, видит «занят», но не знает, что там за отчёт и можно ли
              чек забрать. Отцепляют его в деталях отчёта, туда и ведём.
              НЕ вишнёвая: вишнёвый в карточке — только главный CTA, а это
              переход по ссылке, второстепенное действие. */}
          {r.in_report ? (
            <button
              type="button"
              onClick={() =>
                setOpenReport({
                  id: r.report_id,
                  title: r.report_title || "Отчёт",
                })
              }
              disabled={!r.report_id}
              style={{
                width: "100%",
                minHeight: 50,
                borderRadius: 8,
                border: `1px solid ${T.borderStrong}`,
                background: T.chipBg,
                color: T.fg1,
                font: `500 15px/1.3 ${FONT}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                padding: "10px 14px",
                textAlign: "center",
                cursor: r.report_id ? "pointer" : "default",
              }}
            >
              <Paperclip size={18} style={{ flexShrink: 0 }} />
              {r.report_title ? `В отчёте «${r.report_title}»` : "В отчёте"}
              {/* Шеврон читается как «здесь есть куда перейти» —
                  тот же приём, что у выбора категории выше. */}
              {r.report_id && (
                <ChevronRight
                  size={16}
                  color={T.fg2}
                  style={{ flexShrink: 0 }}
                />
              )}
            </button>
          ) : (
            <button
              type="button"
              onClick={openAttach}
              style={{
                width: "100%",
                height: 50,
                borderRadius: 8,
                border: `1px solid ${T.borderStrong}`,
                background: T.white,
                color: T.fg1,
                font: `500 15px/1 ${FONT}`,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
              }}
            >
              <Paperclip size={18} />
              Прикрепить к отчёту
            </button>
          )}

          {/* ⚠️ КНОПКА ПОЯВЛЯЕТСЯ ТОЛЬКО У ЧЕКОВ, КОТОРЫЕ ЕСТЬ ЧЕМ ДОЗАПРОСИТЬ
              (T132). Признак `можно_дозапросить` считает БЭКЕНД — одно правило
              в одном месте; две копии условия разошлись бы, и кнопка вылезала
              бы там, где дозапрос невозможен. Старые чеки под условие не
              подпадают сами: у них не сохранены ФД и ФПД. */}
          {r["можно_дозапросить"] && onRefetchFns && (
            <>
              <div style={{ height: 8 }} />
              <button
                type="button"
                disabled={дозапрос === "идёт"}
                onClick={async () => {
                  setДозапрос("идёт");
                  const итог = await onRefetchFns();
                  setДозапрос(
                    итог && итог.ok
                      ? null
                      : (итог && итог.причина) || "Не получилось",
                  );
                }}
                style={{
                  width: "100%",
                  // ⚠️ border-box: без него рамка добавляется К ширине 100%
                  // и кнопка вылезает за карточку — поймано сторожем T14.
                  boxSizing: "border-box",
                  height: 50,
                  borderRadius: 8,
                  border: `1px solid ${T.borderStrong}`,
                  background: T.white,
                  color: T.fg1,
                  font: `500 15px/1 ${FONT}`,
                  cursor: дозапрос === "идёт" ? "default" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                }}
              >
                {дозапрос === "идёт"
                  ? "Спрашиваем ФНС…"
                  : "Запросить данные ФНС ещё раз"}
              </button>
              {/* ⚠️ ОТКАЗ ПОКАЗЫВАЕТСЯ ДОСЛОВНО. Кнопка, после которой ничего
                  видимого не происходит, — это то, на что владелец уже
                  жаловался по «Попробовать снова». */}
              {дозапрос && дозапрос !== "идёт" && (
                <div
                  role="alert"
                  style={{
                    marginTop: 8,
                    padding: "10px 12px",
                    borderRadius: 8,
                    background: "#FFFBEB",
                    border: "1px solid #FDE68A",
                    color: "#B45309",
                    font: `400 12px/1.45 ${FONT}`,
                  }}
                >
                  {дозапрос}
                </div>
              )}
            </>
          )}
        </div>

        {/* ── шторки ── */}
        {showAttach && (
          <ReportPickSheet
            reports={reportsList}
            receiptId={r.id}
            loading={reportsLoading}
            error={attachError}
            busy={attachBusy}
            onPick={attachTo}
            onCreate={createAndAttach}
            onClose={() => setShowAttach(false)}
          />
        )}
        {showPay && (
          <PaymentSheet
            options={paymentOptions}
            selected={r.payment}
            onPick={(opt) => {
              onChangePayment(opt);
              setShowPay(false);
            }}
            onClose={() => setShowPay(false)}
          />
        )}
        {confirmDel && (
          <ConfirmDeleteSheet
            чек={r}
            onConfirm={onDelete}
            onClose={() => setConfirmDel(false)}
          />
        )}
        {showCat && (
          <CategorySheet
            catalog={catalog}
            selected={catName(r)}
            onPick={onChangeCategory}
            onClose={() => setShowCat(false)}
          />
        )}
      </div>

      {/* Детали отчёта поверх карточки чека. В чеке есть только report_id и
          report_title — этого хватает как «скелета», остальное подтянет
          GET /{id}. onStatus не передаём: решение по деньгам принимают
          в разделе «Отчёты», здесь это справка «куда делся мой чек».
          zIndex выше карточки (150) и её шторок (160), но ниже
          общеприложенческих слоёв (200+ — тосты, сканер). */}
      {openReport && (
        <ReportDetailModal
          report={openReport}
          onClose={() => setOpenReport(null)}
          role={role}
          reloadReceipts={onReportLinkChanged}
          zIndex={180}
        />
      )}
    </div>
  );
}
