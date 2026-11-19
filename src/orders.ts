import { useCallback, useEffect, useMemo, useState } from "react";

// Lapisan data pesanan & ulasan. Saat ini memakai localStorage;
// ganti isi load*/save* dengan query Supabase (tabel `orders`, `reviews`) nanti.
export type OrderStatus = "Diproses" | "Dalam Pengiriman" | "Siap Diambil" | "Selesai";

export type OrderItem = {
  productId: string;
  name: string;
  brand: string;
  price: number;
  qty: number;
};

export type Order = {
  id: string;
  createdAt: string;
  customer: string;
  /** ID pelanggan (format sheet Pelanggan, mis. CUST-03809) */
  customerId?: string;
  phone?: string;
  address?: string;
  /** kode tarif pengiriman dari sheet Layanan Purna Jual (L-01/L-02/L-03) */
  shippingCode?: string;
  shippingFee?: number;
  branch?: string;
  delivery: "Kirim ke alamat" | "Ambil di toko";
  payment: string;
  items: OrderItem[];
  total: number;
  status: OrderStatus;
  completedAt?: string;
  courier?: string;
  trackingNumber?: string;
  shippedAt?: string;
};

export type Review = {
  id: string;
  orderId: string;
  productId: string;
  customer: string;
  rating: number;
  comment: string;
  createdAt: string;
  adminReply?: string;
  hidden?: boolean;
  customerId?: string;
  branch?: string;
  /** "excel" = dibentuk dari database 2027, selain itu ulasan dari website */
  source?: "excel" | "web";
};

const ORDERS_KEY = "hartini.orders";
const REVIEWS_KEY = "hartini.reviews";

function read<T>(key: string): T[] {
  try {
    return JSON.parse(localStorage.getItem(key) || "[]") as T[];
  } catch {
    return [];
  }
}

export const loadOrders = () => read<Order>(ORDERS_KEY);
export const saveOrders = (orders: Order[]) =>
  localStorage.setItem(ORDERS_KEY, JSON.stringify(orders));
export const loadReviews = () => read<Review>(REVIEWS_KEY);
export const saveReviews = (reviews: Review[]) =>
  localStorage.setItem(REVIEWS_KEY, JSON.stringify(reviews));

/** Status berikutnya sesuai cara penerimaan barang. */
export function nextStatus(order: Order): OrderStatus | null {
  if (order.status === "Selesai") return null;
  if (order.status === "Diproses")
    return order.delivery === "Kirim ke alamat" ? "Dalam Pengiriman" : "Siap Diambil";
  return "Selesai";
}

export function newOrderId() {
  return `HTN-${Date.now().toString(36).toUpperCase()}`;
}

const OVERRIDES_KEY = "hartini.reviewOverrides";
type ReviewPatch = Pick<Review, "adminReply" | "hidden">;
let excelCache: Promise<Review[]> | null = null;
function loadExcelReviews() {
  excelCache ||= fetch(`${import.meta.env.BASE_URL}data/reviews-2027.json`)
    .then((r) => (r.ok ? (r.json() as Promise<Review[]>) : []))
    .catch(() => []);
  return excelCache;
}

/**
 * Ulasan gabungan: dari database 2027 (file statis) + ulasan baru dari website.
 * Balasan/sembunyikan oleh admin atas ulasan database disimpan sebagai override.
 */
export function useReviews() {
  const [local, setLocal] = useState<Review[]>(() => loadReviews());
  const [excel, setExcel] = useState<Review[]>([]);
  const [overrides, setOverrides] = useState<Record<string, ReviewPatch>>(() => {
    try {
      return JSON.parse(localStorage.getItem(OVERRIDES_KEY) || "{}");
    } catch {
      return {};
    }
  });
  useEffect(() => saveReviews(local), [local]);
  useEffect(() => localStorage.setItem(OVERRIDES_KEY, JSON.stringify(overrides)), [overrides]);
  useEffect(() => {
    let off = false;
    loadExcelReviews().then((r) => !off && setExcel(r));
    return () => {
      off = true;
    };
  }, []);
  const reviews = useMemo(
    () => [...local, ...excel.map((r) => (overrides[r.id] ? { ...r, ...overrides[r.id] } : r))],
    [local, excel, overrides],
  );
  const addReview = useCallback(
    (r: Review) =>
      setLocal((c) =>
        c.some((x) => x.orderId === r.orderId && x.productId === r.productId) ? c : [r, ...c],
      ),
    [],
  );
  const updateReview = useCallback((id: string, patch: Partial<Review>) => {
    setLocal((c) => {
      if (!c.some((r) => r.id === id)) {
        setOverrides((o) => ({ ...o, [id]: { ...o[id], ...patch } }));
        return c;
      }
      return c.map((r) => (r.id === id ? { ...r, ...patch } : r));
    });
  }, []);
  return { reviews, addReview, updateReview, loaded: excel.length > 0 };
}
