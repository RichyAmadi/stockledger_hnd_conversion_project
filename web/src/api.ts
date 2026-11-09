import { get, set } from "idb-keyval";

let token = localStorage.getItem("token") ?? "";
export const setToken = (t: string) => { token = t; localStorage.setItem("token", t); };
export const clearToken = () => { token = ""; localStorage.removeItem("token"); };
export const hasToken = () => !!token;

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const r = await fetch(`/api${path}`, {
    method: opts.method ?? "GET",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error ?? `Request failed (${r.status})`);
  return data as T;
}

export const naira = (n: number) => "₦" + Number(n || 0).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const ddmmyyyy = (d: string) => { const x = new Date(d); return `${String(x.getDate()).padStart(2, "0")}/${String(x.getMonth() + 1).padStart(2, "0")}/${x.getFullYear()} ${String(x.getHours()).padStart(2, "0")}:${String(x.getMinutes()).padStart(2, "0")}`; };

/* ---- offline sale queue (IndexedDB) ---- */
const QKEY = "pending-sales";
export async function queueSale(sale: any) {
  const q = ((await get(QKEY)) as any[]) ?? [];
  q.push({ ...sale, syncUuid: crypto.randomUUID(), createdAt: new Date().toISOString() });
  await set(QKEY, q);
  return q.length;
}
export async function pendingCount() { return (((await get(QKEY)) as any[]) ?? []).length; }
export async function syncQueue() {
  const q = ((await get(QKEY)) as any[]) ?? [];
  if (!q.length) return { sent: 0, failed: 0 };
  const { results } = await api<{ results: any[] }>("/sales/sync", { method: "POST", body: { sales: q } });
  const failed = results.filter((r) => !r.ok);
  await set(QKEY, q.filter((s) => failed.some((f) => f.syncUuid === s.syncUuid)));
  return { sent: results.length - failed.length, failed: failed.length };
}
