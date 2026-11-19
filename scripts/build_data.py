"""Konversi DB_HARTINI_toko_elektronik_2027.xlsx menjadi data untuk website.

Pemakaian:
    python3 scripts/build_data.py path/ke/DB_HARTINI_toko_elektronik_2027.xlsx

Menghasilkan:
    src/generated/catalog.json     produk, cabang, parameter (diimpor langsung oleh web)
    public/data/sales-2027.json    transaksi, biaya operasional, retur, pengiriman
    public/data/customers-2027.json pelanggan (sheet Pelanggan)
    public/data/reviews-2027.json  ulasan (dibentuk dari pengiriman selesai & retur)
    public/data/recon-2027.json    angka rekonsiliasi Excel vs web

Ulasan TIDAK ada di Excel. Script membuatnya secara deterministik:
  - transaksi yang pengirimannya Selesai  -> bintang 3-5
  - transaksi yang diretur (klaim Refund / Retur) -> bintang 1-2
"""

import hashlib
import json
import math
import sys
from datetime import datetime, timedelta
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
EPOCH = datetime(1899, 12, 30)
REF = datetime(2027, 12, 31)


def serial(d):
    if d is None or (isinstance(d, float) and math.isnan(d)) or pd.isna(d):
        return None
    return (pd.Timestamp(d).to_pydatetime() - EPOCH).days


def num(v, digits=None):
    if v is None or pd.isna(v):
        return 0
    v = float(v)
    if digits is None:
        return int(round(v)) if abs(v - round(v)) < 1e-9 else v
    return round(v, digits)


def h(text):
    """Bilangan semu-acak 0..1 yang tetap untuk teks yang sama."""
    return int(hashlib.md5(text.encode()).hexdigest()[:8], 16) / 0xFFFFFFFF


def pick(options, key):
    return options[int(h(key) * len(options)) % len(options)]


