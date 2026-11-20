// Akun pelanggan. Struktur mengikuti sheet "Pelanggan" di database 2027.
// Login memakai Google Identity Services (tanpa server): token Google hanya
// dibaca di browser, belum diverifikasi server. Cukup untuk prototipe; untuk
// produksi verifikasi token di backend (mis. Supabase Auth).
import { useEffect, useState, useSyncExternalStore } from "react";
import { LAST_CUSTOMER_NO, branches, params, pointsFor, tierFor } from "./data";
import type { Order } from "./orders";

export const GOOGLE_CLIENT_ID: string = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "";

export type Customer = {
  id: string;
  name: string;
  city: string;
  /** provinsi alamat; pelanggan database memakai provinsi cabang asalnya */
  province?: string;
  branch: string;
  /** yyyy-mm-dd */
  joined: string;
  /** total belanja tercatat di database 2027 (pelanggan lama) */
  baseTotal: number;
  baseTrx: number;
  lastPurchase: string | null;
  type: "Perorangan" | "Korporat";
  phone: string;
  email: string;
  address: string;
  /** asal akun: database 2027 atau daftar lewat Google di website */
  source: "excel" | "google";
  picture?: string;
  /** pelanggan lama (database) yang sudah menghubungkan akun Google */
  googleLinked?: boolean;
  /** email lama di sheet Pelanggan, sebelum diganti email Google */
  excelEmail?: string;
};

const EPOCH = Date.UTC(1899, 11, 30);
const serialToIso = (s: number | null) =>
  s == null ? null : new Date(EPOCH + s * 86400000).toISOString().slice(0, 10);

type Row = [
  string,
  string,
  string,
  string,
  number,
  number,
  number,
  number,
  string,
  string,
  string,
  string,
  string,
  string,
  number,
];
let excelCache: Promise<Customer[]> | null = null;
export function loadExcelCustomers() {
  excelCache ||= fetch(`${import.meta.env.BASE_URL}data/customers-2027.json`)
    .then((r) => r.json() as Promise<Row[]>)
    .then((rows) =>
      rows.map((r) => ({
        id: r[0],
        name: r[1],
        city: r[2],
        province: branches.find((b) => b.branch === r[3])?.province,
        branch: r[3],
        joined: serialToIso(r[4]) ?? "2027-01-01",
        baseTotal: r[5],
        baseTrx: r[6],
        lastPurchase: serialToIso(r[7]),
        type: r[10] as Customer["type"],
        phone: r[11],
        email: r[12],
        address: r[13],
        source: "excel" as const,
      })),
    );
  excelCache.catch(() => (excelCache = null));
  return excelCache;
}

export function useExcelCustomers() {
  const [list, setList] = useState<Customer[] | null>(null);
  useEffect(() => {
    let off = false;
    loadExcelCustomers()
      .then((l) => !off && setList(l))
      .catch(() => !off && setList([]));
    return () => {
      off = true;
    };
  }, []);
  return list;
}

// ---------- penyimpanan sesi (localStorage) ----------
const ACCOUNTS_KEY = "hartini.accounts"; // akun baru dari Google
const SESSION_KEY = "hartini.session"; // pelanggan yang sedang masuk

function readJson<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

let current: Customer | null = readJson<Customer | null>(SESSION_KEY, null);
const listeners = new Set<() => void>();
function setCurrent(c: Customer | null) {
  current = c;
  try {
    if (c) localStorage.setItem(SESSION_KEY, JSON.stringify(c));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* penyimpanan diblokir: sesi hanya bertahan di tab ini */
  }
  listeners.forEach((l) => l());
}
export function useCustomer() {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => current,
  );
}
export const signOut = () => {
  try {
    (window as any).google?.accounts.id.disableAutoSelect();
  } catch {
    /* abaikan */
  }
  setCurrent(null);
};
export const signInAs = (c: Customer) => setCurrent(c);

const accounts = () => readJson<Customer[]>(ACCOUNTS_KEY, []);

/** Nomor pelanggan baru melanjutkan urutan sheet Pelanggan (CUST-03809, dst). */
export function nextCustomerId() {
  const used = accounts()
    .map((a) => Number(a.id.slice(5)))
    .filter(Number.isFinite);
  const n = Math.max(LAST_CUSTOMER_NO, ...used) + 1;
  return `CUST-${String(n).padStart(5, "0")}`;
}

export function saveAccount(c: Customer) {
  const list = accounts().filter((a) => a.id !== c.id);
  try {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify([c, ...list]));
  } catch {
    /* abaikan */
  }
  setCurrent(c);
}

// ---------- Google ----------
export type GoogleProfile = { email: string; name: string; picture?: string; sub: string };

