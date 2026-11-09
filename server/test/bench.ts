// Performance and consistency benchmarks: proposed (integrated, transactional) vs baseline (separate modules).
import autocannon from "autocannon";
import crypto from "node:crypto";
import { Client } from "pg";
import { call } from "./seed";

const PORT = process.env.API_PORT ?? "4001";
const BASE = `http://localhost:${PORT}`;
const out: any = {};

function ac(opts: any): Promise<any> { return new Promise((res, rej) => autocannon(opts, (e: any, r: any) => (e ? rej(e) : res(r)))); }
const summarise = (r: any) => ({ rps: Math.round(r.requests.average), p50: r.latency.p50, p90: r.latency.p90, p99: r.latency.p99, mean: +r.latency.average.toFixed(1),
  non2xx: r.non2xx, errors: r.errors, total: r.requests.total });

async function db(sql: string, args: any[] = []) {
  const c = new Client({ host: process.env.PGHOST ?? "localhost", database: process.env.PGDATABASE ?? "sims_bench", user: "postgres" }); await c.connect();
  const r = await c.query(sql, args); await c.end(); return r;
}

async function main() {
  const tag = crypto.randomBytes(3).toString("hex");
  const T = (await call("/auth/register", undefined, { businessName: "Bench " + tag, businessType: "Retail", email: `bench${tag}@t.ng`, phone: "08030000009", state: "Rivers", ownerName: "Bench Owner", password: "Passw0rd!" })).body.token;
  const big = (await call("/products", T, { productName: "Bench Rice 5kg", sku: "BR5", costPrice: 8000, sellingPrice: 9500, openingStock: 50_000_000, reorderLevel: 0 })).body.product_id;
  for (let i = 0; i < 150; i++) await call("/products", T, { productName: `Catalogue item ${i}`, sku: `CI${i}`, costPrice: 100 + i, sellingPrice: 150 + i, openingStock: 1000, reorderLevel: 5 });
  const H = { "Content-Type": "application/json", Authorization: `Bearer ${T}` };
  const saleBody = JSON.stringify({ items: [{ productId: big, quantity: 1 }], paymentMethod: "CASH" });

  // warm up
  await ac({ url: `${BASE}/api/products`, headers: H, connections: 5, duration: 3 });

  // 1. Load test across concurrency levels
  out.load = {};
  for (const c of [10, 50, 100]) {
    out.load[c] = {
      products: summarise(await ac({ url: `${BASE}/api/products?q=Catalogue`, headers: H, connections: c, duration: 15 })),
      sale: summarise(await ac({ url: `${BASE}/api/sales`, method: "POST", headers: H, body: saleBody, connections: c, duration: 15 })),
      baselineSale: summarise(await ac({ url: `${BASE}/api/baseline/sales`, method: "POST", headers: H, body: saleBody, connections: c, duration: 15 })),
      report: summarise(await ac({ url: `${BASE}/api/reports/summary?days=30`, headers: H, connections: c, duration: 15 })),
    };
    console.error("load", c, JSON.stringify(out.load[c]));
  }

  // 2. Stock accuracy under concurrent checkouts: 100 units, 200 attempts, 50 at a time
  out.consistency = { proposed: [], baseline: [] };
  for (const mode of ["proposed", "baseline"] as const) {
    for (let run = 0; run < 5; run++) {
      const pid = (await call("/products", T, { productName: `Race ${mode} ${run}`, sku: `R${mode[0]}${run}${tag}`, costPrice: 100, sellingPrice: 150, openingStock: 100 })).body.product_id;
      const path = mode === "proposed" ? "/api/sales" : "/api/baseline/sales";
      const r = await ac({ url: BASE + path, method: "POST", headers: H, body: JSON.stringify({ items: [{ productId: pid, quantity: 1 }], paymentMethod: "CASH" }), connections: 50, amount: 200 });
      const sold = (await db(`SELECT COALESCE(SUM(quantity),0)::int n FROM sale_items WHERE product_id = $1`, [pid])).rows[0].n;
      const stock = (await db(`SELECT quantity FROM inventory WHERE product_id = $1`, [pid])).rows[0].quantity;
      out.consistency[mode].push({ run: run + 1, accepted: r["2xx"], rejected: r.non2xx, unitsSold: sold, recordedStock: stock, trueStock: 100 - sold, discrepancy: stock - (100 - sold), oversold: Math.max(0, sold - 100) });
    }
  }
  console.error("consistency", JSON.stringify(out.consistency));

  // 3. Single-user checkout latency (sequential), proposed vs baseline
  out.sequential = {};
  for (const [name, path] of [["proposed", "/api/sales"], ["baseline", "/api/baseline/sales"]]) {
    const t: number[] = [];
    for (let i = 0; i < 300; i++) { const s = performance.now(); await fetch(BASE + path, { method: "POST", headers: H, body: saleBody }); t.push(performance.now() - s); }
    t.sort((a, b) => a - b);
    out.sequential[name] = { mean: +(t.reduce((a, b) => a + b, 0) / t.length).toFixed(2), p50: +t[150].toFixed(2), p95: +t[285].toFixed(2) };
  }
  console.error("sequential", JSON.stringify(out.sequential));

  // 4. Offline queue upload
  out.offline = {};
  for (const size of [50, 200, 500]) {
    const batch = Array.from({ length: size }, () => ({ items: [{ productId: big, quantity: 1 }], paymentMethod: "CASH", syncUuid: crypto.randomUUID(), createdAt: new Date().toISOString() }));
    let s = performance.now(); const r1 = await call("/sales/sync", T, { sales: batch }); const first = performance.now() - s;
    s = performance.now(); const r2 = await call("/sales/sync", T, { sales: batch }); const replay = performance.now() - s;
    out.offline[size] = { firstMs: Math.round(first), perSaleMs: +(first / size).toFixed(2), replayMs: Math.round(replay), created: r1.body.results.filter((x: any) => x.ok && !x.duplicate).length, duplicates: r2.body.results.filter((x: any) => x.duplicate).length };
  }
  console.error("offline", JSON.stringify(out.offline));

  // 5. Multi-tenant scale: add 200 tenants × (200 products, 300 sales) directly, then re-measure
  out.tenantScale = { before: {}, after: {} };
  const measure = async () => ({
    products: summarise(await ac({ url: `${BASE}/api/products?q=Catalogue`, headers: H, connections: 20, duration: 10 })),
    report: summarise(await ac({ url: `${BASE}/api/reports/summary?days=30`, headers: H, connections: 20, duration: 10 })),
  });
  out.tenantScale.before = await measure();
  out.tenantScale.rowsBefore = (await db(`SELECT (SELECT count(*) FROM businesses)::int b, (SELECT count(*) FROM products)::int p, (SELECT count(*) FROM sales)::int s`)).rows[0];
  await db(`
    WITH b AS (INSERT INTO businesses (business_name,business_type,email,phone,state)
      SELECT 'Tenant '||g,'Retail','tenant'||g||'-${tag}@x.ng','08000000000','Rivers' FROM generate_series(1,200) g RETURNING business_id),
    br AS (INSERT INTO branches (business_id,branch_name) SELECT business_id,'Main' FROM b RETURNING business_id, branch_id),
    us AS (INSERT INTO users (business_id,branch_id,full_name,email,password_hash,role) SELECT business_id,branch_id,'U','u'||branch_id||'@x.ng','x','OWNER' FROM br RETURNING business_id, branch_id, user_id),
    pr AS (INSERT INTO products (business_id,product_name,sku,cost_price,selling_price) SELECT us.business_id,'P'||g,'S'||g,100,150 FROM us, generate_series(1,200) g RETURNING business_id, product_id),
    inv AS (INSERT INTO inventory (business_id,product_id,branch_id,quantity) SELECT pr.business_id, pr.product_id, us.branch_id, 500 FROM pr JOIN us USING (business_id) RETURNING 1),
    sa AS (INSERT INTO sales (business_id,branch_id,user_id,invoice_no,subtotal,grand_total,amount_paid,payment_status,created_at)
      SELECT business_id,branch_id,user_id,'I'||g,1500,1612.5,1612.5,'PAID', now() - (g % 30) * interval '1 day' FROM us, generate_series(1,300) g RETURNING business_id, sale_id)
    INSERT INTO sale_items (business_id,sale_id,product_id,quantity,unit_price,unit_cost,line_total)
      SELECT sa.business_id, sa.sale_id, (SELECT product_id FROM pr WHERE pr.business_id = sa.business_id LIMIT 1), 10, 150, 100, 1500 FROM sa`);
  await db("ANALYZE");
  out.tenantScale.rowsAfter = (await db(`SELECT (SELECT count(*) FROM businesses)::int b, (SELECT count(*) FROM products)::int p, (SELECT count(*) FROM sales)::int s`)).rows[0];
  out.tenantScale.after = await measure();
  console.error("scale", JSON.stringify(out.tenantScale));
  console.log(JSON.stringify(out, null, 1));
}
main();
