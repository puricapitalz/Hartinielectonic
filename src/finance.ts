// Data penjualan 2027 (workbook), buku retur, dan perhitungan laporan keuangan.
// Sumber data ada di public/data/sales-2027.json; ganti loader & store dengan
// query Supabase (tabel `sales`, `returns`, `opex`) nanti.
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { Order } from "./orders";

export type TxStatus = "Diproses" | "Dalam Pengiriman" | "Siap Diambil" | "Selesai" | "Dibatalkan";
export type Delivery = "Kirim ke alamat" | "Ambil di toko";

export type Tx = {
  trx: string;
  serial: number;
  branch: string;
  sku: string;
  qty: number;
  price: number;
  disc: number;
  omzet: number;
  hpp: number;
  pay: string;
  segment: string;
  customer: string;
  payStatus: string;
};

/** Pengiriman dari sheet Transaksi Layanan + Detail (kode L-01/L-02/L-03). */
export type Shipment = {
  order: string;
  code: string;
  /** status asli Excel: Selesai, Dalam Proses, Dijadwalkan, Dibatalkan */
  status: string;
  orderSerial: number;
  doneSerial: number | null;
  fee: number;
  courier: string;
};

export type OpexCats = {
  gaji: number;
  sewa: number;
  listrik: number;
  marketing: number;
  logistik: number;
  lain: number;
};

export type SalesDb = {
  rows: Tx[];
  skus: Record<string, [string, string, number]>; // sku -> [nama, kategori, harga beli]
  opex: Array<{ month: number; branch: string } & OpexCats>;
  /** retur dari sheet Keluhan & Klaim Garansi (penanganan Refund / Retur) */
  returns: ReturnEntry[];
  ship: Record<string, Shipment>;
};

/** Tanggal acuan laporan = 31 Des 2027 (serial Excel). */
export const REF_SERIAL = 46752;
export const MONTHS = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

export const serialToDate = (serial: number) =>
  new Date(Date.UTC(1899, 11, 30) + serial * 86400000);

let cache: Promise<SalesDb> | null = null;
function loadDb(): Promise<SalesDb> {
  cache ||= fetch(`${import.meta.env.BASE_URL}data/sales-2027.json`)
    .then((r) => {
      if (!r.ok) throw new Error("gagal memuat data");
      return r.json();
    })
    .then((j) => ({
      rows: (j.rows as any[][]).map((a) => ({
        trx: a[0],
        serial: a[1],
        branch: a[2],
        sku: a[3],
        qty: a[4],
        price: a[5],
        disc: a[6],
        omzet: a[7],
        hpp: a[8],
        pay: a[9],
        segment: a[10],
        customer: a[11],
        payStatus: a[12],
      })),
      returns: j.returns as ReturnEntry[],
      ship: Object.fromEntries(
        Object.entries(j.ship as Record<string, any[]>).map(([k, a]) => [
          k,
          {
            order: a[0],
            code: a[1],
            status: a[2],
            orderSerial: a[3],
            doneSerial: a[4],
            fee: a[5],
            courier: a[6],
          },
        ]),
      ),
      skus: j.skus,
      opex: (j.opex as any[][]).map((a) => ({
        month: a[0],
        branch: a[1],
        gaji: a[2],
        sewa: a[3],
        listrik: a[4],
        marketing: a[5],
        logistik: a[6],
        lain: a[7],
      })),
    }));
  cache.catch(() => (cache = null));
  return cache;
}

export function useSalesDb() {
  const [db, setDb] = useState<SalesDb | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let off = false;
    loadDb()
      .then((d) => !off && setDb(d))
      .catch(() => !off && setError(true));
    return () => {
      off = true;
    };
  }, []);
  return { db, error };
}

const SHIP_STATUS: Record<string, TxStatus> = {
  Selesai: "Selesai",
  "Dalam Proses": "Dalam Pengiriman",
  Dijadwalkan: "Diproses",
  Dibatalkan: "Dibatalkan",
};

/**
 * Cara penerimaan & status sesuai database: transaksi yang punya order layanan
 * pengiriman (L-01/L-02/L-03) = dikirim, statusnya dari sheet Transaksi Layanan.
 * Transaksi tanpa pengiriman = dibawa/diambil langsung di toko (Selesai).
 */
