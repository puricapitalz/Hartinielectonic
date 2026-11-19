// Tab admin tambahan: Stok, Pelanggan, Rekonsiliasi (database Excel vs web).
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { loadExcelCustomers, type Customer } from "./auth";
import { categories, formatPrice, params, pointsFor, products, tierFor } from "./data";

const card = "rounded-2xl border border-slate-200 bg-white";

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl bg-[#F4F6FA] p-4">
      <p className="text-[11px] font-bold uppercase tracking-[.08em] text-slate-500">{label}</p>
      <p className="mt-1 font-heading text-xl font-bold tabular-nums text-[#12285C]">{value}</p>
      {hint && <p className="mt-1 text-[11px] text-slate-500">{hint}</p>}
    </div>
  );
}

function Pager({
  page,
  pages,
  setPage,
  total,
}: {
  page: number;
  pages: number;
  setPage: (n: number) => void;
  total: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
      <span>
        {total} • halaman {page + 1} dari {pages}
      </span>
      <div className="flex gap-2">
        <button
          disabled={page === 0}
          onClick={() => setPage(page - 1)}
          className="min-h-10 rounded-xl border border-slate-200 px-4 font-bold text-[#12285C] disabled:opacity-40"
        >
          Sebelumnya
        </button>
        <button
          disabled={page >= pages - 1}
          onClick={() => setPage(page + 1)}
          className="min-h-10 rounded-xl border border-slate-200 px-4 font-bold text-[#12285C] disabled:opacity-40"
        >
          Berikutnya
        </button>
      </div>
    </div>
  );
}

// ---------- STOK ----------
const STOCK_STYLE: Record<string, string> = {
  HABIS: "bg-red-50 text-red-700",
  KRITIS: "bg-orange-50 text-orange-700",
  MENIPIS: "bg-amber-50 text-amber-800",
  AMAN: "bg-emerald-50 text-emerald-700",
  OVERSTOCK: "bg-blue-50 text-blue-700",
};
const STOCK_ORDER = ["HABIS", "KRITIS", "MENIPIS", "AMAN", "OVERSTOCK"];

