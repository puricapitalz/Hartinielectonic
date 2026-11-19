// Katalog, cabang & parameter dibentuk dari DB_HARTINI_toko_elektronik_2027.xlsx
// lewat scripts/build_data.py. Jangan edit src/generated/catalog.json secara manual.
import catalog from "./generated/catalog.json";

export type Product = {
  id: string;
  name: string;
  category: string;
  brand: string;
  price: number;
  cost: number;
  stock: number;
  stockMin: number;
  stockStatus: string;
  stockStart: number;
  stockIn: number;
  reorder: number;
  avgMonthly: number;
  cover: number;
  spec: string;
  warranty: number;
  supplier: string;
  sold: number;
  abc: string;
  rating: number;
  reviewCount: number;
};

export type Branch = {
  code: string;
  name: string;
  /** nama cabang seperti di Excel, mis. "Sidoarjo" */
  branch: string;
  city: string;
  province: string;
  zone: string;
  address: string;
  phone: string;
  service: string;
  head: string;
  opened: string;
  area: number;
  staff: number;
  warehouse: string;
  warehouseCapacity: number;
};

export type Tier = { name: string; min: number };
export type Tariff = { code: string; name: string; fee: number; sla: string };

export const categories = [
  "Smartphone",
  "Computer",
  "Display Panel",
  "Home Audio",
  "Refrigerator & Freezer",
  "Washer & Dryers",
  "Air Conditioner",
  "Home Appliances",
  "Kitchen Appliances",
  "Personal Care",
  "Office Equipment",
  "Digital Imaging",
  "Recording Media & Energy",
  "Hardware And Tools",
];

export const products: Product[] = catalog.products as Product[];
export const branches: Branch[] = catalog.branches as Branch[];
export const params = catalog.params as {
  ppn: number;
  rpPerPoint: number;
  tiers: Tier[];
  activeDays: number;
  lessActiveDays: number;
};
export const tariffs: Tariff[] = catalog.tariffs as Tariff[];
export const LAST_CUSTOMER_NO: number = catalog.lastCustomerNo;
export const branchNames = branches.map((b) => b.branch);

/** Tier loyalti menurut sheet Parameter: total belanja >= batas minimum. */
export function tierFor(total: number): string {
  let t = params.tiers[0].name;
  for (const x of params.tiers) if (total >= x.min) t = x.name;
  return t;
}
export const pointsFor = (total: number) => Math.floor(total / params.rpPerPoint);

export const formatPrice = (value: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);