export function txMeta(
  t: Tx,
  db: SalesDb,
): { delivery: Delivery; status: TxStatus; ship?: Shipment } {
  const ship = db.ship[t.trx];
  if (!ship) return { delivery: "Ambil di toko", status: "Selesai" };
  return { delivery: "Kirim ke alamat", status: SHIP_STATUS[ship.status] ?? "Diproses", ship };
}

export type ReturnEntry = {
  id: string;
  ref: string; // nomor transaksi toko atau nomor pesanan online
  source: "toko" | "online" | "excel";
  branch: string;
  sku: string;
  name: string;
  qty: number;
  omzet: number;
  hpp: number;
  date: string;
  reason: string;
  /** status penanganan klaim (Excel); retur dari web dianggap Selesai */
  status?: string;
  customer?: string;
  claimDate?: string;
  pic?: string;
};

/** Hanya retur yang selesai yang mengurangi omzet. */
export const isCountedReturn = (r: ReturnEntry) => !r.status || r.status === "Selesai";

function readJson<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

// Buku retur dari website disimpan di localStorage dan dibagikan ke seluruh
// aplikasi (admin & perhitungan stok di toko) lewat store sederhana.
const RETURNS_KEY = "hartini.returns";
let localReturnsState: ReturnEntry[] = readJson(RETURNS_KEY, []);
const returnListeners = new Set<() => void>();
function setReturns(update: (c: ReturnEntry[]) => ReturnEntry[]) {
  localReturnsState = update(localReturnsState);
  try {
    localStorage.setItem(RETURNS_KEY, JSON.stringify(localReturnsState));
  } catch {
    /* penyimpanan diblokir */
  }
  returnListeners.forEach((l) => l());
}
export function useLocalReturns() {
  return useSyncExternalStore(
    (l) => (returnListeners.add(l), () => returnListeners.delete(l)),
    () => localReturnsState,
  );
}

/** Override status transaksi toko + buku retur (disimpan di localStorage). */
export function useLedgerStore(excelReturns: ReturnEntry[] = []) {
  const [overrides, setOverrides] = useState<Record<string, TxStatus>>(() =>
    readJson("hartini.txStatus", {}),
  );
  const localReturns = useLocalReturns();
  const returns = useMemo(() => [...localReturns, ...excelReturns], [localReturns, excelReturns]);
  useEffect(() => localStorage.setItem("hartini.txStatus", JSON.stringify(overrides)), [overrides]);

  const setTxStatus = useCallback(
    (trx: string, status: TxStatus) => setOverrides((c) => ({ ...c, [trx]: status })),
    [],
  );
  const addReturn = useCallback(
    (entry: Omit<ReturnEntry, "id" | "date">) =>
      setReturns((c) => [
        {
          ...entry,
          id: `RTR-${Date.now().toString(36).toUpperCase()}`,
          date: new Date().toISOString(),
        },
        ...c,
      ]),
    [],
  );
  const removeReturn = useCallback(
    (id: string) => setReturns((c) => c.filter((r) => r.id !== id)),
    [],
  );
  const returnedQty = useMemo(() => {
    const m: Record<string, number> = {};
    returns.forEach((r) => (m[`${r.ref}|${r.sku}`] = (m[`${r.ref}|${r.sku}`] || 0) + r.qty));
    return m;
  }, [returns]);
  return { overrides, returns, setTxStatus, addReturn, removeReturn, returnedQty };
}

type Cell = { omzet: number; hpp: number; qty: number; trx: number };
type MonthAgg = { base: Cell; online: Cell; ret: Cell; opex: OpexCats };
const cell = (): Cell => ({ omzet: 0, hpp: 0, qty: 0, trx: 0 });
const opexZero = (): OpexCats => ({
  gaji: 0,
  sewa: 0,
  listrik: 0,
  marketing: 0,
  logistik: 0,
  lain: 0,
});
const agg = (): MonthAgg => ({ base: cell(), online: cell(), ret: cell(), opex: opexZero() });

export type Report = {
  branches: string[];
  months: Record<string, MonthAgg[]>;
  categories: Record<string, { omzet: number; qty: number }>;
};

