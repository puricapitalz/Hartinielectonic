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
  /** bulan: lead time supplier, target stok cover, batas overstock */
  leadTime: number;
  coverTarget: number;
  overstock: number;
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

// ---------- pengiriman: tarif ditentukan dari asal (cabang) dan tujuan ----------
/** 38 provinsi Indonesia dan pulau/kelompok pulaunya. Beda pulau = pengiriman kapal. */
export const PROVINCE_ISLAND: Record<string, string> = {
  Aceh: "Sumatera",
  "Sumatera Utara": "Sumatera",
  "Sumatera Barat": "Sumatera",
  Riau: "Sumatera",
  Jambi: "Sumatera",
  "Sumatera Selatan": "Sumatera",
  Bengkulu: "Sumatera",
  Lampung: "Sumatera",
  "Kepulauan Riau": "Kepulauan Riau",
  "Kepulauan Bangka Belitung": "Bangka Belitung",
  "DKI Jakarta": "Jawa",
  "Jawa Barat": "Jawa",
  Banten: "Jawa",
  "Jawa Tengah": "Jawa",
  "DI Yogyakarta": "Jawa",
  "Jawa Timur": "Jawa",
  Bali: "Bali",
  "Nusa Tenggara Barat": "Nusa Tenggara Barat",
  "Nusa Tenggara Timur": "Nusa Tenggara Timur",
  "Kalimantan Barat": "Kalimantan",
  "Kalimantan Tengah": "Kalimantan",
  "Kalimantan Selatan": "Kalimantan",
  "Kalimantan Timur": "Kalimantan",
  "Kalimantan Utara": "Kalimantan",
  "Sulawesi Utara": "Sulawesi",
  Gorontalo: "Sulawesi",
  "Sulawesi Tengah": "Sulawesi",
  "Sulawesi Barat": "Sulawesi",
  "Sulawesi Selatan": "Sulawesi",
  "Sulawesi Tenggara": "Sulawesi",
  Maluku: "Maluku",
  "Maluku Utara": "Maluku Utara",
  Papua: "Papua",
  "Papua Barat": "Papua",
  "Papua Barat Daya": "Papua",
  "Papua Tengah": "Papua",
  "Papua Pegunungan": "Papua",
  "Papua Selatan": "Papua",
};
export const provinces = Object.keys(PROVINCE_ISLAND);

/** "Kota Surabaya", "Kab. Sidoarjo", "Jakarta Barat" -> bentuk baku untuk dibandingkan. */
export function normCity(city: string) {
  const c = city
    .toLowerCase()
    .replace(/^(kota|kab\.?|kabupaten)\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
  return c.startsWith("jakarta") ? "jakarta" : c;
}

export type ShippingQuote = { tariff: Tariff; reason: string };

/**
 * Tarif resmi (sheet Layanan Purna Jual) dari cabang pengirim ke alamat tujuan:
 * kota sama = L-01 Dalam Kota; beda kota di pulau yang sama = L-02 Luar Kota /
 * Antar Kabupaten; beda pulau = L-03 Antar Pulau (kapal).
 */
export function quoteShipping(from: Branch, destCity: string, destProvince: string): ShippingQuote {
  const [inCity, outCity, island] = ["L-01", "L-02", "L-03"].map((code) =>
    tariffs.find((t) => t.code === code)!,
  );
  const fromIsland = PROVINCE_ISLAND[from.province];
  const toIsland = PROVINCE_ISLAND[destProvince];
  if (destProvince === from.province && normCity(destCity) === normCity(from.city))
    return { tariff: inCity, reason: `Satu kota dengan cabang ${from.branch}` };
  if (fromIsland && fromIsland === toIsland)
    return { tariff: outCity, reason: `${from.city} ke ${destCity}, sama-sama di ${toIsland}` };
  return {
    tariff: island,
    reason: `${from.city} (${fromIsland}) ke ${destCity} (${toIsland ?? destProvince}), beda pulau`,
  };
}

/** Cabang terdekat untuk alamat tujuan: satu kota, lalu satu provinsi, lalu satu pulau. */
export function nearestBranch(destCity: string, destProvince: string): Branch {
  const c = normCity(destCity);
  return (
    branches.find((b) => b.province === destProvince && normCity(b.city) === c) ??
    branches.find((b) => b.province === destProvince) ??
    branches.find((b) => PROVINCE_ISLAND[b.province] === PROVINCE_ISLAND[destProvince]) ??
    branches.find((b) => b.branch === "Jakarta")!
  );
}