function decodeJwt(token: string): GoogleProfile {
  const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
  const json = decodeURIComponent(
    atob(part)
      .split("")
      .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
      .join(""),
  );
  return JSON.parse(json);
}

let gisPromise: Promise<void> | null = null;
function loadGis() {
  gisPromise ||= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      gisPromise = null;
      reject(new Error("Gagal memuat Google Sign-In"));
    };
    document.head.appendChild(s);
  });
  return gisPromise;
}

/**
 * Tampilkan tombol "Masuk dengan Google" di elemen `el`.
 * onProfile dipanggil dengan profil Google setelah pengguna memilih akun.
 */
export async function renderGoogleButton(el: HTMLElement, onProfile: (p: GoogleProfile) => void) {
  if (!GOOGLE_CLIENT_ID) throw new Error("NO_CLIENT_ID");
  await loadGis();
  const g = (window as any).google;
  g.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: (res: { credential: string }) => onProfile(decodeJwt(res.credential)),
    ux_mode: "popup",
  });
  g.accounts.id.renderButton(el, {
    theme: "outline",
    size: "large",
    shape: "pill",
    text: "continue_with",
    locale: "id",
    width: Math.min(360, el.clientWidth || 360),
  });
}

/** Cari akun yang sudah ada untuk email Google ini (akun web, lalu database 2027). */
export async function findByEmail(email: string): Promise<Customer | null> {
  const e = email.toLowerCase();
  const own = accounts().find((a) => a.email.toLowerCase() === e);
  if (own) return own;
  const excel = await loadExcelCustomers().catch(() => []);
  return excel.find((c) => c.email.toLowerCase() === e) ?? null;
}

// ---------- tier & poin (sheet Parameter) ----------
export type Membership = {
  total: number;
  trx: number;
  tier: string;
  points: number;
  next: { name: string; min: number } | null;
  status: string;
};

export function membershipOf(c: Customer, orders: Order[], today = new Date()): Membership {
  const mine = orders.filter((o) => o.customerId === c.id && o.status === "Selesai");
  const total = c.baseTotal + mine.reduce((s, o) => s + o.total, 0);
  const trx = c.baseTrx + mine.length;
  const tier = tierFor(total);
  const idx = params.tiers.findIndex((t) => t.name === tier);
  const last =
    [c.lastPurchase, ...mine.map((o) => (o.completedAt ?? o.createdAt).slice(0, 10))]
      .filter(Boolean)
      .sort()
      .pop() ?? c.joined;
  // pelanggan database diukur dari tanggal acuan 31 Des 2027, pelanggan web dari hari ini
  const ref = c.source === "excel" && !mine.length ? new Date("2027-12-31") : today;
  const days = (ref.getTime() - new Date(last).getTime()) / 86400000;
  const status =
    days <= params.activeDays
      ? "Aktif"
      : days <= params.lessActiveDays
        ? "Kurang Aktif"
        : "Tidak Aktif";
  return {
    total,
    trx,
    tier,
    points: pointsFor(total),
    next: params.tiers[idx + 1] ?? null,
    status,
  };
}

/** Provinsi alamat pelanggan (akun lama tanpa provinsi memakai provinsi cabang asal). */
export const provinceOf = (c: Customer) =>
  c.province ?? branches.find((b) => b.branch === c.branch)?.province ?? "DKI Jakarta";

// ---------- pelanggan lama: hubungkan dengan akun Google ----------
const digits = (phone: string) => {
  const d = phone.replace(/\D/g, "");
  return d.startsWith("62") ? "0" + d.slice(2) : d;
};

/** Cari pelanggan database 2027 berdasarkan No. HP (sheet Pelanggan). */
export async function findByPhone(phone: string): Promise<Customer | null> {
  const d = digits(phone);
  if (d.length < 9) return null;
  const linked = accounts().find((a) => a.source === "excel" && digits(a.phone) === d);
  if (linked) return linked;
  const excel = await loadExcelCustomers().catch(() => []);
  return excel.find((c) => digits(c.phone) === d) ?? null;
}

/** Simpan pelanggan lama sebagai akun yang terhubung ke email Google. */
export function linkGoogle(c: Customer, p: GoogleProfile) {
  saveAccount({
    ...c,
    excelEmail: c.excelEmail ?? c.email,
    email: p.email,
    picture: p.picture,
    googleLinked: true,
  });
}

/** "Winda Matulessy" -> "W**** M*******" untuk konfirmasi tanpa membuka data lengkap. */
export const maskName = (name: string) =>
  name
    .split(" ")
    .map((w) => w.slice(0, 1) + "*".repeat(Math.max(2, w.length - 1)))
    .join(" ");
