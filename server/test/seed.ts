// Seeds a demo tenant (a Port Harcourt provisions store) plus a second tenant for isolation tests.
const B = process.env.API ?? "http://localhost:4000/api";
export async function call(path: string, token?: string, body?: unknown, method?: string) {
  const r = await fetch(B + path, { method: method ?? (body ? "POST" : "GET"), headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j: any = await r.json().catch(() => ({}));
  return { status: r.status, body: j };
}

async function main() {
  const reg = await call("/auth/register", undefined, { businessName: "Ama Provisions Store", businessType: "Retail", email: "owner@amaprovisions.ng", phone: "08031234567",
    state: "Rivers", address: "14 Aba Road, Port Harcourt", ownerName: "Amarachi Okafor", password: "Owner#2026" });
  const T = reg.body.token;
  await call("/users", T, { fullName: "Tunde Bello", email: "tunde@amaprovisions.ng", password: "Staff#2026", role: "SALES_STAFF" });
  await call("/users", T, { fullName: "Ngozi Eze", email: "ngozi@amaprovisions.ng", password: "Stock#2026", role: "INVENTORY_MANAGER" });
  const items: [string, string, string, number, number, number, number][] = [
    ["Peak Milk Tin 400g", "PK-400", "Dairy", 2350, 2700, 60, 10], ["Indomie Noodles (carton)", "IND-40", "Noodles", 9800, 11200, 25, 5],
    ["Golden Penny Semovita 1kg", "GP-SEM1", "Flour", 1550, 1850, 40, 8], ["Dangote Sugar 500g", "DS-500", "Sugar", 900, 1100, 70, 15],
    ["Mama Gold Rice 5kg", "MG-5", "Rice", 8400, 9500, 18, 6], ["Kings Vegetable Oil 1L", "KO-1L", "Oil", 2700, 3100, 30, 8],
    ["Milo Refill 500g", "ML-500", "Beverages", 3900, 4500, 22, 6], ["Lipton Tea (100 bags)", "LT-100", "Beverages", 3100, 3600, 9, 6],
    ["Eva Water 75cl (pack)", "EVA-12", "Drinks", 2400, 2900, 35, 10], ["Hypo Bleach 1L", "HYP-1", "Household", 1200, 1500, 4, 6],
    ["Dettol Soap 110g", "DT-110", "Household", 850, 1050, 48, 12], ["Honeywell Spaghetti 500g", "HW-SP", "Pasta", 950, 1150, 55, 12],
  ];
  const ids: string[] = [];
  for (const [n, sku, cat, cost, price, stock, ro] of items) {
    const p = await call("/products", T, { productName: n, sku, barcode: "6" + String(Math.abs(hash(sku))).padStart(12, "0").slice(0, 12), category: cat, costPrice: cost, sellingPrice: price, openingStock: stock * 4, reorderLevel: ro });
    ids.push(p.body.product_id);
  }
  // receive a supplier delivery
  const sup = await call("/suppliers", T, { supplierName: "Garrison Wholesale Depot", phone: "08097654321" });
  const po = await call("/purchases", T, { supplierId: sup.body.supplier_id, items: [{ productId: ids[0], quantity: 24, unitCost: 2350 }, { productId: ids[4], quantity: 10, unitCost: 8400 }] });
  await call(`/purchases/${po.body.purchase_id}/receive`, T, {});
  const cust = await call("/customers", T, { customerName: "Mr. Ibiso George", phone: "08055501234", creditLimit: 50000 });
  await call("/customers", T, { customerName: "Mrs. Blessing Wokoma", phone: "08122203344", creditLimit: 30000 });
  const staff = (await call("/auth/login", undefined, { email: "tunde@amaprovisions.ng", password: "Staff#2026" })).body.token;
  // 30 days of history
  let rnd = 7; const r = () => (rnd = (rnd * 16807) % 2147483647) / 2147483647;
  const methods = ["CASH", "CASH", "TRANSFER", "CASH", "TRANSFER", "CARD"];
  for (let d = 29; d >= 0; d--) {
    const n = 3 + Math.floor(r() * 5);
    for (let k = 0; k < n; k++) {
      const lines = 1 + Math.floor(r() * 3); const pick = new Set<number>();
      while (pick.size < lines) pick.add(Math.floor(r() * (ids.length - 2)));
      const when = new Date(Date.now() - d * 86400000); when.setHours(8 + Math.floor(r() * 11), Math.floor(r() * 60));
      if (when > new Date()) when.setTime(Date.now() - 60000 * (k + 1));
      await call("/sales", r() > 0.5 ? staff : T, { items: [...pick].map((i) => ({ productId: ids[i], quantity: 1 + Math.floor(r() * 3) })), paymentMethod: methods[Math.floor(r() * methods.length)], createdAt: when.toISOString() });
    }
  }
  await call("/sales", T, { items: [{ productId: ids[4], quantity: 1 }], paymentMethod: "CREDIT", customerId: cust.body.customer_id });
  // second tenant
  await call("/auth/register", undefined, { businessName: "Bori Pharmacy", businessType: "Pharmacy", email: "owner@boripharm.ng", phone: "08060000001", state: "Rivers", ownerName: "Dr. Kelechi Nwosu", password: "Pharm#2026" });
  const T2 = (await call("/auth/login", undefined, { email: "owner@boripharm.ng", password: "Pharm#2026" })).body.token;
  await call("/products", T2, { productName: "Paracetamol 500mg (card)", sku: "PCM-500", category: "Analgesics", costPrice: 150, sellingPrice: 250, openingStock: 300, reorderLevel: 50 });
  console.log(JSON.stringify({ products: ids.length, ok: true }));
}
function hash(s: string) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return h; }
if (require.main === module) main();
