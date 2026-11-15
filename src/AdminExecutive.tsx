// Dasbor Direksi: ringkasan kinerja per cabang + instrumen pengambilan keputusan.
// Target omzet & laba di sini adalah ASUMSI DEMO (lihat TARGET di bawah), karena
// workbook 2027 tidak memuat anggaran. Ganti dengan tabel `budgets` di Supabase nanti.
import { useMemo, useState, type ReactNode } from "react";
import type { Order, Review } from "./orders";
import {
  MONTHS,
  pnl,
  serialToDate,
  type Report,
  type ReturnEntry,
  type SalesDb,
  type Tx,
} from "./finance";

export const TARGET = {
  netMargin: 0.04, // laba bersih / omzet bersih
  grossMargin: 0.16,
  opexRatio: 0.12, // batas atas biaya operasional / omzet
};

// Warna: seri (realisasi biru, target oranye) & status, dari palet yang tervalidasi CVD.
const C = {
  actual: "#2a78d6",
  target: "#eb6834",
  grid: "#e5e9f0",
  axis: "#64748b",
  good: "#0ca30c",
  warn: "#fab219",
  bad: "#d03b3b",
  track: "#e8edf3",
};
type Status = "good" | "warn" | "bad";
const STATUS: Record<Status, { label: string; fg: string; bg: string; dot: string }> = {
  good: { label: "≥ target", fg: "#0a6e0a", bg: "#e7f6e7", dot: C.good },
  warn: { label: "mendekati", fg: "#7a5200", bg: "#fff3d1", dot: C.warn },
  bad: { label: "di bawah", fg: "#a32727", bg: "#fbe7e7", dot: C.bad },
};
const statusOf = (ratio: number): Status => (ratio >= 1 ? "good" : ratio >= 0.95 ? "warn" : "bad");

const ALL = "Semua cabang";
const SHORT = MONTHS.map((m) => m.slice(0, 3));

