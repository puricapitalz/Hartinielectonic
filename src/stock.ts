// Stok yang bergerak. Titik awal = "Stok Akhir" sheet Stok Inventory (31 Des 2027).
// Pesanan web mengurangi stok; retur yang barangnya masih layak jual menambah stok.
// Status & rekomendasi order memakai rumus yang sama dengan sheet Stok Inventory.
import { createContext, useContext, useMemo } from "react";
import { params, products } from "./data";
import { useLocalReturns, type ReturnEntry } from "./finance";
import type { Order } from "./orders";

/** Alasan retur yang barangnya kembali ke rak (layak jual). Barang rusak tidak. */
export const RESALEABLE_REASONS = [
  "Tidak sesuai pesanan",
  "Salah tipe / ukuran",
  "Pembeli berubah pikiran",
];
export const isResaleable = (r: ReturnEntry) =>
  r.source !== "excel" && RESALEABLE_REASONS.includes(r.reason);

export type StockStatus = "HABIS" | "KRITIS" | "MENIPIS" | "AMAN" | "OVERSTOCK";
export type LiveStock = {
  /** stok akhir di Excel */
  base: number;
  /** unit keluar karena pesanan web */
  out: number;
  /** unit kembali dari retur layak jual */
  back: number;
  stock: number;
  status: StockStatus;
  cover: number;
  reorder: number;
};

/** Rumus sheet Stok Inventory: kolom Stock Cukup, Status, Rekomendasi Order. */
export function evalStock(stock: number, min: number, soldPerYear: number) {
  const avg = soldPerYear / 12;
  const cover = avg === 0 ? 99 : Math.min(99, stock / avg);
  const status: StockStatus =
    stock <= 0
      ? "HABIS"
      : stock <= min
        ? "KRITIS"
        : cover < params.coverTarget
          ? "MENIPIS"
          : cover >= params.overstock
            ? "OVERSTOCK"
            : "AMAN";
  const reorder =
    status === "HABIS" || status === "KRITIS" || status === "MENIPIS"
      ? Math.max(0, Math.ceil(avg * (params.coverTarget + params.leadTime) - stock - 1e-9))
      : 0;
  return { cover, status, reorder };
}

export function computeStock(orders: Order[], returns: ReturnEntry[]) {
  const out: Record<string, number> = {};
  for (const o of orders)
    for (const i of o.items) out[i.productId] = (out[i.productId] || 0) + i.qty;
  const back: Record<string, number> = {};
  for (const r of returns) if (isResaleable(r)) back[r.sku] = (back[r.sku] || 0) + r.qty;
  const map: Record<string, LiveStock> = {};
  for (const p of products) {
    const stock = p.stock - (out[p.id] || 0) + (back[p.id] || 0);
    map[p.id] = {
      base: p.stock,
      out: out[p.id] || 0,
      back: back[p.id] || 0,
      stock,
      ...evalStock(stock, p.stockMin, p.sold),
    };
  }
  return map;
}

export function useStockMap(orders: Order[]) {
  const returns = useLocalReturns();
  return useMemo(() => computeStock(orders, returns), [orders, returns]);
}

export const StockContext = createContext<Record<string, LiveStock>>(computeStock([], []));
export const useLiveStock = () => useContext(StockContext);
