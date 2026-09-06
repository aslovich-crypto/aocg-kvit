import { useCallback, useEffect, useRef, useState } from "react";
import LoadFailure from "../components/LoadFailure";
import {
  Search,
  X,
  ScanLine,
  FileText,
  Tag,
  CircleX,
  Clock,
  ChevronRight,
  CreditCard,
} from "lucide-react";

import { computeTaxAccounting, regimeFlags } from "../lib/tax";
import { FONT, theme } from "../lib/theme";
import { paymentShort, shortOrg, money, fmtDate } from "../lib/format";

// Экран «Главная» (INT) — дашборд по образцу templates/home/Главная.html.
// Зависимости (данные, навигация, форматтеры) приходят пропсами из App.jsx,
// чтобы не дублировать хелперы и не наращивать монолит.

export default function GlavnayaPage({
  receipts,
  onScan, // плитка — прямое действие: сканер сразу, не список «Чеков»
  onNewReport, // и шторка нового отчёта сразу
  catalog,
  org,
  setPage,
  authFetch,
  plural,
  inPeriod,
  catName,
  catColor,
}) {
  const [reports, setReports] = useState([]);
  // T144: общий поиск с «Главной» — чеки и отчёты разом, решение владельца:
  // «человек не должен помнить, где что лежит». До этого здесь была
  // КНОПКА-ЗАГЛУШКА: выглядела полем, уводила на «Чеки» (класс T149).
  const [запрос, setЗапрос] = useState("");
  const [найдено, setНайдено] = useState(null); // null = не искали
  const [ищем, setИщем] = useState(false);
  const [ошибкаПоиска, setОшибкаПоиска] = useState("");
  const меткаПоиска = useRef(0);
  // ⚠️ Сбросы состояния живут в обработчиках ввода, не в эффекте:
  // setState синхронно в теле эффекта запрещён правилом хуков (каскадные
  // перерисовки). Эффект только ставит таймер запроса.
  function ввестиЗапрос(значение) {
    setЗапрос(значение);
    if (значение.trim().length < 2) {
      меткаПоиска.current++;
      setНайдено(null);
      setОшибкаПоиска("");
      setИщем(false);
    }
  }
  useEffect(() => {
    const с = запрос.trim();
    if (с.length < 2) return;
    // ⚠️ Метка против гонки: ответ на «ром» не должен перетереть ответ
    // на «ромашка», пришедший раньше него.
    const моя = ++меткаПоиска.current;
    const т = setTimeout(() => {
      setИщем(true);
      authFetch(`/api/search?q=${encodeURIComponent(с)}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("отказ"))))
        .then((d) => {
          if (меткаПоиска.current !== моя) return;
          setНайдено(d);
          setОшибкаПоиска("");
        })
        .catch(() => {
          if (меткаПоиска.current !== моя) return;
          setОшибкаПоиска("Не удалось выполнить поиск — проверьте связь");
        })
        .finally(() => {
          if (меткаПоиска.current === моя) setИщем(false);
        });
    }, 300);
    return () => clearTimeout(т);
  }, [запрос, authFetch]);
  const режимПоиска = запрос.trim().length >= 2;
  // ⚠️ «ОТЧЁТОВ НЕТ» И «ОТЧЁТЫ НЕ ЗАГРУЗИЛИСЬ» — РАЗНЫЕ ВЕЩИ (T171). Плитки
  // «Требует внимания» считаются по этому списку: пустой ответ от отказа
  // неотличим, и человек видит спокойный экран там, где на проверке висят
  // его отчёты.
  const [сбойОтчётов, setСбойОтчётов] = useState(false);
  const загрузитьОтчёты = useCallback(
    () =>
      authFetch("/api/reports/")
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("отказ"))))
        .then((d) => {
          setReports(Array.isArray(d) ? d : []);
          setСбойОтчётов(false);
        })
        .catch(() => setСбойОтчётов(true)),
    [authFetch],
  );
  useEffect(() => {
    загрузитьОтчёты();
  }, [загрузитьОтчёты]);

  const monthReceipts = receipts.filter((r) => inPeriod(r.date, "month"));
  const monthTotal = monthReceipts.reduce((s, r) => s + Number(r.amount), 0);

  // «Требует внимания»
  const noCat = receipts.filter((r) => catName(r) === "Без категории");
  const noCatSum = noCat.reduce((s, r) => s + Number(r.amount), 0);
  const rejected = reports.filter((r) => r.status === "Отклонён");
  const pending = reports.filter((r) => r.status === "На проверке");
  const pendingSum = pending.reduce((s, r) => s + Number(r.total || 0), 0);
  const monthName = new Date().toLocaleDateString("ru-RU", { month: "long" });
  const reportMonth = (r) =>
    r && r.created
      ? new Date(r.created).toLocaleDateString("ru-RU", { month: "long" })
      : "—";

  // Налоговый мини-блок (за месяц), только для режимов с учётом расходов
  const { deductible, nonDeductible, taxTotal } = computeTaxAccounting(
    monthReceipts,
    catalog,
  );
  const { reducesExpenses } = regimeFlags(org && org.tax_system);

  const recent = [...receipts]
    .sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : 0))
    .slice(0, 3);

  // ── стили ──
  const card = {
    background: theme.surface,
    border: `0.5px solid ${theme.border}`,
    borderRadius: 12,
    boxShadow: "0 1px 3px rgba(17,19,24,.06)",
  };
  const h2 = {
    font: `600 15px/1.2 ${FONT}`,
    color: "#111318",
    margin: "0 0 10px",
  };
  const tap = { cursor: "pointer" };

  const secTitle = (title, linkLabel, onLink) => (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: 12,
        marginBottom: 10,
      }}
    >
      <span style={h2}>{title}</span>
      {linkLabel && (
        <span
          onClick={onLink}
          style={{
            font: `500 13px/1 ${FONT}`,
            color: theme.cherry,
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          {linkLabel}
        </span>
      )}
    </div>
  );

  const quick = (Icon, label, onClick) => (
    <button
      onClick={onClick}
      style={{
        ...card,
        ...tap,
        padding: 16,
        minHeight: 104,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 12,
        textAlign: "left",
      }}
    >
      <span
        style={{
          width: 38,
          height: 38,
          borderRadius: 10,
          background: theme.cherryTint,
          color: theme.cherry,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon size={22} strokeWidth={2} />
      </span>
      <span style={{ font: `600 15px/1.2 ${FONT}`, color: "#111318" }}>
        {label}
      </span>
    </button>
  );

  const attn = (Icon, color, num, text, capLabel, capValue, onClick) => (
    <button
      onClick={onClick}
      style={{
        ...card,
        ...tap,
        padding: "13px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 7,
        minWidth: 0,
        textAlign: "left",
      }}
    >
      <span
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Icon size={17} color={color} strokeWidth={2} />
        <span
          style={{
            font: `700 26px/1 ${FONT}`,
            color: "#111318",
            fontVariantNumeric: "tabular-nums",
            letterSpacing: "-.015em",
          }}
        >
          {num}
        </span>
      </span>
      <span style={{ font: `500 12.5px/1.25 ${FONT}`, color: theme.fg2 }}>
        {text}
      </span>
      <span
        style={{
          marginTop: "auto",
          paddingTop: 10,
          borderTop: `1px solid ${theme.border}`,
        }}
      >
        <span
          style={{
            display: "block",
            font: `500 11px/1.2 ${FONT}`,
            color: theme.fg3,
            marginBottom: 3,
          }}
        >
          {capLabel}
        </span>
        <span
          style={{
            font: `600 13px/1.2 ${FONT}`,
            color: "#111318",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {capValue}
        </span>
      </span>
    </button>
  );

  const taxRow = (color, name, value, vcolor) => (
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
      <span style={{ flex: 1, font: `400 14px/1.3 ${FONT}`, color: "#111318" }}>
        {name}
      </span>
      <span
        style={{
          font: `600 14px/1.3 ${FONT}`,
          color: vcolor || "#111318",
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
        }}
      >
        {money(value)}
      </span>
    </div>
  );

  return (
    <div
      style={{ padding: "16px 16px calc(env(safe-area-inset-bottom) + 88px)" }}
    >
      {/* T144: НАСТОЯЩЕЕ поле — в каноне «Главной» здесь input, а стояла
          кнопка-заглушка: человек видел поиск, жал, попадал на «Чеки». */}
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          background: theme.surfaceSunk,
          borderRadius: 10,
          padding: "11px 12px",
          marginBottom: 22,
        }}
      >
        <Search size={18} color={theme.fg3} strokeWidth={2} />
        <input
          value={запрос}
          onChange={(e) => ввестиЗапрос(e.target.value)}
          placeholder="Поиск"
          aria-label="Поиск по чекам и отчётам"
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
        {запрос && (
          <button
            type="button"
            onClick={() => ввестиЗапрос("")}
            aria-label="Очистить поиск"
            style={{
              background: "none",
              border: "none",
              padding: 2,
              display: "flex",
              cursor: "pointer",
              color: theme.fg3,
            }}
          >
            <X size={16} />
          </button>
        )}
      </label>

      {режимПоиска && (
        <div>
          {ошибкаПоиска && (
            <div
              role="alert"
              style={{
                background: theme.errorBg,
                color: theme.errorFg,
                border: `1px solid ${theme.errorBd}`,
                borderRadius: 8,
                padding: "10px 12px",
                font: `400 13px/1.4 ${FONT}`,
                marginBottom: 12,
              }}
            >
              {ошибкаПоиска}
            </div>
          )}
          {найдено && найдено.receipts.length > 0 && (
            <div style={{ marginBottom: 22 }}>
              {secTitle(`Чеки · ${найдено.receipts.length}`)}
              <div
                style={{ display: "flex", flexDirection: "column", gap: 10 }}
              >
                {найдено.receipts.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => setPage("operacii")}
                    style={{
                      ...card,
                      ...tap,
                      padding: "12px 16px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      textAlign: "left",
                    }}
                  >
                    <span style={{ minWidth: 0 }}>
                      <span
                        style={{
                          display: "block",
                          font: `500 14px/1.25 ${FONT}`,
                          color: "#111318",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {shortOrg(r.org_brand || r.org)}
                      </span>
                      <span
                        style={{
                          font: `400 12px/1.3 ${FONT}`,
                          color: theme.fg2,
                        }}
                      >
                        {fmtDate(r.date)}
                      </span>
                    </span>
                    <span
                      style={{
                        font: `600 14px/1.2 ${FONT}`,
                        color: "#111318",
                        fontVariantNumeric: "tabular-nums",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {money(Number(r.amount))}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {найдено && найдено.reports.length > 0 && (
            <div style={{ marginBottom: 22 }}>
              {secTitle(`Отчёты · ${найдено.reports.length}`)}
              <div
                style={{ display: "flex", flexDirection: "column", gap: 10 }}
              >
                {найдено.reports.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => setPage("otchety")}
                    style={{
                      ...card,
                      ...tap,
                      padding: "12px 16px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      textAlign: "left",
                    }}
                  >
                    <span style={{ minWidth: 0 }}>
                      <span
                        style={{
                          display: "block",
                          font: `500 14px/1.25 ${FONT}`,
                          color: "#111318",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {r.title}
                      </span>
                      <span
                        style={{
                          font: `400 12px/1.3 ${FONT}`,
                          color: theme.fg2,
                        }}
                      >
                        {r.status}
                        {r.created ? ` · ${fmtDate(r.created)}` : ""}
                      </span>
                    </span>
                    <span
                      style={{
                        font: `600 14px/1.2 ${FONT}`,
                        color: "#111318",
                        fontVariantNumeric: "tabular-nums",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {r.total != null ? money(Number(r.total)) : ""}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {найдено &&
            !ищем &&
            найдено.receipts.length === 0 &&
            найдено.reports.length === 0 &&
            !ошибкаПоиска && (
              <div
                style={{
                  font: `400 13px/1.5 ${FONT}`,
                  color: theme.fg3,
                  padding: "8px 2px",
                }}
              >
                Ничего не нашлось по «{запрос.trim()}» — ни в чеках, ни в
                отчётах
              </div>
            )}
        </div>
      )}

      {!режимПоиска && (
        <div>
          {/* Быстрые действия */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
              marginBottom: 22,
            }}
          >
            {/* Прямые действия (03.09.2026): человек нажал «Сканировать» —
            он хочет сканировать, а не смотреть список. Класс «названо
            действием — делает переход» этой правкой исчерпан: живых 2 → 0. */}
            {quick(ScanLine, "Сканировать чек", onScan)}
            {quick(FileText, "Создать отчёт", onNewReport)}
          </div>

          {/* Требует внимания */}
          <div style={{ marginBottom: 22 }}>
            {secTitle("Требует внимания")}
            {/* ⚠️ Плитки считаются по списку отчётов: не загрузился — говорим
            об этом здесь, где человек делает вывод «всё спокойно». */}
            {сбойОтчётов && (
              <div style={{ marginBottom: 10 }}>
                <LoadFailure что="отчёты" onRetry={загрузитьОтчёты} />
              </div>
            )}
            {/* ТРИ ПЛИТКИ В РЯД НЕ ПОМЕЩАЮТСЯ ПРИ 320. Замер: плитка 88.7px,
            внутри после отступов остаётся 62.7, а «10 780,00 ₽» занимает
            65.9 — сумма торчала на 3px, и это НЕ косметика: она растёт
            с суммой, при шестизначной вылезет на 20+.
            Считать пришлось иначе, чем в карточке: там нехватку можно
            переложить на соседа многоточием, здесь соседей нет — деньги
            многоточием не режут, их либо видно целиком, либо нет.
            auto-fit разворачивает ряд по месту: при 320 плиток в ряду две
            (139px каждая), при 360 и шире — снова три, как в макете. */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(96px, 1fr))",
                gap: 10,
              }}
            >
              {attn(
                Tag,
                "#B45309",
                noCat.length,
                `${plural(noCat.length, [
                  "чек",
                  "чека",
                  "чеков",
                ])} без категории`,
                "Сумма",
                money(noCatSum),
                () => setPage("operacii"),
              )}
              {attn(
                CircleX,
                "#B91C1C",
                rejected.length,
                `${plural(rejected.length, [
                  "отчёт",
                  "отчёта",
                  "отчётов",
                ])} отклонён`,
                "Период",
                rejected.length ? reportMonth(rejected[0]) : "—",
                () => setPage("otchety"),
              )}
              {attn(
                Clock,
                "#B45309",
                pending.length,
                `${plural(pending.length, [
                  "отчёт",
                  "отчёта",
                  "отчётов",
                ])} на проверке`,
                "Сумма",
                money(pendingSum),
                () => setPage("otchety"),
              )}
            </div>
          </div>

          {/* За месяц */}
          <div style={{ marginBottom: 22 }}>
            {secTitle("За месяц")}
            <button
              onClick={() => setPage("svodka")}
              style={{
                ...card,
                ...tap,
                width: "100%",
                padding: 16,
                display: "flex",
                alignItems: "center",
                gap: 14,
                textAlign: "left",
              }}
            >
              <span style={{ flex: 1, minWidth: 0 }}>
                <span
                  style={{
                    display: "block",
                    font: `400 13px/1.3 ${FONT}`,
                    color: theme.fg2,
                    marginBottom: 4,
                  }}
                >
                  Расходы, {monthName}
                </span>
                <span
                  style={{
                    display: "block",
                    font: `700 26px/1.05 ${FONT}`,
                    color: "#111318",
                    fontVariantNumeric: "tabular-nums",
                    letterSpacing: "-.015em",
                  }}
                >
                  {money(monthTotal)}
                </span>
                <span
                  style={{
                    display: "block",
                    font: `400 13px/1.3 ${FONT}`,
                    color: theme.fg2,
                    marginTop: 4,
                  }}
                >
                  {monthReceipts.length}{" "}
                  {plural(monthReceipts.length, [
                    "операция",
                    "операции",
                    "операций",
                  ])}
                </span>
              </span>
              <ChevronRight size={22} color={theme.fg3} strokeWidth={2} />
            </button>
          </div>

          {/* Налоговый учёт — мини, только для режимов с учётом расходов */}
          {org && reducesExpenses && (
            <div style={{ marginBottom: 22 }}>
              {secTitle("Налоговый учёт расходов")}
              <button
                onClick={() => setPage("svodka")}
                style={{
                  ...card,
                  ...tap,
                  width: "100%",
                  padding: 16,
                  textAlign: "left",
                }}
              >
                <span
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
                </span>
                <span
                  style={{
                    marginTop: 14,
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                  }}
                >
                  {taxRow(
                    "#15803D",
                    "Можно учесть в расходах",
                    deductible,
                    "#15803D",
                  )}
                  {taxRow("#9CA3AF", "Нельзя учесть", nonDeductible)}
                </span>
              </button>
            </div>
          )}

          {/* Последние */}
          <div>
            {secTitle("Последние", "Все чеки", () => setPage("operacii"))}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {recent.map((r) => {
                const pill = catColor(catName(r)) || {};
                return (
                  <button
                    key={r.id}
                    onClick={() => setPage("operacii")}
                    style={{
                      ...card,
                      ...tap,
                      padding: "14px 16px",
                      display: "flex",
                      alignItems: "flex-start",
                      justifyContent: "space-between",
                      gap: 12,
                      textAlign: "left",
                      boxShadow: "0 1px 3px rgba(17,19,24,.08)",
                    }}
                  >
                    {/* ПОЛ ЛЕВОЙ КОЛОНКИ — 152px. Число выведено из содержимого,
                    а не подобрано на глаз: дата «02.08.2026» 74px + точка 3
                    + два отступа 12 = 89.4px неприкосновенных (дата не уступает
                    никогда), плюс иконка карты 14 и её отступ 4, плюс ширина
                    цифр, ИЗМЕРЕННАЯ В САМОМ ЭЛЕМЕНТЕ. Считали по «•3950» —
                    41.0px, итого 148.4, округлили вверх до 152.
                    06.08 точку убрали (её не было в макете, это была моя
                    выдумка): «3950» примерно на 7px уже, поэтому пол 152
                    держится с запасом. Перемерить, если поменяется шрифт. Порог тот же по смыслу, что
                    META_FULL_MIN=309 на «Чеках», только считается от колонки.
                    БЫЛО 148, пока подпись была «≥40px, чтобы многоточие ещё
                    что-то значило»: с переходом на «•3950» минимум перестал
                    быть условным, у него появилась точная ширина. Не хватало
                    0.4px — и «•3950» превращалось в «•39…», что бессмысленнее
                    огрызка имени. Цифры равной ширины (tabular-nums), поэтому
                    41.0 верно для ЛЮБЫХ четырёх цифр, а не только для 3950.
                    МЕРИТЬ НАДО В МЕСТЕ: первый замер скрытым span'ом дал 47.2 —
                    проба не унаследовала шрифт и считала по умолчанию 16px.
                    Ошибку поймал скриншот, а не арифметика.
                    ЦЕНА: правой колонке при 320 остаётся 90px при сумме 81.3 —
                    запас 8.7px. Сумма шире (≈6 знаков) в наших данных не
                    встречается; встретится — обе колонки при 320 одновременно
                    не поместятся, и это отдельное решение, а не подгонка пола.
                    ЗАМЕР 03.08 @320, из-за которого пол понадобился: пилюля
                    «Представительские расходы» занимала 193px из 242 доступных
                    и левой колонке оставалось 46.9 — из неё торчали и оплата
                    (+156), и дата (+28). Пол переносит нехватку на пилюлю:
                    она теперь сжимается с многоточием, а не давит соседа.
                    На 430 не меняется НИЧЕГО — там колонке и так достаётся
                    159px, пол не срабатывает. */}
                    <span style={{ flex: 1, minWidth: 152 }}>
                      <span
                        style={{
                          display: "block",
                          font: `500 15px/1.25 ${FONT}`,
                          color: "#111318",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {/* shortOrg: до 06.08.2026 здесь стояло сырое r.org, и
                        строка читалась как «ОБЩЕСТВО С ОГР…». На «Чеках»
                        сокращение было, на «Главной» — нет. */}
                        {shortOrg(r.org)}
                      </span>
                      <span
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          marginTop: 4,
                          font: `400 13px/1.2 ${FONT}`,
                          color: theme.fg2,
                          fontVariantNumeric: "tabular-nums",
                          minWidth: 0,
                          whiteSpace: "nowrap",
                        }}
                      >
                        <span style={{ flexShrink: 0 }}>{fmtDate(r.date)}</span>
                        <span
                          style={{
                            width: 3,
                            height: 3,
                            borderRadius: "50%",
                            background: theme.fg3,
                            flexShrink: 0,
                          }}
                        />
                        {/* Оплата уступает ПЕРВОЙ и многоточием — как на «Чеках».
                        Текст вынесен в отдельный span: многоточие работает
                        в блочном боксе, а на анонимном flex-элементе рядом
                        с иконкой оно не применилось бы вовсе. */}
                        <span
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                            minWidth: 0,
                            overflow: "hidden",
                          }}
                        >
                          <CreditCard
                            size={14}
                            color={theme.fg2}
                            strokeWidth={2}
                            style={{ flexShrink: 0 }}
                          />
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
                      </span>
                    </span>
                    {/* Правая колонка БОЛЬШЕ не «не сжимаемая»: именно flexShrink:0
                    при длинной категории съедал левую колонку до 46.9px.
                    Сжимается она только когда левая упёрлась в свой пол —
                    сумме при 320 остаётся 94px при нужных 82. */}
                    <span
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "flex-end",
                        gap: 7,
                        minWidth: 0,
                      }}
                    >
                      <span
                        style={{
                          font: `600 15px/1.2 ${FONT}`,
                          color: "#111318",
                          fontVariantNumeric: "tabular-nums",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {money(Number(r.amount))}
                      </span>
                      <span
                        style={{
                          font: `500 12px/1 ${FONT}`,
                          padding: "5px 10px",
                          borderRadius: 999,
                          background: pill.bg || theme.surfaceSunk,
                          color: pill.fg || theme.fg2,
                          whiteSpace: "nowrap",
                          maxWidth: "100%",
                          boxSizing: "border-box",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {catName(r)}
                      </span>
                    </span>
                  </button>
                );
              })}
              {recent.length === 0 && (
                <div
                  style={{
                    font: `400 13px/1.4 ${FONT}`,
                    color: theme.fg3,
                    padding: "8px 0",
                  }}
                >
                  Пока нет чеков
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