// ---------- format angka (gaya Indonesia) ----------
const dec = (n: number, d = 1) =>
  n.toLocaleString("id-ID", { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (n: number, d = 1) => {
  const v = Number((n * 100).toFixed(d));
  return `${dec(v === 0 ? 0 : v, d)}%`;
};
function rp(n: number, d = 1) {
  const a = Math.abs(n);
  const s = n < 0 ? "−" : "";
  if (a >= 1e9) return `${s}Rp ${dec(a / 1e9, 2)} M`;
  if (a >= 1e6) return `${s}Rp ${dec(a / 1e6, d)} jt`;
  return `${s}Rp ${a.toLocaleString("id-ID", { maximumFractionDigits: 0 })}`;
}
const miliar = (n: number) => dec(n / 1e9, Math.abs(n) >= 1e10 ? 0 : Math.abs(n) >= 1e9 ? 1 : 2);

function hash(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

// ---------- model data ----------
type Model = ReturnType<typeof buildModel>;
function buildModel(db: SalesDb) {
  const monthOf = new Map<number, number>();
  const idx: Record<string, Tx[][]> = {};
  const companyMonth = Array(12).fill(0) as number[];
  const branchYear: Record<string, number> = {};
  for (const t of db.rows) {
    let m = monthOf.get(t.serial);
    if (m === undefined) monthOf.set(t.serial, (m = serialToDate(t.serial).getUTCMonth()));
    (idx[t.branch] ||= Array.from({ length: 12 }, () => []))[m].push(t);
    companyMonth[m] += t.omzet;
    branchYear[t.branch] = (branchYear[t.branch] || 0) + t.omzet;
  }
  const year = companyMonth.reduce((a, b) => a + b, 0);
  // Pola anggaran: separuh mengikuti musiman aktual, separuh rata per bulan (lebih halus).
  const season = companyMonth.map((v) => 0.5 * (v / year) + 0.5 / 12);
  // Target omzet cabang = omzet tahunan × faktor ambisi (0,94–1,08, tetap per cabang) × musiman.
  const factor = (b: string) => 0.94 + hash(b + "target") * 0.14;
  const target = (b: string, m: number) => (branchYear[b] || 0) * factor(b) * season[m];
  return { idx, monthOf, target, branches: Object.keys(idx).sort() };
}

function rowsFor(model: Model, branches: string[], months: number[]) {
  const out: Tx[] = [];
  for (const b of branches) for (const m of months) out.push(...(model.idx[b]?.[m] ?? []));
  return out;
}
const range = (to: number) => Array.from({ length: to + 1 }, (_, i) => i);
const sumTarget = (model: Model, branches: string[], months: number[]) =>
  branches.reduce((s, b) => s + months.reduce((t, m) => t + model.target(b, m), 0), 0);

// ---------- komponen kecil ----------
function Panel({
  title,
  note,
  children,
  className = "",
}: {
  title: string;
  note?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`min-w-0 rounded-2xl border border-slate-200 bg-white ${className}`}>
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-slate-100 px-5 py-3.5">
        <h3 className="text-xs font-extrabold uppercase tracking-[.08em] text-[#12285C]">
          {title}
        </h3>
        {note && <p className="text-[11px] text-slate-500">{note}</p>}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

function Chip({ status, text }: { status: Status; text?: string }) {
  const s = STATUS[status];
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold"
      style={{ background: s.bg, color: s.fg }}
    >
      <span className="size-1.5 rounded-full" style={{ background: s.dot }} />
      {text ?? s.label}
    </span>
  );
}

function Kpi({
  label,
  value,
  unit,
  status,
  chip,
  hint,
}: {
  label: string;
  value: string;
  unit?: string;
  status: Status;
  chip: string;
  hint?: string;
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-[11px] font-extrabold uppercase tracking-[.08em] text-slate-500">
        {label}
      </p>
      <p className="mt-1.5 whitespace-nowrap font-heading text-xl font-bold tabular-nums text-[#0F1B33] 2xl:text-2xl">
        {value}
        {unit && <span className="ml-1 text-xs font-semibold text-slate-500">{unit}</span>}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Chip status={status} text={chip} />
        {hint && <span className="text-[11px] text-slate-500">{hint}</span>}
      </div>
    </div>
  );
}

/** Setengah lingkaran: busur nilai + garis penanda target. */
function Gauge({
  label,
  value,
  display,
  target,
  max,
  status,
  foot,
}: {
  label: string;
  value: number;
  display: string;
  target: number;
  max: number;
  status: Status;
  foot: string;
}) {
  const cx = 100,
    cy = 96,
    r = 74;
  const pt = (f: number, rr = r) => {
    const a = Math.PI * (1 - Math.min(Math.max(f, 0), 1));
    return [cx + rr * Math.cos(a), cy - rr * Math.sin(a)];
  };
  const arc = (f: number) => {
    const [x, y] = pt(f);
    return `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)}`;
  };
  const tf = target / max;
  const [t1x, t1y] = pt(tf, r - 13);
  const [t2x, t2y] = pt(tf, r + 13);
  return (
    <figure className="grid justify-items-center gap-1 py-2">
      <figcaption className="text-center text-xs font-bold text-slate-600">{label}</figcaption>
      <svg
        viewBox="0 0 200 112"
        className="w-full max-w-[220px]"
        role="img"
        aria-label={`${label}: ${display}, target ${foot}`}
      >
        <path d={arc(1)} fill="none" stroke={C.track} strokeWidth="16" strokeLinecap="round" />
        {value / max > 0.005 && (
          <path
            d={arc(value / max)}
            fill="none"
            stroke={STATUS[status].dot}
            strokeWidth="16"
            strokeLinecap="round"
          />
        )}
        <line
          x1={t1x}
          y1={t1y}
          x2={t2x}
          y2={t2y}
          stroke="#0F1B33"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <text
          x={cx}
          y={cy - 8}
          textAnchor="middle"
          fontSize="24"
          fontWeight="800"
          fill="#0F1B33"
          fontFamily="Poppins, sans-serif"
        >
          {display}
        </text>
      </svg>
      <p className="text-center text-[11px] text-slate-500">{foot}</p>
    </figure>
  );
}

function barPath(x: number, y: number, w: number, h: number, r = 4) {
  if (h <= 0) return "";
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}
function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

function Tip({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  return (
    <div
      className="pointer-events-none absolute z-10 min-w-36 -translate-x-1/2 -translate-y-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] shadow-lg"
      style={{ left: `${x}%`, top: `${y}%` }}
    >
      {children}
    </div>
  );
}
const TipRow = ({ color, label, value }: { color?: string; label: string; value: string }) => (
  <div className="flex items-center justify-between gap-4">
    <span className="flex items-center gap-1.5 text-slate-500">
      {color && <span className="size-2 rounded-sm" style={{ background: color }} />}
      {label}
    </span>
    <b className="tabular-nums text-[#0F1B33]">{value}</b>
  </div>
);

/** Omzet bulanan: batang realisasi vs garis target. */
function MonthlyChart({
  actual,
  target,
  month,
}: {
  actual: number[];
  target: number[];
  month: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640,
    H = 250,
    L = 44,
    R = 10,
    T = 22,
    B = 26;
  const max = niceMax(Math.max(...target, ...actual.slice(0, month + 1)) * 1.08);
  const band = (W - L - R) / 12;
  const x = (i: number) => L + band * i + band / 2;
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  return (
    <div className="relative">
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full min-w-[520px]"
          role="img"
          aria-label="Omzet bersih bulanan dibanding target"
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke={C.grid} />
              <text x={L - 8} y={y(t) + 3.5} textAnchor="end" fontSize="10" fill={C.axis}>
                {dec(t / 1e9, max >= 1e10 ? 0 : 1)}
              </text>
            </g>
          ))}
          {actual.map((v, i) =>
            i <= month ? (
              <path
                key={i}
                d={barPath(x(i) - band * 0.26, y(v), band * 0.52, y(0) - y(v))}
                fill={C.actual}
                opacity={i === month || hover === i ? 1 : 0.72}
              />
            ) : null,
          )}
          <polyline
            points={target.map((v, i) => `${x(i)},${y(v)}`).join(" ")}
            fill="none"
            stroke={C.target}
            strokeWidth="2"
          />
          {target.map((v, i) => (
            <circle
              key={i}
              cx={x(i)}
              cy={y(v)}
              r="4"
              fill={C.target}
              stroke="#fff"
              strokeWidth="2"
            />
          ))}
          {actual.map((v, i) =>
            i <= month && v < target[i] ? (
              <text
                key={i}
                x={x(i)}
                y={Math.min(y(v), y(target[i])) - 9}
                textAnchor="middle"
                fontSize="10"
                fontWeight="700"
                fill="#a32727"
              >
                −{miliar(target[i] - v)}
              </text>
            ) : null,
          )}
          {SHORT.map((m, i) => (
            <text
              key={m}
              x={x(i)}
              y={H - 8}
              textAnchor="middle"
              fontSize="10.5"
              fontWeight={i === month ? 800 : 400}
              fill={i === month ? "#0F1B33" : C.axis}
            >
              {m}
            </text>
          ))}
          {SHORT.map((_, i) => (
            <rect
              key={i}
              x={L + band * i}
              y={T}
              width={band}
              height={H - T - B}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
          ))}
        </svg>
      </div>
      {hover !== null && (
        <Tip
          x={(x(hover) / W) * 100}
          y={(Math.min(y(target[hover]), y(hover <= month ? actual[hover] : 0)) / H) * 100}
        >
          <p className="mb-1 font-bold text-[#0F1B33]">{MONTHS[hover]} 2027</p>
          {hover <= month && (
            <TipRow color={C.actual} label="Realisasi" value={rp(actual[hover])} />
          )}
          <TipRow color={C.target} label="Target" value={rp(target[hover])} />
          {hover <= month && (
            <TipRow label="Pencapaian" value={pct(actual[hover] / target[hover])} />
          )}
        </Tip>
      )}
      <div className="mt-2 flex flex-wrap gap-4 text-[11px] text-slate-600">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: C.actual }} />
          Realisasi
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded" style={{ background: C.target }} />
          Target
        </span>
        <span className="text-slate-500">Angka merah = kekurangan dari target (miliar Rp)</span>
      </div>
    </div>
  );
}