def main(xlsx):
    sheets = [
        "Parameter", "Data Cabang", "Master Produk", "Data Penjualan 2027", "Stok Inventory",
        "Pelanggan", "Biaya Operasional", "Transaksi Layanan", "Detail Transaksi Layanan",
        "Keluhan & Klaim Garansi", "Invoice", "Kontrak Cicilan", "Layanan Purna Jual", "Analisis Produk",
    ]
    # No. HP & telepon dibaca sebagai teks supaya angka 0 di depan tidak hilang
    text_cols = {"Pelanggan": {"No. HP": str}, "Data Cabang": {"Telepon": str}}
    x = {s: pd.read_excel(xlsx, sheet_name=s, dtype=text_cols.get(s)) for s in sheets}

    # ---------- parameter ----------
    par = dict(zip(x["Parameter"].iloc[:, 0], x["Parameter"].iloc[:, 1]))
    params = {
        "ppn": num(par["Tarif PPN"], 4),
        "rpPerPoint": num(par["Rupiah per 1 Poin Member"]),
        "tiers": [
            {"name": "Bronze", "min": 0},
            {"name": "Silver", "min": num(par["Tier Silver - min. total belanja (Rp)"])},
            {"name": "Gold", "min": num(par["Tier Gold - min. total belanja (Rp)"])},
            {"name": "Platinum", "min": num(par["Tier Platinum - min. total belanja (Rp)"])},
        ],
        "activeDays": num(par["Status Aktif - maks. hari sejak belanja terakhir"]),
        "lessActiveDays": num(par["Status Kurang Aktif - maks. hari sejak belanja terakhir"]),
    }
    svc = x["Layanan Purna Jual"]
    tariffs = [
        {"code": r["Kode Layanan"], "name": r["Nama Layanan"], "fee": num(r["Tarif Standar (Rp)"]), "sla": r["Keterangan / SLA"]}
        for _, r in svc[svc["Jenis Layanan"] == "Pengiriman"].iterrows()
    ]

    # ---------- cabang ----------
    service_by_zone = {"A": "Pengiriman & instalasi", "B": "Genset & power station", "C": "Solar panel & power station"}
    branches = []
    for _, r in x["Data Cabang"].iterrows():
        branches.append({
            "code": r["Kode Cabang"],
            "name": f"Hartini {r['Nama Cabang']}",
            "branch": r["Nama Cabang"],
            "city": r["Kota"],
            "province": r["Provinsi"],
            "zone": r["Zona Wilayah"],
            "address": r["Alamat Toko"],
            "phone": str(r["Telepon"]),
            "service": service_by_zone.get(str(r["Zona Wilayah"])[0], "Pengiriman & instalasi"),
            "head": r["Kepala Cabang"],
            "opened": pd.Timestamp(r["Tanggal Buka"]).strftime("%Y-%m-%d"),
            "area": num(r["Luas Toko (m2)"]),
            "staff": num(r["Jumlah Pegawai"]),
            "warehouse": r["Kode Gudang"],
            "warehouseCapacity": num(r["Kapasitas Gudang (unit)"]),
        })

    # ---------- penjualan ----------
    S = x["Data Penjualan 2027"]
    rows = [
        [
            r["Nomor Transaksi"], serial(r["Tanggal"]), r["Cabang"], r["SKU"], num(r["Quantity (Unit Terjual)"]),
            num(r["Harga Jual (Rp)"]), num(r["Diskon %"], 4), num(r["Omzet (Rp)"]), num(r["HPP (Rp)"]),
            r["Metode Bayar"], r["Segmen"], r["ID Pelanggan"], r["Status Pembayaran"],
        ]
        for _, r in S.iterrows()
    ]
    trx = S.set_index("Nomor Transaksi")

    master = x["Master Produk"].set_index("SKU")
    skus = {sku: [r["Nama Produk"], r["Kategori"], num(r["Harga Beli (Rp)"])] for sku, r in master.iterrows()}

    opex = [
        [num(r["No Bulan"]), r["Cabang"], num(r["Gaji & Tunjangan (Rp)"]), num(r["Sewa (Rp)"]), num(r["Listrik & Air (Rp)"]),
         num(r["Marketing & Promosi (Rp)"]), num(r["Logistik & Pengiriman (Rp)"]), num(r["Lain-lain (Rp)"])]
        for _, r in x["Biaya Operasional"].iterrows()
        if isinstance(r["No Bulan"], (int, float)) and not pd.isna(r["No Bulan"]) and isinstance(r["Cabang"], str)
    ]

    # ---------- retur (klaim Refund / Retur), 1 unit per klaim ----------
    K = x["Keluhan & Klaim Garansi"]
    ret_rows = K[K["Penanganan"] == "Refund / Retur"]
    returns = []
    for _, r in ret_rows.iterrows():
        t = trx.loc[r["Nomor Transaksi"]]
        unit_omzet = num(t["Omzet (Rp)"]) / num(t["Quantity (Unit Terjual)"])
        returns.append({
            "id": r["No Klaim"], "ref": r["Nomor Transaksi"], "source": "excel", "branch": r["Cabang"],
            "sku": r["SKU"], "name": r["Nama Produk"], "qty": 1, "omzet": round(unit_omzet),
            "hpp": num(t["Harga Beli (Rp)"]), "customer": r["ID Pelanggan"],
            "claimDate": pd.Timestamp(r["Tanggal Klaim"]).strftime("%Y-%m-%d"),
            "date": pd.Timestamp(r["Tanggal Selesai"] if not pd.isna(r["Tanggal Selesai"]) else r["Tanggal Klaim"]).strftime("%Y-%m-%d"),
            "reason": r["Jenis Keluhan"], "status": r["Status Penanganan"], "pic": r["Teknisi / PIC"],
        })

    # ---------- pengiriman (Transaksi Layanan + detail L-01/L-02/L-03) ----------
    L = x["Transaksi Layanan"].set_index("No Order Layanan")
    D = x["Detail Transaksi Layanan"]
    ship_d = D[D["Kode Layanan"].isin([t["code"] for t in tariffs])]
    ship = {}
    for _, d in ship_d.iterrows():
        o = L.loc[d["No Order Layanan"]]
        ship[o["Nomor Transaksi Terkait"]] = [
            d["No Order Layanan"], d["Kode Layanan"], o["Status Layanan"], serial(o["Tanggal Order"]),
            serial(o["Tanggal Selesai"]), num(d["Subtotal (Rp)"]), d["Teknisi / Petugas"],
        ]

    # ---------- pelanggan ----------
    P = x["Pelanggan"]
    customers = [
        [r["ID Pelanggan"], r["Nama"], r["Kota"], r["Cabang Asal"], serial(r["Tanggal Bergabung"]), num(r["Total Belanja (Rp)"]),
         num(r["Jumlah Transaksi"]), serial(r["Terakhir Belanja"]), r["Tier Loyalti"], r["Status Aktivitas"],
         r["Tipe Pelanggan"], str(r["No. HP"]), r["Email"], r["Alamat"], num(r["Poin Member"])]
        for _, r in P.iterrows()
    ]
    cust_name = dict(zip(P["ID Pelanggan"], P["Nama"]))

    # ---------- ulasan ----------
    praise = {
        5: ["Barang sampai dengan aman dan sesuai pesanan. Mantap!", "Pengiriman cepat, kurir ramah, produk original. Sangat puas.",
            "Kualitas sesuai harga, packing rapi. Recommended belanja di Hartini.", "Sudah dipakai beberapa hari, lancar tanpa kendala. Terima kasih!",
            "Pelayanan cabang sangat membantu, barang langsung diantar ke rumah."],
        4: ["Produk bagus, hanya pengiriman agak molor sehari.", "Sesuai deskripsi. Kardus sedikit penyok tapi barang aman.",
            "Barang oke, kurir sempat telepon untuk konfirmasi alamat. Puas.", "Harga bersaing, fungsi normal. Semoga awet."],
        3: ["Barang sesuai, tapi jadwal pengiriman berubah dua kali.", "Produk berfungsi, namun buku manual tidak lengkap.",
            "Cukup, tidak ada yang istimewa. Pengiriman memakan waktu lebih lama dari perkiraan."],
    }
    complaint = {
        1: ["Kecewa, produk bermasalah sejak awal sehingga harus diretur.", "Unit rusak, proses retur juga makan waktu. Tidak puas.",
            "Barang tidak sesuai harapan, akhirnya minta refund."],
        2: ["Produk sempat bermasalah dan diretur. Pelayanan retur cukup baik.", "Kualitas kurang, tapi toko bertanggung jawab memproses retur.",
            "Ada cacat pada unit, untung retur dibantu staf cabang."],
    }
    replies = {
        "low": "Mohon maaf atas ketidaknyamanannya. Tim kami telah memproses retur dan akan meningkatkan kontrol kualitas sebelum pengiriman.",
        "mid": "Terima kasih atas masukannya. Kami akan memperbaiki ketepatan jadwal pengiriman.",
    }
    returned_trx = {r["ref"]: r for r in returns}
    reviews = []
    for t_no, s in ship.items():
        if s[2] != "Selesai" or t_no in returned_trx:
            continue
        t = trx.loc[t_no]
        roll = h(t_no + "rate")
        rating = 5 if roll < 0.55 else 4 if roll < 0.9 else 3
        done = EPOCH + timedelta(days=s[4] or s[3])
        when = min(done + timedelta(days=1 + int(h(t_no + "d") * 5)), REF)
        rv = {
            "id": f"RVW-{t_no}", "orderId": t_no, "productId": t["SKU"], "customerId": t["ID Pelanggan"],
            "customer": cust_name.get(t["ID Pelanggan"], "Pelanggan"), "rating": rating,
            "comment": pick(praise[rating], t_no), "createdAt": when.strftime("%Y-%m-%dT10:00:00"), "branch": t["Cabang"], "source": "excel",
        }
        if rating == 3 and h(t_no + "rep") < 0.6:
            rv["adminReply"] = replies["mid"]
        reviews.append(rv)
    for r in returns:
        rating = 1 if h(r["id"] + "rate") < 0.5 else 2
        when = datetime.strptime(r["date"], "%Y-%m-%d")
        rv = {
            "id": f"RVW-{r['id']}", "orderId": r["ref"], "productId": r["sku"], "customerId": r["customer"],
            "customer": cust_name.get(r["customer"], "Pelanggan"), "rating": rating,
            "comment": f"{pick(complaint[rating], r['id'])} Keluhan: {r['reason'].lower()}.", "createdAt": when.strftime("%Y-%m-%dT10:00:00"),
            "branch": r["branch"], "source": "excel",
        }
        if r["status"] == "Selesai":
            rv["adminReply"] = replies["low"]
        reviews.append(rv)
    reviews.sort(key=lambda r: r["createdAt"], reverse=True)

    # ---------- produk ----------
    stok = x["Stok Inventory"].set_index("SKU")
    ana = x["Analisis Produk"].set_index("SKU")
    rating_by = {}
    for rv in reviews:
        rating_by.setdefault(rv["productId"], []).append(rv["rating"])
    products = []
    for sku, r in master.iterrows():
        st = stok.loc[sku]
        rs = rating_by.get(sku, [])
        products.append({
            "id": sku, "name": r["Nama Produk"], "category": r["Kategori"], "brand": r["Merek"],
            "price": num(r["Harga Jual (Rp)"]), "cost": num(r["Harga Beli (Rp)"]),
            "stock": num(st["Stok Akhir"]), "stockMin": num(st["Stok Minimum"]), "stockStatus": st["Status"],
            "stockStart": num(st["Stok Awal"]), "stockIn": num(st["Barang Masuk"]), "reorder": num(st["Rekomendasi Order (Unit)"]),
            "avgMonthly": num(st["Rata-rata Jual / Bulan"], 2), "cover": num(st["Stock Cukup (bulan)"], 2),
            "spec": r["Spesifikasi"], "warranty": num(r["Masa Garansi (bulan)"]), "supplier": r["Supplier"],
            "sold": num(ana.loc[sku, "Unit Terjual"]), "abc": ana.loc[sku, "Kelas ABC"],
            "rating": round(sum(rs) / len(rs), 1) if rs else 0, "reviewCount": len(rs),
        })

    # ---------- rekonsiliasi ----------
    I = x["Invoice"]
    KC = x["Kontrak Cicilan"]
    inv_s = I[I["Jenis Invoice"] == "Penjualan"]
    inv_c = I[I["Jenis Invoice"] == "Cicilan"].merge(KC[["No Kontrak", "Nomor Transaksi"]], left_on="No Referensi", right_on="No Kontrak")
    dbl = set(inv_s["No Referensi"]) & set(inv_c["Nomor Transaksi"])
    covered = set(inv_s["No Referensi"]) | set(inv_c["Nomor Transaksi"])
    no_inv = S[~S["Nomor Transaksi"].isin(covered)]
    ppn = params["ppn"]
    ppn_should = float((S["Omzet (Rp)"] - S["Omzet (Rp)"] / (1 + ppn)).sum()) + float(I[I["Jenis Invoice"] == "Layanan"]["PPN (Rp)"].sum())
    l01 = D[D["Kode Layanan"] == "L-01"].merge(x["Transaksi Layanan"], on="No Order Layanan")
    l01 = l01[l01["Status Layanan"] != "Dibatalkan"]
    cancel = x["Transaksi Layanan"][x["Transaksi Layanan"]["Status Layanan"] == "Dibatalkan"]
    cancel_d = D[D["No Order Layanan"].isin(cancel["No Order Layanan"])]
    done_ret = [r for r in returns if r["status"] == "Selesai"]
    oldest = min(branches, key=lambda b: b["opened"])
    recon = {
        "doubleInvoice": {"count": len(dbl), "ppn": round(float(inv_c[inv_c["Nomor Transaksi"].isin(dbl)]["PPN (Rp)"].sum()))},
        "noInvoice": {"count": len(no_inv), "omzet": round(float(no_inv["Omzet (Rp)"].sum())),
                       "ppn": round(float((no_inv["Omzet (Rp)"] - no_inv["Omzet (Rp)"] / (1 + ppn)).sum()))},
        "ppnInvoice": round(float(I["PPN (Rp)"].sum())), "ppnShould": round(ppn_should),
        "returns": {"claims": len(returns), "done": len(done_ret), "inProcess": len(returns) - len(done_ret),
                     "omzet": sum(r["omzet"] for r in done_ret), "hpp": sum(r["hpp"] for r in done_ret)},
        "shippingCityFee": {"count": len(l01), "total": round(float(l01["Subtotal (Rp)"].sum())), "fee": tariffs[0]["fee"]},
        "cancelledOrders": {"count": len(cancel), "header": round(float(cancel["Total Biaya (Rp)"].sum())),
                             "lines": len(cancel_d), "lineTotal": round(float(cancel_d["Subtotal (Rp)"].sum()))},
        "catalog": {"web": 42, "excel": len(products)},
        "oldestBranch": {"name": oldest["branch"], "opened": oldest["opened"]},
    }

    # ---------- tulis ----------
    gen = ROOT / "src" / "generated"
    gen.mkdir(parents=True, exist_ok=True)
    pub = ROOT / "public" / "data"
    dump = lambda p, o: p.write_text(json.dumps(o, ensure_ascii=False, separators=(",", ":")))
    dump(gen / "catalog.json", {"products": products, "branches": branches, "params": params, "tariffs": tariffs,
                                "refDate": REF.strftime("%Y-%m-%d"), "lastCustomerNo": len(customers)})
    dump(pub / "sales-2027.json", {"rows": rows, "skus": skus, "opex": opex, "returns": returns, "ship": ship})
    dump(pub / "customers-2027.json", customers)
    dump(pub / "reviews-2027.json", reviews)
    dump(pub / "recon-2027.json", recon)
    print(f"produk {len(products)}, cabang {len(branches)}, transaksi {len(rows)}, pelanggan {len(customers)}, "
          f"retur {len(returns)}, pengiriman {len(ship)}, ulasan {len(reviews)}")
    print(json.dumps(recon, indent=1))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