/** Gabungkan penjualan toko 2027 + pesanan online (bertambah) − retur (berkurang). */
export function buildReport(db: SalesDb, orders: Order[], returns: ReturnEntry[]): Report {
  const months: Record<string, MonthAgg[]> = {};
  const ensure = (b: string) => (months[b] ||= Array.from({ length: 12 }, agg));
  const categories: Record<string, { omzet: number; qty: number }> = {};
  const addCat = (sku: string, omzet: number, qty: number) => {
    const c = (categories[db.skus[sku]?.[1] ?? "Lainnya"] ||= { omzet: 0, qty: 0 });
    c.omzet += omzet;
    c.qty += qty;
  };
  const monthOf = new Map<number, number>();
  for (const t of db.rows) {
    let m = monthOf.get(t.serial);
    if (m === undefined) monthOf.set(t.serial, (m = serialToDate(t.serial).getUTCMonth()));
    const a = ensure(t.branch)[m].base;
    a.omzet += t.omzet;
    a.hpp += t.hpp;
    a.qty += t.qty;
    a.trx += 1;
    addCat(t.sku, t.omzet, t.qty);
  }
  for (const o of db.opex) {
    const x = ensure(o.branch)[o.month - 1].opex;
    (Object.keys(x) as Array<keyof OpexCats>).forEach((k) => (x[k] += o[k]));
  }
  for (const o of orders) {
    const b = months[o.branch ?? ""] ? (o.branch as string) : "Jakarta";
    const a = ensure(b)[new Date(o.createdAt).getMonth()].online;
    a.trx += 1;
    for (const i of o.items) {
      const cost = db.skus[i.productId]?.[2] ?? i.price * 0.85;
      a.omzet += i.price * i.qty;
      a.hpp += cost * i.qty;
      a.qty += i.qty;
      addCat(i.productId, i.price * i.qty, i.qty);
    }
  }
  for (const r of returns) {
    if (!isCountedReturn(r)) continue;
    const a = ensure(r.branch)[new Date(r.date).getMonth()].ret;
    a.omzet += r.omzet;
    a.hpp += r.hpp;
    a.qty += r.qty;
    a.trx += 1;
    addCat(r.sku, -r.omzet, -r.qty);
  }
  return { branches: Object.keys(months).sort(), months, categories };
}

export type Pnl = {
  baseGross: number;
  onlineGross: number;
  gross: number;
  returns: number;
  net: number;
  hpp: number;
  grossProfit: number;
  grossMargin: number;
  opex: OpexCats & { total: number };
  operatingProfit: number;
  operatingMargin: number;
  qty: number;
  trx: number;
};

export function pnl(report: Report, branches: string[], months: number[]): Pnl {
  let baseGross = 0,
    onlineGross = 0,
    returns = 0,
    hpp = 0,
    qty = 0,
    trx = 0;
  const opex = { ...opexZero(), total: 0 };
  for (const b of branches)
    for (const m of months) {
      const a = report.months[b]?.[m];
      if (!a) continue;
      baseGross += a.base.omzet;
      onlineGross += a.online.omzet;
      returns += a.ret.omzet;
      hpp += a.base.hpp + a.online.hpp - a.ret.hpp;
      qty += a.base.qty + a.online.qty - a.ret.qty;
      trx += a.base.trx + a.online.trx;
      (Object.keys(a.opex) as Array<keyof OpexCats>).forEach((k) => {
        opex[k] += a.opex[k];
        opex.total += a.opex[k];
      });
    }
  const gross = baseGross + onlineGross;
  const net = gross - returns;
  const grossProfit = net - hpp;
  const operatingProfit = grossProfit - opex.total;
  return {
    baseGross,
    onlineGross,
    gross,
    returns,
    net,
    hpp,
    grossProfit,
    grossMargin: net ? grossProfit / net : 0,
    opex,
    operatingProfit,
    operatingMargin: net ? operatingProfit / net : 0,
    qty,
    trx,
  };
}

export function downloadCsv(filename: string, rows: Array<Array<string | number>>) {
  const csv = rows
    .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const url = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Salinan database yang hanya berisi satu cabang (untuk Kepala Cabang & Staff). */
export function scopeDb(db: SalesDb, branch: string): SalesDb {
  const rows = db.rows.filter((r) => r.branch === branch);
  const keep = new Set(rows.map((r) => r.trx));
  return {
    ...db,
    rows,
    opex: db.opex.filter((o) => o.branch === branch),
    returns: db.returns.filter((r) => r.branch === branch),
    ship: Object.fromEntries(Object.entries(db.ship).filter(([k]) => keep.has(k))),
  };
}