/** Omzet harian bulan terpilih vs target harian. */
function DailyChart({
  values,
  dailyTarget,
  label,
}: {
  values: number[];
  dailyTarget: number;
  label: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640,
    H = 200,
    L = 44,
    R = 10,
    T = 12,
    B = 24;
  const max = niceMax(Math.max(...values, dailyTarget) * 1.05);
  const band = (W - L - R) / values.length;
  const x = (i: number) => L + band * i;
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const ticks = [0, 0.5, 1].map((f) => f * max);
  return (
    <div className="relative">
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full min-w-[520px]"
          role="img"
          aria-label={`Omzet harian ${label}`}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke={C.grid} />
              <text x={L - 8} y={y(t) + 3.5} textAnchor="end" fontSize="10" fill={C.axis}>
                {dec(t / 1e6, 0)}
              </text>
            </g>
          ))}
          {values.map((v, i) => (
            <path
              key={i}
              d={barPath(x(i) + 1.5, y(v), band - 3, y(0) - y(v), 3)}
              fill={v >= dailyTarget ? C.good : C.bad}
              opacity={hover === null || hover === i ? 1 : 0.55}
            />
          ))}
          <line
            x1={L}
            x2={W - R}
            y1={y(dailyTarget)}
            y2={y(dailyTarget)}
            stroke={C.target}
            strokeWidth="2"
            strokeDasharray="5 4"
          />
          {values.map((_, i) =>
            i % 2 === 0 ? (
              <text
                key={i}
                x={x(i) + band / 2}
                y={H - 8}
                textAnchor="middle"
                fontSize="9.5"
                fill={C.axis}
              >
                {i + 1}
              </text>
            ) : null,
          )}
          {values.map((_, i) => (
            <rect
              key={i}
              x={x(i)}
              y={T}
              width={band}
              height={H - T - B}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
          ))}
        </svg>
      </div>
      {hover !== null && (
        <Tip
          x={((x(hover) + band / 2) / W) * 100}
          y={(Math.min(y(values[hover]), y(dailyTarget)) / H) * 100}
        >
          <p className="mb-1 font-bold text-[#0F1B33]">
            {hover + 1} {label}
          </p>
          <TipRow
            color={values[hover] >= dailyTarget ? C.good : C.bad}
            label="Omzet"
            value={rp(values[hover])}
          />
          <TipRow color={C.target} label="Target harian" value={rp(dailyTarget)} />
        </Tip>
      )}
      <div className="mt-2 flex flex-wrap gap-4 text-[11px] text-slate-600">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: C.good }} />≥ target harian
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: C.bad }} />
          di bawah target harian
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 border-t-2 border-dashed" style={{ borderColor: C.target }} />
          Target harian
        </span>
        <span className="text-slate-500">Sumbu: juta Rp</span>
      </div>
    </div>
  );
}