export function AdminStock({ branch }: { branch?: string }) {
  const [status, setStatus] = useState("Semua");
  const [cat, setCat] = useState("Semua");
  const [q, setQ] = useState("");
  const count = (s: string) => products.filter((p) => p.stockStatus === s).length;
  const list = products
    .filter(
      (p) =>
        (status === "Semua" || p.stockStatus === status) &&
        (cat === "Semua" || p.category === cat) &&
        (!q || `${p.id} ${p.name} ${p.brand}`.toLowerCase().includes(q.toLowerCase())),
    )
    .sort(
      (a, b) =>
        STOCK_ORDER.indexOf(a.stockStatus) - STOCK_ORDER.indexOf(b.stockStatus) ||
        a.cover - b.cover,
    );
  const reorderCost = products.reduce((s, p) => s + p.reorder * p.cost, 0);
  const stockValue = products.reduce((s, p) => s + p.stock * p.cost, 0);
  return (
    <div className="space-y-5">
      <p className="text-xs leading-5 text-slate-500">
        Sumber: sheet “Stok Inventory” per 31 Desember 2027. Stok dikelola terpusat untuk seluruh
        cabang{branch ? `, termasuk ${branch}` : ""}. Rekomendasi order = rata-rata jual × (target
        cover {2} bulan + lead time {1} bulan) − stok akhir.
      </p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {STOCK_ORDER.map((s) => (
          <button
            key={s}
            onClick={() => setStatus(status === s ? "Semua" : s)}
            className="text-left"
          >
            <Stat
              label={s}
              value={`${count(s)} SKU`}
              hint={status === s ? "filter aktif" : undefined}
            />
          </button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Stat label="Nilai stok (harga beli)" value={formatPrice(stockValue)} />
        <Stat label="Estimasi biaya order ulang" value={formatPrice(reorderCost)} />
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <input
          id="stock-q"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="field"
          placeholder="Cari SKU / produk"
          aria-label="Cari produk"
        />
        <select
          id="stock-cat"
          value={cat}
          onChange={(e) => setCat(e.target.value)}
          className="field"
          aria-label="Kategori"
        >
          <option>Semua</option>
          {categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <select
          id="stock-status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="field"
          aria-label="Status stok"
        >
          {["Semua", ...STOCK_ORDER].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>
      <div className={`${card} overflow-x-auto`}>
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-[#F4F6FA] text-xs text-slate-500">
            <tr>
              <th className="p-3">Produk</th>
              <th className="p-3 text-right">Stok akhir</th>
              <th className="p-3 text-right">Minimum</th>
              <th className="p-3 text-right">Jual / bulan</th>
              <th className="p-3 text-right">Cukup (bulan)</th>
              <th className="p-3">Status</th>
              <th className="p-3 text-right">Order ulang</th>
            </tr>
          </thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id} className="border-t border-slate-100 tabular-nums">
                <td className="max-w-[280px] p-3">
                  <strong className="block truncate text-[#12285C]">{p.name}</strong>
                  <span className="text-xs text-slate-400">
                    {p.id} • {p.category} • {p.supplier}
                  </span>
                </td>
                <td className="p-3 text-right font-bold">{p.stock.toLocaleString("id-ID")}</td>
                <td className="p-3 text-right">{p.stockMin.toLocaleString("id-ID")}</td>
                <td className="p-3 text-right">{p.avgMonthly.toLocaleString("id-ID")}</td>
                <td className="p-3 text-right">
                  {p.cover.toLocaleString("id-ID", { maximumFractionDigits: 1 })}
                </td>
                <td className="p-3">
                  <span
                    className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${STOCK_STYLE[p.stockStatus]}`}
                  >
                    {p.stockStatus}
                  </span>
                </td>
                <td className="p-3 text-right">
                  {p.reorder > 0 ? (
                    <>
                      <b>{p.reorder.toLocaleString("id-ID")} unit</b>
                      <span className="block text-xs text-slate-400">
                        {formatPrice(p.reorder * p.cost)}
                      </span>
                    </>
                  ) : (
                    <span className="text-slate-400">-</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.length === 0 && <p className="p-6 text-sm text-slate-500">Tidak ada produk.</p>}
      </div>
    </div>
  );
}

// ---------- PELANGGAN ----------
function readAccounts(): Customer[] {
  try {
    return JSON.parse(localStorage.getItem("hartini.accounts") || "[]");
  } catch {
    return [];
  }
}

export function AdminCustomers({ branch }: { branch?: string }) {
  const [excel, setExcel] = useState<Customer[] | null>(null);
  const [q, setQ] = useState("");
  const [tier, setTier] = useState("Semua");
  const [page, setPage] = useState(0);
  useEffect(() => {
    loadExcelCustomers()
      .then(setExcel)
      .catch(() => setExcel([]));
  }, []);
  useEffect(() => setPage(0), [q, tier]);
  const all = useMemo(
    () => [...readAccounts(), ...(excel ?? [])].filter((c) => !branch || c.branch === branch),
    [excel, branch],
  );
  const list = all.filter(
    (c) =>
      (tier === "Semua" || tierFor(c.baseTotal) === tier) &&
      (!q || `${c.id} ${c.name} ${c.city} ${c.email}`.toLowerCase().includes(q.toLowerCase())),
  );
  const PAGE = 25;
  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  if (!excel) return <div className="skeleton h-64 rounded-2xl" />;
  return (
    <div className="space-y-5">
      <p className="text-xs leading-5 text-slate-500">
        Sumber: sheet “Pelanggan” ditambah akun baru yang mendaftar lewat Google di website. Tingkat
        member: Silver mulai {formatPrice(params.tiers[1].min)}, Gold mulai{" "}
        {formatPrice(params.tiers[2].min)}, Platinum mulai {formatPrice(params.tiers[3].min)} total
        belanja; 1 poin per {formatPrice(params.rpPerPoint)}.
      </p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat
          label="Total pelanggan"
          value={all.length.toLocaleString("id-ID")}
          hint={branch ? `cabang asal ${branch}` : "seluruh cabang"}
        />
        {params.tiers.map((t) => (
          <button
            key={t.name}
            onClick={() => setTier(tier === t.name ? "Semua" : t.name)}
            className="text-left"
          >
            <Stat
              label={t.name}
              value={all
                .filter((c) => tierFor(c.baseTotal) === t.name)
                .length.toLocaleString("id-ID")}
              hint={tier === t.name ? "filter aktif" : undefined}
            />
          </button>
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <input
          id="cust-q"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="field"
          placeholder="Cari ID, nama, kota, email"
          aria-label="Cari pelanggan"
        />
        <select
          id="cust-tier"
          value={tier}
          onChange={(e) => setTier(e.target.value)}
          className="field"
          aria-label="Tingkat member"
        >
          {["Semua", ...params.tiers.map((t) => t.name)].map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </div>
      <div className={`${card} overflow-x-auto`}>
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className="bg-[#F4F6FA] text-xs text-slate-500">
            <tr>
              <th className="p-3">Pelanggan</th>
              <th className="p-3">Cabang asal</th>
              <th className="p-3">Tipe</th>
              <th className="p-3">Tier</th>
              <th className="p-3 text-right">Total belanja</th>
              <th className="p-3 text-right">Poin</th>
              <th className="p-3">Terakhir belanja</th>
            </tr>
          </thead>
          <tbody>
            {list.slice(page * PAGE, page * PAGE + PAGE).map((c) => (
              <tr key={c.id} className="border-t border-slate-100 tabular-nums">
                <td className="p-3">
                  <strong className="block text-[#12285C]">{c.name}</strong>
                  <span className="text-xs text-slate-400">
                    {c.id} • {c.city} {c.source === "google" && "• daftar via Google"}
                  </span>
                </td>
                <td className="p-3 text-slate-500">{c.branch}</td>
                <td className="p-3 text-slate-500">{c.type}</td>
                <td className="p-3 font-bold">{tierFor(c.baseTotal)}</td>
                <td className="p-3 text-right">{formatPrice(c.baseTotal)}</td>
                <td className="p-3 text-right">{pointsFor(c.baseTotal).toLocaleString("id-ID")}</td>
                <td className="p-3 text-xs text-slate-500">
                  {c.lastPurchase ? new Date(c.lastPurchase).toLocaleDateString("id-ID") : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager
        page={page}
        pages={pages}
        setPage={setPage}
        total={`${list.length.toLocaleString("id-ID")} pelanggan`}
      />
    </div>
  );
}

// ---------- REKONSILIASI ----------
type Recon = {
  doubleInvoice: { count: number; ppn: number };
  noInvoice: { count: number; omzet: number; ppn: number };
  ppnInvoice: number;
  ppnShould: number;
  returns: { claims: number; done: number; inProcess: number; omzet: number; hpp: number };
  shippingCityFee: { count: number; total: number; fee: number };
  cancelledOrders: { count: number; header: number; lines: number; lineTotal: number };
  catalog: { web: number; excel: number };
  oldestBranch: { name: string; opened: string };
};

const n = (v: number) => v.toLocaleString("id-ID");
const M = (v: number) => `Rp${(v / 1e9).toLocaleString("id-ID", { maximumFractionDigits: 2 })} M`;
const jt = (v: number) => `Rp${(v / 1e6).toLocaleString("id-ID", { maximumFractionDigits: 2 })} jt`;

export function AdminRecon() {
  const [r, setR] = useState<Recon | null>(null);
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/recon-2027.json`)
      .then((x) => x.json())
      .then(setR)
      .catch(() => setR(null));
  }, []);
  if (!r) return <div className="skeleton h-64 rounded-2xl" />;
  const top = [...products].sort((a, b) => b.sold - a.sold).slice(0, 2);
  const items: Array<{
    area: string;
    title: string;
    finding: ReactNode;
    impact: ReactNode;
    action: ReactNode;
    web: "Diperbaiki di web" | "Perlu koreksi di Excel";
  }> = [
    {
      area: "Pajak",
      title: "Faktur ganda untuk transaksi cicilan",
      finding: (
        <>
          {n(r.doubleInvoice.count)} transaksi cicilan punya dua invoice sekaligus (jenis
          “Penjualan” dan “Cicilan”), keduanya mencatat PPN.
        </>
      ),
      impact: (
        <>
          PPN tercatat dua kali sebesar <b>{M(r.doubleInvoice.ppn)}</b>.
        </>
      ),
      action: (
        <>
          Faktur “Cicilan” cukup sebagai dokumen penagihan ke mitra pembiayaan tanpa PPN; PPN hanya
          di faktur “Penjualan”.
        </>
      ),
      web: "Perlu koreksi di Excel",
    },
    {
      area: "Pajak",
      title: "Transaksi ritel tanpa invoice",
      finding: (
        <>
          {n(r.noInvoice.count)} transaksi ritel senilai {M(r.noInvoice.omzet)} tidak punya invoice
          sama sekali.
        </>
      ),
      impact: (
        <>
          PPN sekitar <b>{M(r.noInvoice.ppn)}</b> tidak tercatat. Gabungan dengan temuan 1: PPN di
          invoice {M(r.ppnInvoice)}, seharusnya sekitar {M(r.ppnShould)}.
        </>
      ),
      action: (
        <>Terbitkan faktur untuk semua penjualan (termasuk ritel tunai), satu faktur per nota.</>
      ),
      web: "Perlu koreksi di Excel",
    },
    {
      area: "Penjualan",
      title: "Retur belum mengurangi omzet",
      finding: (
        <>
          Dasbor sebelumnya menulis retur Rp0, padahal sheet klaim mencatat {r.returns.claims} klaim
          refund/retur ({r.returns.done} selesai, {r.returns.inProcess} masih proses).
        </>
      ),
      impact: (
        <>
          Omzet bersih terlalu tinggi <b>{jt(r.returns.omzet)}</b>; HPP ikut berkurang{" "}
          {jt(r.returns.hpp)} karena barang kembali.
        </>
      ),
      action: (
        <>
          Sekarang tab Retur & Laporan Keuangan membaca sheet klaim; hanya klaim Selesai yang
          dihitung.
        </>
      ),
      web: "Diperbaiki di web",
    },
    {
      area: "Katalog",
      title: "Angka “terjual” tidak cocok",
      finding: (
        <>
          Situs menampilkan angka terjual buatan. Contoh: mesin cuci tertulis ribuan unit, padahal
          di database hanya puluhan sampai ratusan.
        </>
      ),
      impact: (
        <>
          Produk “terlaris” di situs bukan yang terlaris. Di database:{" "}
          {top.map((p) => `${p.name} (${n(p.sold)} unit)`).join(" dan ")}.
        </>
      ),
      action: <>Angka terjual, rating, dan urutan terlaris kini dari sheet Analisis Produk.</>,
      web: "Diperbaiki di web",
    },
    {
      area: "Katalog",
      title: "Katalog hanya sebagian",
      finding: (
        <>
          Situs hanya menampilkan {r.catalog.web} produk, database berisi {r.catalog.excel} SKU.
        </>
      ),
      impact: <>Sebagian besar produk tidak bisa dibeli online.</>,
      action: (
        <>
          Katalog kini memuat seluruh {r.catalog.excel} SKU, lengkap dengan stok dan status dari
          sheet Stok Inventory.
        </>
      ),
      web: "Diperbaiki di web",
    },
    {
      area: "Pengiriman",
      title: "Janji gratis ongkir bertentangan dengan tagihan",
      finding: (
        <>
          Situs menjanjikan gratis ongkir hingga 20 km, tetapi database mencatat{" "}
          {n(r.shippingCityFee.count)} tagihan “Pengiriman Dalam Kota”{" "}
          {formatPrice(r.shippingCityFee.fee)}.
        </>
      ),
      impact: <>Total tagihan {jt(r.shippingCityFee.total)} yang tidak sesuai janji di situs.</>,
      action: (
        <>
          Situs kini memakai tarif resmi dari sheet Layanan Purna Jual (dalam kota, luar kota, antar
          pulau). Ambil di toko tetap gratis.
        </>
      ),
      web: "Diperbaiki di web",
    },
    {
      area: "Layanan",
      title: "Order layanan batal masih bernilai",
      finding: (
        <>
          {n(r.cancelledOrders.count)} order layanan dibatalkan bernilai Rp0 di header, tetapi{" "}
          {n(r.cancelledOrders.lines)} baris detailnya masih bernilai{" "}
          {jt(r.cancelledOrders.lineTotal)}.
        </>
      ),
      impact: (
        <>Pendapatan layanan bisa terhitung lebih tinggi jika laporan memakai sheet detail.</>
      ),
      action: (
        <>Nolkan subtotal detail atau beri kolom status batal di sheet Detail Transaksi Layanan.</>
      ),
      web: "Perlu koreksi di Excel",
    },
    {
      area: "Profil",
      title: "Tahun berdiri tidak cocok",
      finding: (
        <>
          Situs menyebut berdiri sejak 1998, cabang tertua di database ({r.oldestBranch.name})
          dibuka {new Date(r.oldestBranch.opened).getFullYear()}.
        </>
      ),
      impact: <>Bisa dipertanyakan saat presentasi.</>,
      action: (
        <>
          Halaman Tentang Kami kini menjelaskan: usaha keluarga sejak 1998, toko pertama pindah ke
          format cabang modern di Jakarta pada 2012.
        </>
      ),
      web: "Diperbaiki di web",
    },
  ];
  const fixed = items.filter((i) => i.web === "Diperbaiki di web").length;
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Temuan" value={String(items.length)} />
        <Stat label="Sudah diperbaiki di web" value={String(fixed)} />
        <Stat
          label="Perlu koreksi di Excel"
          value={String(items.length - fixed)}
          hint="sumber data, bukan tampilan web"
        />
      </div>
      <ol className="grid gap-3">
        {items.map((it, i) => (
          <li key={it.title} className={`${card} grid gap-3 p-5 lg:grid-cols-[240px_1fr]`}>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[.08em] text-slate-500">
                {i + 1}. {it.area}
              </p>
              <h3 className="mt-1 font-heading font-bold text-[#12285C]">{it.title}</h3>
              <span
                className={`mt-2 inline-block rounded-full px-2.5 py-1 text-[11px] font-bold ${it.web === "Diperbaiki di web" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}
              >
                {it.web}
              </span>
            </div>
            <dl className="grid gap-2 text-sm leading-6 text-slate-700 sm:grid-cols-3">
              <div>
                <dt className="text-[11px] font-bold uppercase tracking-[.06em] text-slate-400">
                  Temuan
                </dt>
                <dd>{it.finding}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-bold uppercase tracking-[.06em] text-slate-400">
                  Dampak
                </dt>
                <dd>{it.impact}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-bold uppercase tracking-[.06em] text-slate-400">
                  Tindak lanjut
                </dt>
                <dd>{it.action}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ol>
      <p className="text-[11px] text-slate-500">
        Angka dihitung ulang otomatis dari Excel oleh scripts/build_data.py. PPN “seharusnya” =
        omzet seluruh penjualan × {params.ppn * 100}/{100 + params.ppn * 100} ditambah PPN invoice
        layanan.
      </p>
    </div>
  );
}