/** Daftar meter: nama, batang, angka (bandingkan rasio antar baris). */
function MeterList({
  rows,
  max,
  color = C.actual,
}: {
  rows: Array<{ name: string; value: number; text: string; sub?: ReactNode; flag?: Status }>;
  max: number;
  color?: string;
}) {
  return (
    <ul className="grid gap-3">
      {rows.map((r) => (
        <li key={r.name} className="grid gap-1">
          <div className="flex items-baseline justify-between gap-3 text-xs">
            <span className="min-w-0 truncate font-semibold text-slate-700" title={r.name}>
              {r.name}
            </span>
            <span className="flex shrink-0 items-center gap-2 tabular-nums text-slate-600">
              {r.sub}
              <b className="text-[#0F1B33]">{r.text}</b>
            </span>
          </div>
          <div className="h-2 rounded-full bg-slate-100">
            <div
              className="h-2 rounded-full"
              style={{
                width: `${Math.max(0, Math.min(1, r.value / max)) * 100}%`,
                background: r.flag ? STATUS[r.flag].dot : color,
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

// ---------- halaman ----------
export default function AdminExecutive({
  db,
  report,
  orders,
  reviews,
  returns,
}: {
  db: SalesDb;
  report: Report;
  orders: Order[];
  reviews: Review[];
  returns: ReturnEntry[];
}) {
  const model = useMemo(() => buildModel(db), [db]);
  const [month, setMonth] = useState(11);
  const [branch, setBranch] = useState(ALL);
  const [cardPeriod, setCardPeriod] = useState<"bulan" | "ytd">("bulan");
  const [sortKey, setSortKey] = useState<"profit" | "ach" | "margin">("profit");

  const scope = branch === ALL ? model.branches : [branch];
  const ytd = range(month);

  const v = useMemo(() => {
    const cur = pnl(report, scope, [month]);
    const prev = month > 0 ? pnl(report, scope, [month - 1]) : null;
    const y = pnl(report, scope, ytd);
    const tMonth = sumTarget(model, scope, [month]);
    const tYtd = sumTarget(model, scope, ytd);
    const monthly = range(11).map((m) => pnl(report, scope, [m]).net);
    const monthlyTarget = range(11).map((m) => sumTarget(model, scope, [m]));

    // baris transaksi toko untuk analisis detail
    const rowsM = rowsFor(model, scope, [month]);
    const rowsY = rowsFor(model, scope, ytd);
    const days = new Date(Date.UTC(2027, month + 1, 0)).getUTCDate();
    const daily = Array(days).fill(0) as number[];
    for (const t of rowsM) daily[serialToDate(t.serial).getUTCDate() - 1] += t.omzet;

    const sum = (rows: Tx[], f: (t: Tx) => number) => rows.reduce((s, t) => s + f(t), 0);
    const omzetM = sum(rowsM, (t) => t.omzet) || 1;
    const grossBeforeDisc = sum(rowsM, (t) => t.price * t.qty) || 1;
    const profile = {
      trx: rowsM.length,
      units: sum(rowsM, (t) => t.qty),
      atv: rowsM.length ? omzetM / rowsM.length : 0,
      disc: 1 - omzetM / grossBeforeDisc,
      corporate:
        sum(
          rowsM.filter((t) => t.segment === "Korporat"),
          (t) => t.omzet,
        ) / omzetM,
      installment:
        sum(
          rowsM.filter((t) => t.pay === "Cicilan 0%"),
          (t) => t.omzet,
        ) / omzetM,
    };

    // kategori, diskon, produk, pembayaran (YTD)
    const cat: Record<string, { omzet: number; gp: number }> = {};
    const disc: Record<string, { omzet: number; gp: number }> = {};
    const prod: Record<string, { omzet: number; gp: number; qty: number }> = {};
    const pay: Record<string, number> = {};
    const bucket = (d: number) =>
      d === 0 ? "Tanpa diskon" : d <= 0.05 ? "1–5%" : d <= 0.1 ? "6–10%" : "> 10%";
    for (const t of rowsY) {
      const gp = t.omzet - t.hpp;
      const c = (cat[db.skus[t.sku]?.[1] ?? "Lainnya"] ||= { omzet: 0, gp: 0 });
      c.omzet += t.omzet;
      c.gp += gp;
      const d = (disc[bucket(t.disc)] ||= { omzet: 0, gp: 0 });
      d.omzet += t.omzet;
      d.gp += gp;
      const p = (prod[t.sku] ||= { omzet: 0, gp: 0, qty: 0 });
      p.omzet += t.omzet;
      p.gp += gp;
      p.qty += t.qty;
      pay[t.pay] = (pay[t.pay] || 0) + t.omzet;
    }
    const omzetY = sum(rowsY, (t) => t.omzet) || 1;

    // kartu skor semua cabang
    const cards = model.branches.map((b) => {
      const months = cardPeriod === "bulan" ? [month] : ytd;
      const p = pnl(report, [b], months);
      const t = sumTarget(model, [b], months);
      const pPrev = month > 0 ? pnl(report, [b], [month - 1]).net : 0;
      return {
        b,
        net: p.net,
        ach: t ? p.net / t : 0,
        growth: cardPeriod === "bulan" && pPrev ? p.net / pPrev - 1 : null,
        gm: p.grossMargin,
        opex: p.net ? p.opex.total / p.net : 0,
        profit: p.operatingProfit,
        margin: p.operatingMargin,
        returns: p.returns,
      };
    });
    const achMonth = model.branches.map((b) => {
      const n = pnl(report, [b], [month]).net;
      return { b, ach: n / (model.target(b, month) || 1) };
    });

    const companyAch =
      pnl(report, model.branches, [month]).net / (sumTarget(model, model.branches, [month]) || 1);

    return {
      cur,
      prev,
      y,
      tMonth,
      tYtd,
      monthly,
      monthlyTarget,
      daily,
      profile,
      cat,
      disc,
      prod,
      pay,
      omzetY,
      cards,
      achMonth,
      companyAch,
    };
  }, [report, model, db, scope.join("|"), month, cardPeriod]);

  const { cur, y } = v;
  const achM = v.cur.net / (v.tMonth || 1);
  const profitTargetM = v.tMonth * TARGET.netMargin;
  const profitTargetY = v.tYtd * TARGET.netMargin;
  const achProfitY = profitTargetY ? y.operatingProfit / profitTargetY : 0;
  const mom = v.prev?.net ? cur.net / v.prev.net - 1 : null;

  const sortedCards = [...v.cards].sort((a, b) =>
    sortKey === "profit"
      ? b.profit - a.profit
      : sortKey === "ach"
        ? b.ach - a.ach
        : b.margin - a.margin,
  );

  // ---------- catatan otomatis untuk direksi ----------
  const notes: Array<{ s: Status; text: ReactNode }> = [];
  const ytdCards = model.branches.map((b) => ({ b, p: pnl(report, [b], ytd) }));
  if (branch === ALL) {
    const under = v.achMonth.filter((a) => a.ach < 0.95).sort((a, b) => a.ach - b.ach);
    notes.push(
      under.length
        ? {
            s: "bad",
            text: (
              <>
                <b>{under.length} cabang di bawah 95% target</b> bulan {MONTHS[month]}:{" "}
                {under
                  .slice(0, 4)
                  .map((u) => `${u.b} (${pct(u.ach, 0)})`)
                  .join(", ")}
                {under.length > 4 ? ", dan lainnya" : ""}.
              </>
            ),
          }
        : { s: "good", text: <>Semua cabang mencapai minimal 95% target bulan {MONTHS[month]}.</> },
    );
    const losers = ytdCards
      .filter((c) => c.p.operatingProfit < 0)
      .sort((a, b) => a.p.operatingProfit - b.p.operatingProfit);
    if (losers.length)
      notes.push({
        s: "bad",
        text: (
          <>
            <b>{losers.length} cabang rugi</b> sejak Januari:{" "}
            {losers
              .map(
                (l) =>
                  `${l.b} (${rp(l.p.operatingProfit)}, rasio biaya ${pct(l.p.opex.total / (l.p.net || 1), 0)})`,
              )
              .join(", ")}
            . Biaya tetapnya terlalu besar dibanding omzet. Perlu dievaluasi: efisiensi sewa dan
            staf, atau dorong omzet.
          </>
        ),
      });
  } else {
    const rank =
      [...ytdCards]
        .sort((a, b) => b.p.operatingProfit - a.p.operatingProfit)
        .findIndex((c) => c.b === branch) + 1;
    const co = pnl(report, model.branches, ytd);
    notes.push({
      s: rank <= 5 ? "good" : rank <= 14 ? "warn" : "bad",
      text: (
        <>
          {branch} berada di{" "}
          <b>
            peringkat {rank} dari {model.branches.length}
          </b>{" "}
          cabang berdasarkan laba bersih sejak Januari.
        </>
      ),
    });
    const ratio = y.opex.total / (y.net || 1);
    const coRatio = co.opex.total / (co.net || 1);
    notes.push({
      s: ratio <= TARGET.opexRatio ? "good" : "bad",
      text: (
        <>
          Rasio biaya operasional {pct(ratio)} dibanding rata-rata perusahaan {pct(coRatio)} (batas{" "}
          {pct(TARGET.opexRatio, 0)}).
        </>
      ),
    });
  }
  const cats = Object.entries(v.cat).map(([name, c]) => ({ name, ...c, m: c.gp / (c.omzet || 1) }));
  const bigLow = cats.filter((c) => c.omzet / v.omzetY > 0.1).sort((a, b) => a.m - b.m)[0];
  const bestM = [...cats].filter((c) => c.omzet / v.omzetY > 0.02).sort((a, b) => b.m - a.m)[0];
  if (bigLow && bestM)
    notes.push({
      s: "warn",
      text: (
        <>
          <b>{bigLow.name}</b> menyumbang {pct(bigLow.omzet / v.omzetY, 0)} omzet tetapi marginnya
          hanya {pct(bigLow.m)}. Bandingkan dengan <b>{bestM.name}</b> yang bermargin {pct(bestM.m)}
          . Pertimbangkan menggeser porsi promosi ke kategori bermargin tinggi.
        </>
      ),
    });
  const d0 = v.disc["Tanpa diskon"],
    dHi = v.disc["> 10%"];
  if (d0 && dHi)
    notes.push({
      s: "warn",
      text: (
        <>
          Transaksi dengan diskon di atas 10% hanya bermargin <b>{pct(dHi.gp / dHi.omzet)}</b>,
          dibanding {pct(d0.gp / d0.omzet)} tanpa diskon. Batasi wewenang diskon besar di level
          cabang.
        </>
      ),
    });

  const branchLabel = branch === ALL ? "Seluruh cabang" : `Cabang ${branch}`;
  const reviewsVisible = reviews.filter((r) => !r.hidden);
  const avgRating = reviewsVisible.length
    ? reviewsVisible.reduce((s, r) => s + r.rating, 0) / reviewsVisible.length
    : 0;

  return (
    <div className="grid gap-5">
      {/* kepala dasbor */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-[#12285C] px-5 py-4 text-white">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-xl bg-white font-heading text-lg font-extrabold text-[#12285C]">
            H
          </span>
          <div>
            <p className="font-heading text-lg font-bold leading-tight">HARTINI · Dasbor Direksi</p>
            <p className="text-xs text-white/65">
              {branchLabel} · {MONTHS[month]} 2027
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.08em] text-white/65">
            Periode
            <select
              id="exec-month"
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
              className="h-10 rounded-lg border-0 bg-white px-3 text-sm font-bold normal-case tracking-normal text-[#12285C]"
            >
              {MONTHS.map((m, i) => (
                <option key={m} value={i}>
                  {m} 2027
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.08em] text-white/65">
            Lokasi
            <select
              id="exec-branch"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              className="h-10 rounded-lg border-0 bg-white px-3 text-sm font-bold normal-case tracking-normal text-[#12285C]"
            >
              <option>{ALL}</option>
              {model.branches.map((b) => (
                <option key={b}>{b}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[230px_minmax(0,1fr)_250px]">
        {/* daftar cabang */}
        <Panel
          title="Cabang"
          note={`% target ${SHORT[month]}`}
          className="order-3 xl:order-none xl:row-span-2"
        >
          <ul className="-mx-2 grid gap-0.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-1">
            {[{ b: ALL, ach: v.companyAch }, ...[...v.achMonth].sort((a, b) => b.ach - a.ach)].map(
              (a) => {
                const active = branch === a.b;
                const st = statusOf(a.ach);
                return (
                  <li key={a.b}>
                    <button
                      onClick={() => setBranch(a.b)}
                      aria-pressed={active}
                      className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm ${active ? "bg-[#2a78d6] font-bold text-white" : "text-slate-700 hover:bg-slate-50"}`}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          className="size-2 shrink-0 rounded-full"
                          style={{ background: STATUS[st].dot }}
                          aria-hidden="true"
                        />
                        <span className="truncate">{a.b}</span>
                      </span>
                      <span
                        className={`tabular-nums text-xs ${active ? "text-white" : "text-slate-500"}`}
                      >
                        {pct(a.ach, 0)}
                      </span>
                    </button>
                  </li>
                );
              },
            )}
          </ul>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {(["good", "warn", "bad"] as Status[]).map((s) => (
              <Chip key={s} status={s} />
            ))}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
            Mendekati = 95–99% target. Klik cabang untuk melihat detailnya.
          </p>
        </Panel>

        {/* tengah: KPI + grafik */}
        <div className="order-1 grid min-w-0 gap-5 xl:order-none">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi
              label="Omzet bersih"
              value={rp(cur.net)}
              status={statusOf(achM)}
              chip={`${pct(achM, 0)} target`}
              hint={
                mom !== null
                  ? `${mom >= 0 ? "+" : "−"}${pct(Math.abs(mom), 0)} vs ${SHORT[month - 1]}`
                  : undefined
              }
            />
            <Kpi
              label="Laba bersih bulan ini"
              value={rp(cur.operatingProfit)}
              status={
                cur.operatingProfit < 0
                  ? "bad"
                  : statusOf(cur.operatingProfit / (profitTargetM || 1))
              }
              chip={`target ${rp(profitTargetM)}`}
            />
            <Kpi
              label="Laba bersih YTD"
              value={rp(y.operatingProfit)}
              status={y.operatingProfit < 0 ? "bad" : statusOf(achProfitY)}
              chip={
                y.operatingProfit < 0
                  ? `target ${rp(profitTargetY)}`
                  : `${pct(achProfitY, 0)} target YTD`
              }
              hint={`Jan–${SHORT[month]}`}
            />
            <Kpi
              label="Net margin"
              value={pct(cur.operatingMargin)}
              status={
                cur.operatingMargin < 0 ? "bad" : statusOf(cur.operatingMargin / TARGET.netMargin)
              }
              chip={`target ${pct(TARGET.netMargin, 0)}`}
              hint={`margin kotor ${pct(cur.grossMargin)}`}
            />
          </div>

          <div className="grid min-w-0 gap-5 2xl:grid-cols-[minmax(0,1fr)_280px]">
            <Panel title="Omzet bersih bulanan" note="Realisasi vs target · miliar Rp">
              <MonthlyChart actual={v.monthly} target={v.monthlyTarget} month={month} />
            </Panel>
            <Panel title="Profil penjualan" note={`${MONTHS[month]}, transaksi toko`}>
              <dl className="grid gap-3 text-sm">
                {[
                  ["Transaksi", v.profile.trx.toLocaleString("id-ID")],
                  ["Unit terjual", v.profile.units.toLocaleString("id-ID")],
                  ["Rata-rata per transaksi", rp(v.profile.atv)],
                  ["Rata-rata diskon", pct(v.profile.disc)],
                  ["Porsi pembeli korporat", pct(v.profile.corporate, 0)],
                  ["Porsi cicilan 0%", pct(v.profile.installment, 0)],
                  ["Biaya operasional", rp(cur.opex.total)],
                  ["Rasio biaya / omzet", pct(cur.opex.total / (cur.net || 1))],
                  ["Retur", rp(cur.returns)],
                ].map(([k, val]) => (
                  <div
                    key={k}
                    className="flex items-baseline justify-between gap-3 border-b border-slate-100 pb-2 last:border-0 last:pb-0"
                  >
                    <dt className="text-slate-600">{k}</dt>
                    <dd className="font-bold tabular-nums text-[#0F1B33]">{val}</dd>
                  </div>
                ))}
              </dl>
            </Panel>
          </div>

          <Panel
            title="Omzet harian"
            note={`${MONTHS[month]} 2027 · ${v.daily.filter((d) => d >= v.tMonth / v.daily.length).length} dari ${v.daily.length} hari ≥ target harian`}
          >
            <DailyChart
              values={v.daily}
              dailyTarget={v.tMonth / v.daily.length}
              label={MONTHS[month]}
            />
          </Panel>
        </div>

        {/* kanan: gauge */}
        <Panel title="Indikator utama" className="order-2 xl:order-none xl:row-span-2">
          <div className="grid gap-2 divide-y divide-slate-100 sm:grid-cols-3 sm:divide-y-0 xl:grid-cols-1 xl:divide-y">
            <Gauge
              label="Pencapaian omzet bulan ini"
              value={achM}
              display={pct(achM, 0)}
              target={1}
              max={1.5}
              status={statusOf(achM)}
              foot={`Target ${rp(v.tMonth)}`}
            />
            <Gauge
              label="Pencapaian laba bersih YTD"
              value={Math.max(0, achProfitY)}
              display={y.operatingProfit < 0 ? "Rugi" : pct(achProfitY, 0)}
              target={1}
              max={1.5}
              status={y.operatingProfit < 0 ? "bad" : statusOf(achProfitY)}
              foot={`${rp(y.operatingProfit)} dari ${rp(profitTargetY)}`}
            />
            <Gauge
              label="Net margin YTD"
              value={Math.max(0, y.operatingMargin)}
              display={pct(y.operatingMargin)}
              target={TARGET.netMargin}
              max={TARGET.netMargin * 2}
              status={
                y.operatingMargin < 0 ? "bad" : statusOf(y.operatingMargin / TARGET.netMargin)
              }
              foot={`Target ${pct(TARGET.netMargin, 0)}`}
            />
          </div>
        </Panel>
      </div>

      {/* catatan direksi */}
      <Panel title="Catatan untuk direksi" note="Disusun otomatis dari data periode terpilih">
        <ul className="grid gap-3">
          {notes.map((n, i) => (
            <li key={i} className="flex items-start gap-3 text-sm leading-relaxed text-slate-700">
              <span className="mt-0.5 shrink-0">
                <Chip
                  status={n.s}
                  text={n.s === "good" ? "Baik" : n.s === "warn" ? "Perhatikan" : "Tindak lanjut"}
                />
              </span>
              <p className="min-w-0">{n.text}</p>
            </li>
          ))}
        </ul>
      </Panel>

      {/* kartu skor cabang */}
      <Panel
        title="Kartu skor cabang"
        note={
          <span className="flex flex-wrap items-center gap-2">
            {(["bulan", "ytd"] as const).map((p) => (
              <button
                key={p}
                onClick={() => setCardPeriod(p)}
                aria-pressed={cardPeriod === p}
                className={`rounded-lg px-2.5 py-1 text-[11px] font-bold ${cardPeriod === p ? "bg-[#12285C] text-white" : "bg-slate-100 text-slate-600"}`}
              >
                {p === "bulan" ? MONTHS[month] : `Jan–${SHORT[month]} (YTD)`}
              </button>
            ))}
            <span className="text-slate-400">|</span>
            Urutkan:
            {(
              [
                ["profit", "Laba"],
                ["ach", "% Target"],
                ["margin", "Net margin"],
              ] as const
            ).map(([k, l]) => (
              <button
                key={k}
                onClick={() => setSortKey(k)}
                aria-pressed={sortKey === k}
                className={`rounded-lg px-2.5 py-1 text-[11px] font-bold ${sortKey === k ? "bg-[#12285C] text-white" : "bg-slate-100 text-slate-600"}`}
              >
                {l}
              </button>
            ))}
          </span>
        }
      >
        <div className="-mx-5 overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-[11px] uppercase tracking-[.06em] text-slate-500">
                {[
                  "Cabang",
                  "Omzet bersih",
                  "% Target",
                  cardPeriod === "bulan" ? "vs bln lalu" : "",
                  "Margin kotor",
                  "Biaya / omzet",
                  "Laba bersih",
                  "Net margin",
                  "Status",
                ].map((h, i) => (
                  <th
                    key={i}
                    className={`whitespace-nowrap px-5 py-2.5 font-bold ${i > 0 && i < 8 ? "text-right" : ""}`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedCards.map((c) => {
                const st: Status =
                  c.profit < 0 ? "bad" : statusOf(Math.min(c.ach, c.margin / TARGET.netMargin));
                return (
                  <tr
                    key={c.b}
                    onClick={() => setBranch(c.b)}
                    className={`cursor-pointer whitespace-nowrap border-b border-slate-50 tabular-nums hover:bg-slate-50 ${branch === c.b ? "bg-blue-50/60" : ""}`}
                  >
                    <td className="px-5 py-2.5 font-semibold text-[#0F1B33]">{c.b}</td>
                    <td className="px-5 py-2.5 text-right">{rp(c.net)}</td>
                    <td className="px-5 py-2.5 text-right">{pct(c.ach, 0)}</td>
                    <td className="px-5 py-2.5 text-right">
                      {c.growth === null
                        ? ""
                        : `${c.growth >= 0 ? "+" : "−"}${pct(Math.abs(c.growth), 0)}`}
                    </td>
                    <td className="px-5 py-2.5 text-right">{pct(c.gm)}</td>
                    <td
                      className={`px-5 py-2.5 text-right ${c.opex > TARGET.opexRatio ? "font-bold text-[#a32727]" : ""}`}
                    >
                      {pct(c.opex)}
                    </td>
                    <td
                      className={`px-5 py-2.5 text-right font-bold ${c.profit < 0 ? "text-[#a32727]" : "text-[#0F1B33]"}`}
                    >
                      {rp(c.profit)}
                    </td>
                    <td className="px-5 py-2.5 text-right">{pct(c.margin)}</td>
                    <td className="px-5 py-2.5">
                      <Chip status={st} text={c.profit < 0 ? "rugi" : undefined} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[11px] text-slate-500">
          Status memakai yang terburuk antara pencapaian omzet dan net margin. Biaya/omzet di atas{" "}
          {pct(TARGET.opexRatio, 0)} ditandai merah. Klik baris untuk memfokuskan dasbor ke cabang
          itu.
        </p>
      </Panel>

      {/* instrumen keputusan */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel
          title="Margin per kategori"
          note={`${branchLabel} · Jan–${SHORT[month]} · panjang batang = margin kotor`}
        >
          <MeterList
            max={0.35}
            rows={cats
              .sort((a, b) => b.omzet - a.omzet)
              .map((c) => ({
                name: c.name,
                value: c.m,
                text: pct(c.m),
                sub: (
                  <span className="text-[11px] text-slate-500">
                    {pct(c.omzet / v.omzetY, 0)} omzet ·
                  </span>
                ),
                flag: c.m < TARGET.grossMargin * 0.75 ? ("bad" as Status) : undefined,
              }))}
          />
          <p className="mt-3 text-[11px] text-slate-500">
            Merah = margin di bawah {pct(TARGET.grossMargin * 0.75, 0)}. Diurutkan dari omzet
            terbesar.
          </p>
        </Panel>

        <div className="grid gap-5">
          <Panel title="Diskon menggerus margin" note={`${branchLabel} · Jan–${SHORT[month]}`}>
            <MeterList
              max={0.25}
              rows={["Tanpa diskon", "1–5%", "6–10%", "> 10%"]
                .filter((k) => v.disc[k])
                .map((k) => {
                  const d = v.disc[k];
                  const m = d.gp / (d.omzet || 1);
                  return {
                    name: `Diskon ${k === "Tanpa diskon" ? "0%" : k}`,
                    value: m,
                    text: `margin ${pct(m)}`,
                    sub: (
                      <span className="text-[11px] text-slate-500">
                        {pct(d.omzet / v.omzetY, 0)} omzet ·
                      </span>
                    ),
                    flag: m < TARGET.grossMargin * 0.75 ? ("bad" as Status) : undefined,
                  };
                })}
            />
          </Panel>
          <Panel
            title="Struktur biaya operasional"
            note={`${branchLabel} · Jan–${SHORT[month]} · % dari omzet`}
          >
            <MeterList
              max={Math.max(
                0.06,
                ...(["gaji", "sewa", "listrik", "marketing", "logistik", "lain"] as const).map(
                  (k) => y.opex[k] / (y.net || 1),
                ),
              )}
              rows={(
                [
                  ["gaji", "Gaji & tunjangan"],
                  ["sewa", "Sewa gedung"],
                  ["marketing", "Marketing"],
                  ["logistik", "Logistik"],
                  ["listrik", "Listrik & utilitas"],
                  ["lain", "Lain-lain"],
                ] as const
              ).map(([k, l]) => ({
                name: l,
                value: y.opex[k] / (y.net || 1),
                text: pct(y.opex[k] / (y.net || 1)),
                sub: <span className="text-[11px] text-slate-500">{rp(y.opex[k])} ·</span>,
              }))}
            />
            <p className="mt-3 text-[11px] text-slate-500">
              Total {rp(y.opex.total)} = {pct(y.opex.total / (y.net || 1))} dari omzet. Omzet per Rp
              1 biaya marketing: Rp {dec(y.net / (y.opex.marketing || 1), 0)}.
            </p>
          </Panel>
        </div>

        <Panel
          title="Produk paling menguntungkan"
          note={`Laba kotor terbesar · Jan–${SHORT[month]}`}
        >
          <ProductTable
            rows={Object.entries(v.prod)
              .sort((a, b) => b[1].gp - a[1].gp)
              .slice(0, 6)}
            db={db}
          />
        </Panel>
        <Panel title="Produk laris bermargin tipis" note="10 omzet terbesar, margin terendah">
          <ProductTable
            rows={Object.entries(v.prod)
              .sort((a, b) => b[1].omzet - a[1].omzet)
              .slice(0, 10)
              .sort((a, b) => a[1].gp / a[1].omzet - b[1].gp / b[1].omzet)
              .slice(0, 6)}
            db={db}
          />
          <p className="mt-3 text-[11px] text-slate-500">
            Kandidat negosiasi ulang harga beli ke prinsipal atau penyesuaian harga jual.
          </p>
        </Panel>

        <Panel title="Cara bayar pelanggan" note={`${branchLabel} · Jan–${SHORT[month]}`}>
          <MeterList
            max={Math.max(...Object.values(v.pay)) / v.omzetY}
            rows={Object.entries(v.pay)
              .sort((a, b) => b[1] - a[1])
              .map(([k, val]) => ({
                name: k,
                value: val / v.omzetY,
                text: pct(val / v.omzetY, 0),
              }))}
          />
        </Panel>
        <Panel title="Kanal online & layanan" note="Dari pesanan dan ulasan di website">
          <dl className="grid grid-cols-2 gap-4 text-sm">
            {[
              ["Pesanan online", orders.length.toLocaleString("id-ID")],
              ["Omzet online", rp(orders.reduce((s, o) => s + o.total, 0))],
              [
                "Rating rata-rata",
                reviewsVisible.length ? `${dec(avgRating, 1)} / 5` : "belum ada",
              ],
              ["Jumlah ulasan", reviewsVisible.length.toLocaleString("id-ID")],
              ["Retur tercatat", returns.length.toLocaleString("id-ID")],
              ["Nilai retur", rp(returns.reduce((s, r) => s + r.omzet, 0))],
            ].map(([k, val]) => (
              <div key={k} className="rounded-xl bg-slate-50 p-3">
                <dt className="text-[11px] font-bold uppercase tracking-[.06em] text-slate-500">
                  {k}
                </dt>
                <dd className="mt-1 font-heading text-lg font-bold tabular-nums text-[#0F1B33]">
                  {val}
                </dd>
              </div>
            ))}
          </dl>
        </Panel>
      </div>

      <p className="rounded-xl bg-slate-50 px-4 py-3 text-[11px] leading-relaxed text-slate-500">
        <b className="text-slate-600">Asumsi target (demo):</b> target omzet tiap cabang = omzet
        tahunan cabang × faktor ambisi 94–108% (berbeda per cabang), dibagi per bulan dengan pola
        musiman yang diperhalus (separuh pola aktual, separuh rata). Target net margin{" "}
        {pct(TARGET.netMargin, 0)}, batas rasio biaya {pct(TARGET.opexRatio, 0)}. Laba bersih =
        omzet bersih − HPP − biaya operasional (sebelum pajak). Data 2027 adalah data contoh.
      </p>
    </div>
  );
}

function ProductTable({
  rows,
  db,
}: {
  rows: Array<[string, { omzet: number; gp: number; qty: number }]>;
  db: SalesDb;
}) {
  return (
    <div className="-mx-5 overflow-x-auto">
      <table className="w-full min-w-[440px] text-sm">
        <thead>
          <tr className="border-b border-slate-100 text-left text-[11px] uppercase tracking-[.06em] text-slate-500">
            <th className="px-5 py-2 font-bold">Produk</th>
            <th className="px-5 py-2 text-right font-bold">Omzet</th>
            <th className="whitespace-nowrap px-5 py-2 text-right font-bold">Laba kotor</th>
            <th className="px-5 py-2 text-right font-bold">Margin</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([sku, p]) => {
            const m = p.gp / (p.omzet || 1);
            return (
              <tr key={sku} className="border-b border-slate-50 tabular-nums">
                <td className="px-5 py-2">
                  <p className="font-semibold text-[#0F1B33]">{db.skus[sku]?.[0] ?? sku}</p>
                  <p className="text-[11px] text-slate-500">
                    {db.skus[sku]?.[1]} · {p.qty.toLocaleString("id-ID")} unit
                  </p>
                </td>
                <td className="whitespace-nowrap px-5 py-2 text-right">{rp(p.omzet)}</td>
                <td className="whitespace-nowrap px-5 py-2 text-right font-bold">{rp(p.gp)}</td>
                <td
                  className={`px-5 py-2 text-right ${m < TARGET.grossMargin * 0.75 ? "font-bold text-[#a32727]" : ""}`}
                >
                  {pct(m)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
