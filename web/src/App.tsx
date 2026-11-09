import { useEffect, useState, useCallback, useRef } from "react";
import { api, setToken, clearToken, hasToken, naira, ddmmyyyy, queueSale, pendingCount, syncQueue } from "./api";

type Page = "dashboard" | "pos" | "inventory" | "purchasing" | "sales" | "customers" | "complaints" | "reports" | "insights" | "plans" | "team" | "admin" | "profile";

export default function App() {
  const [me, setMe] = useState<any>(null);
  const [page, setPage] = useState<Page>("dashboard");
  const [online, setOnline] = useState(navigator.onLine);
  const [pending, setPending] = useState(0);
  const [toast, setToast] = useState("");
  const [tick, setTick] = useState(0);
  const [authMessage, setAuthMessage] = useState("");

  const loadMe = useCallback(() => api("/me").then((user) => {
    setMe(user);
    setAuthMessage("");
  }).catch(() => {
    clearToken();
    setMe(null);
    setAuthMessage("Your session expired or could not be verified. Please sign in again.");
  }), []);
  const logout = () => {
    clearToken();
    setMe(null);
    setAuthMessage("You have been logged out.");
  };
  useEffect(() => { if (hasToken()) loadMe(); }, [loadMe]);
  useEffect(() => {
    let busy = false;
    const up = async () => {
      setOnline(true); if (busy) return; busy = true;
      try { const r = await syncQueue(); if (r.sent) { setToast(`${r.sent} offline sale(s) synced`); setTick((t) => t + 1); } } catch { /* retry on next reconnect */ }
      finally { busy = false; setPending(await pendingCount()); }
    };
    const down = () => setOnline(false);
    window.addEventListener("online", up); window.addEventListener("offline", down);
    pendingCount().then(setPending);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, []);
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(""), 3500); return () => clearTimeout(t); } }, [toast]);

  if (!me) return <Auth onDone={loadMe} message={authMessage} />;
  const planName = String(me.business?.plan_name ?? "").toLowerCase();
  const hasAnalytics = !me.business?.subscription_expired && (planName === "trial" || planName === "standard" || planName === "premium");
  const canManageInventory = ["OWNER", "ADMIN", "INVENTORY_MANAGER"].includes(me.role);
  const nav: [Page, string][] = [["dashboard", "Overview"], ["pos", "Point of sale"], ["inventory", "Inventory"], ...(canManageInventory ? [["purchasing", "Purchasing"] as [Page, string]] : []), ["sales", "Sales"], ["customers", "CRM"], ["complaints", "Complaints"], ...(hasAnalytics ? [["reports", "Reports"] as [Page, string]] : []), ...(hasAnalytics && planName === "premium" && ["OWNER", "ADMIN"].includes(me.role) ? [["insights", "Smart insights"] as [Page, string]] : []), ["profile", "My profile"]];
  const titles: Record<Page, string> = { dashboard: "Overview", pos: "Point of sale", inventory: "Inventory", purchasing: "Purchasing", sales: "Sales", customers: "CRM", complaints: "Complaints", reports: "Reports", insights: "Smart insights", plans: "Plans and billing", team: "Team management", admin: "System administration", profile: "My profile" };
  return (
    <div className="shell">
      <aside>
        <div className="brand"><span className="brand-mark">S</span><span>StockLedger<small>INVENTORY, MADE SIMPLE</small></span></div>
        <div className="workspace-switch"><span className="workspace-avatar">{me.business?.logo_url ? <img className="workspace-logo" src={me.business.logo_url} alt={`${me.business.business_name} logo`} /> : me.business?.business_name?.[0] ?? "B"}</span><span><b>{me.business?.business_name}</b><small>{me.business?.plan_name ?? "Business"} plan</small></span>
          {me.role === "OWNER" ? <button type="button" className="workspace-edit-button" onClick={() => setPage("admin")}>Edit</button> : <span className="workspace-chevron">⌄</span>}</div>
        <div className="sidebar-navigation-scroll">
          <div className="nav-label">WORKSPACE</div>
          <nav className="nav-list">
            {nav.filter(([p]) => !["reports", "insights"].includes(p) || ["OWNER", "ADMIN"].includes(me.role)).map(([p, l]) =>
              <button key={p} className={page === p ? "on" : ""} onClick={() => setPage(p)}><span className="nav-icon">{({ dashboard: "◫", pos: "＋", inventory: "▤", purchasing: "⇄", sales: "↗", customers: "♙", complaints: "!", reports: "▥", insights: "✧", profile: "●" } as Record<string, string>)[p]}</span>{l}</button>)}
          </nav>
          {["OWNER", "ADMIN"].includes(me.role) && <><div className="nav-label admin-label">ADMINISTRATION</div><nav className="nav-list">
            <button className={page === "team" ? "on" : ""} onClick={() => setPage("team")}><span className="nav-icon">♧</span>Team management</button>
            {me.role === "OWNER" && <button className={page === "plans" ? "on" : ""} onClick={() => setPage("plans")}><span className="nav-icon">◇</span>Plans and billing</button>}
            {me.role === "OWNER" && <button className={page === "admin" ? "on" : ""} onClick={() => setPage("admin")}><span className="nav-icon">⚙</span>System administration</button>}
          </nav></>}
        </div>
        <div className="sidebar-bottom">
          <div className="sidebar-help"><span className="help-mark">?</span><div><b>Need a hand?</b><small>Your workspace is ready.</small></div></div>
          <div className="profile"><span className="profile-avatar">{me.name?.[0] ?? "U"}</span><span className="profile-info"><b>{me.name}</b><small>{me.role.replaceAll("_", " ")}</small></span>
            <button aria-label="Log out" className="signout" onClick={logout}><span aria-hidden="true">↗</span><span className="signout-label">Log out</span></button></div>
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar"><div className="breadcrumb"><span>Workspace</span><span className="crumb-slash">/</span><b>{titles[page]}</b></div>
          <div className="topbar-actions"><div className={`net ${online ? "ok" : "off"}`}><span className="status-dot" />{online ? "All systems normal" : "Offline"}{pending ? ` · ${pending} queued` : ""}</div>
            <span className="today-label">{new Date().toLocaleDateString("en-NG", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</span>
            <button className="logout-button" onClick={logout}><span aria-hidden="true">↗</span>Log out</button>
            <button className="primary top-action" onClick={() => setPage("pos")}>＋ New sale</button></div>
        </header>
        <div className="page-content">
        {page === "dashboard" && <Dashboard me={me} onNavigate={setPage} />}
        {page === "pos" && <POS key={tick} me={me} online={online} onQueued={(n) => { setPending(n); setToast("Saved offline. Will sync when back online."); }} toast={setToast} />}
        {page === "inventory" && <Inventory me={me} toast={setToast} />}
        {page === "purchasing" && canManageInventory && <Purchasing toast={setToast} />}
        {page === "sales" && <Sales />}
        {page === "customers" && <CRM toast={setToast} />}
        {page === "complaints" && <Complaints me={me} toast={setToast} />}
        {page === "reports" && <Reports />}
        {page === "insights" && ["OWNER", "ADMIN"].includes(me.role) && <Insights />}
        {page === "plans" && me.role === "OWNER" && <Plans me={me} onSaved={loadMe} toast={setToast} />}
        {page === "team" && <Team me={me} toast={setToast} />}
        {page === "profile" && <Profile me={me} onSaved={loadMe} toast={setToast} />}
        {page === "admin" && me.role === "OWNER" && <SystemAdministration me={me} onSaved={loadMe} toast={setToast} onNavigate={setPage} />}
        </div>
      </main>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function Auth({ onDone, message }: { onDone: () => void; message?: string }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [f, setF] = useState<any>({ email: "", password: "" });
  const [err, setErr] = useState("");
  const on = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: any) => {
    e.preventDefault(); setErr("");
    try { const r = await api(`/auth/${mode}`, { method: "POST", body: f }); setToken(r.token); onDone(); } catch (x: any) { setErr(x.message); }
  };
  return (
    <div className="auth"><form onSubmit={submit} className="card">
      <h1>StockLedger</h1><p className="muted">Sales and inventory for Nigerian businesses</p>
      {message && <div className="err" role="alert">{message}</div>}
      {mode === "register" && <>
        <label>Business name<input value={f.businessName ?? ""} onChange={on("businessName")} /></label>
        <div className="row2"><label>Business type<select value={f.businessType ?? ""} onChange={on("businessType")}><option value="">Select…</option><option>Retail</option><option>Wholesale</option><option>Pharmacy</option><option>Supermarket</option></select></label>
          <label>State<select value={f.state ?? ""} onChange={on("state")}><option value="">Select…</option><option>Rivers</option><option>Lagos</option><option>FCT</option><option>Oyo</option></select></label></div>
        <label>Owner's full name<input value={f.ownerName ?? ""} onChange={on("ownerName")} /></label>
        <label>Phone<input value={f.phone ?? ""} onChange={on("phone")} placeholder="08031234567" /></label>
      </>}
      <label>Email<input type="email" value={f.email} onChange={on("email")} /></label>
      <label>Password<input type="password" value={f.password} onChange={on("password")} /></label>
      {err && <div className="err">{err}</div>}
      <button className="primary">{mode === "login" ? "Sign in" : "Create business account"}</button>
      <button type="button" className="link" onClick={() => setMode(mode === "login" ? "register" : "login")}>
        {mode === "login" ? "New business? Register" : "Have an account? Sign in"}</button>
    </form></div>
  );
}

function Bars({ data }: { data: { day: string; revenue: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.revenue));
  return <div className="bars-scroll"><div className="bars" style={{ minWidth: `${Math.max(data.length * 30 - 6, 0)}px` }}>{data.map((d) => <div key={d.day} className="bar"><div style={{ height: `${(d.revenue / max) * 100}%` }} title={naira(d.revenue)} /><span>{d.day}</span></div>)}</div></div>;
}

function daysUntilDate(date: string) {
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((Date.parse(`${date}T00:00:00Z`) - today) / 86400000);
}

function Dashboard({ me, onNavigate }: { me: any; onNavigate: (page: Page) => void }) {
  const [s, setS] = useState<any>(null); const [alerts, setAlerts] = useState<any>({ stock: [], expiry: [] }); const [notes, setNotes] = useState<any[]>([]);
  const planName = String(me.business?.plan_name ?? "").toLowerCase();
  const hasAnalytics = !me.business?.subscription_expired && (planName === "trial" || planName === "standard" || planName === "premium");
  useEffect(() => {
    if (["OWNER", "ADMIN"].includes(me.role)) api(hasAnalytics ? "/reports/summary?days=7" : "/dashboard/overview?days=7").then(setS);
    api("/inventory/alerts").then(setAlerts); api("/notifications").then(setNotes);
  }, [me.role, hasAnalytics]);
  return <>
    <section className="welcome-row"><div><div className="eyebrow">YOUR BUSINESS AT A GLANCE</div><h1>Good day, {me.name.split(" ")[0]} <span className="wave">✳</span></h1>
      <p>Here’s what’s happening with {me.business?.business_name ?? "your business"} today.</p></div>
      {["OWNER", "ADMIN"].includes(me.role) && hasAnalytics && <button className="secondary-button" onClick={() => onNavigate("reports")}>View reports <span>↗</span></button>}</section>
    {s && <div className="kpis">
      <Kpi label="Revenue · last 7 days" value={naira(s.revenue)} sub={<span className="kpi-trend"><span>↗</span> Sales performance</span>} icon="₦" />
      <Kpi label="Transactions" value={s.sales_count} sub="Completed sales" icon="↗" />
      {hasAnalytics && <Kpi label="Gross profit" value={naira(s.grossProfit)} sub={`${s.grossMargin}% gross margin`} icon="◈" />}
      <Kpi label="Stock at cost" value={naira(s.stock_value)} sub={`${s.low_stock} items need attention`} icon="▤" />
    </div>}
    <div className="dashboard-grid">
      {s?.daily && <div className="card chart-card"><div className="section-heading"><div><div className="eyebrow">PERFORMANCE</div><h3>Revenue overview</h3></div><span className="period-tag">Last 7 days <span>⌄</span></span></div>
        <div className="chart-total">{naira(s.revenue)}<small> total revenue</small></div><Bars data={s.daily} /></div>}
      <div className="card alerts-card"><div className="section-heading"><div><div className="eyebrow">INVENTORY HEALTH</div><h3>Stock & expiry alerts</h3></div><button className="text-button" onClick={() => onNavigate("inventory")}>View stock ↗</button></div>
        <div className="alert-group"><div className="alert-group-heading"><b>Stock alerts</b><span>{alerts.stock.length}</span></div>
          {alerts.stock.length ? <div className="alert-list">{alerts.stock.slice(0, 4).map((item: any) => <div className="alert-row" key={item.product_id}><span className="product-avatar">{item.product_name?.[0] ?? "P"}</span><span className="alert-product"><b>{item.product_name}</b><small>SKU {item.sku}</small></span><span className="stock-level"><b className={item.quantity === 0 ? "stock-empty" : ""}>{item.quantity}</b><small>{item.quantity === 0 ? "out of stock" : `left · reorder at ${item.reorder_level}`}</small></span></div>)}</div> : <p className="alert-empty">No products are at or below their reorder level.</p>}
        </div>
        <div className="alert-group expiry-alert-group"><div className="alert-group-heading"><b>Expiry alerts</b><span>{alerts.expiry.length}</span></div>
          {alerts.expiry.length ? <div className="alert-list">{alerts.expiry.slice(0, 4).map((item: any) => <div className="alert-row" key={item.product_id}><span className={`product-avatar ${item.type === "expired" ? "expiry-avatar-expired" : "expiry-avatar-soon"}`}>⌛</span><span className="alert-product"><b>{item.product_name}</b><small>SKU {item.sku}</small></span><span className="stock-level expiry-level"><b className={item.type === "expired" ? "stock-empty" : ""}>{item.type === "expired" ? "Expired" : item.days_until_expiry === 0 ? "Today" : `${item.days_until_expiry}d`}</b><small>{new Date(`${item.expiry_date}T00:00:00`).toLocaleDateString("en-NG")}</small></span></div>)}</div> : <p className="alert-empty">No in-stock products expire in the next 30 days.</p>}
        </div>
      </div>
    </div>
    <div className="dashboard-bottom">
      <div className="card activity-card"><div className="section-heading"><div><div className="eyebrow">LATEST UPDATES</div><h3>Recent activity</h3></div></div>
        {notes.length ? notes.slice(0, 5).map((n, i) => <div key={i} className="activity-row"><span className="activity-dot" /><span className="activity-copy"><b>{n.title}</b><small>{n.body}</small></span><time>{ddmmyyyy(n.created_at)}</time></div>) : <div className="empty-activity">You’re all caught up. New business updates will appear here.</div>}
      </div>
      <div className="card shortcuts-card"><div className="eyebrow">QUICK ACTIONS</div><h3>Get things done</h3>
        <button className="shortcut-row" onClick={() => onNavigate("pos")}><span className="shortcut-icon green">＋</span><span><b>Record a sale</b><small>Start a new checkout</small></span><span className="shortcut-arrow">↗</span></button>
        <button className="shortcut-row" onClick={() => onNavigate("inventory")}><span className="shortcut-icon blue">▤</span><span><b>Manage inventory</b><small>Update your product catalogue</small></span><span className="shortcut-arrow">↗</span></button>
        {["OWNER", "ADMIN"].includes(me.role) && <button className="shortcut-row" onClick={() => onNavigate("team")}><span className="shortcut-icon amber">♧</span><span><b>Manage your team</b><small>People and access</small></span><span className="shortcut-arrow">↗</span></button>}
      </div>
    </div>
  </>;
}
const Kpi = ({ label, value, sub, icon }: any) => <div className="kpi"><div className="kpi-top"><span>{label}</span><span className="kpi-icon">{icon}</span></div><b>{value}</b><small>{sub}</small></div>;

function Team({ me, toast }: { me: any; toast: (s: string) => void }) {
  const [rows, setRows] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [f, setF] = useState({ fullName: "", email: "", phone: "", password: "", role: "SALES_STAFF", isActive: true });
  const [error, setError] = useState("");
  const maxUsers = Number(me.business?.max_users ?? 0);
  const load = () => api("/users").then(setRows).catch((e) => toast(e.message));
  useEffect(() => { load(); }, []);
  const closeForm = () => {
    setShowForm(false); setEditing(null); setError("");
    setF({ fullName: "", email: "", phone: "", password: "", role: "SALES_STAFF", isActive: true });
  };
  const editUser = (user: any) => {
    setEditing(user); setError("");
    setF({ fullName: user.full_name, email: user.email, phone: user.phone ?? "", password: "", role: user.role, isActive: user.is_active });
    setShowForm(true);
  };
  const canEditUser = (user: any) => user.role !== "OWNER" && (me.role === "OWNER" || user.role !== "ADMIN");
  const roleLabel = (role: string) => role?.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase()) ?? "Staff";
  const save = async (e: any) => {
    e.preventDefault(); setSaving(true); setError("");
    try {
      if (editing) {
        await api(`/users/${editing.user_id}`, { method: "PUT", body: { fullName: f.fullName, email: f.email, phone: f.phone, role: f.role, isActive: f.isActive } });
      } else {
        await api("/users", { method: "POST", body: { fullName: f.fullName, email: f.email, phone: f.phone || undefined, password: f.password, role: f.role } });
      }
      closeForm(); await load(); toast(editing ? "Team member updated" : "Team member added");
    } catch (x: any) { setError(x.message); }
    finally { setSaving(false); }
  };
  return <>
    <section className="welcome-row team-welcome"><div><div className="eyebrow">ADMINISTRATION</div><h1>Your team</h1><p>Manage the people who help run {me.business?.business_name ?? "your business"}.</p></div>
      <button className="primary" onClick={() => { if (showForm && !editing) closeForm(); else { closeForm(); setShowForm(true); } }}>＋ Add team member</button></section>
    <div className="team-stats">
      <div className="card team-stat"><span className="team-stat-icon">♧</span><div><small>Team members</small><b>{rows.length}{maxUsers ? <span> / {maxUsers}</span> : ""}</b></div></div>
      <div className="card team-stat"><span className="team-stat-icon active-stat">✓</span><div><small>Active accounts</small><b>{rows.filter((r) => r.is_active).length}</b></div></div>
      <div className="card team-stat"><span className="team-stat-icon plan-stat">◇</span><div><small>Current plan</small><b>{me.business?.plan_name ?? "Business"}</b></div></div>
    </div>
    {showForm && <form className="card team-form" onSubmit={save}><div className="section-heading"><div><div className="eyebrow">{editing ? "ACCOUNT SETTINGS" : "NEW ACCOUNT"}</div><h3>{editing ? `Edit ${editing.full_name}'s profile` : "Add a team member"}</h3></div><button type="button" className="close-button" aria-label="Close form" onClick={closeForm}>×</button></div>
      <div className="team-form-grid"><label>Full name<input required minLength={2} value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} placeholder="e.g. Chika Okafor" /></label>
        <label>Email address<input required type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="name@business.com" /></label>
        <label>Phone<input type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="08031234567" /></label>
        {!editing && <label>Temporary password<input required minLength={8} type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} placeholder="At least 8 characters" /></label>}
        <label>Role<select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="SALES_STAFF">Sales staff</option><option value="INVENTORY_MANAGER">Inventory manager</option>{me.role === "OWNER" && <option value="ADMIN">Administrator</option>}</select></label>
        {editing && <label className="account-status-field">Account status<select value={f.isActive ? "active" : "inactive"} onChange={(e) => setF({ ...f, isActive: e.target.value === "active" })}><option value="active">Active</option><option value="inactive">Inactive</option></select></label>}</div>
      {error && <div className="err">{error}</div>}<div className="form-actions"><span className="muted">{editing ? "Changes apply to this staff account." : maxUsers && rows.length >= maxUsers ? "Your plan limit has been reached." : `Adding a member uses one of ${maxUsers || "your"} available team seats.`}</span><button className="primary" disabled={saving || (!editing && !!maxUsers && rows.length >= maxUsers)}>{saving ? "Saving…" : editing ? "Save changes" : "Add member"}</button></div>
    </form>}
    <div className="card team-table-card"><div className="section-heading"><div><div className="eyebrow">PEOPLE & ACCESS</div><h3>Team members</h3><p className="team-help">Add accounts, review roles and activity, or edit a staff profile and access status.</p></div><span className="count-badge">{rows.length} members</span></div>
      <div className="table-scroll"><table className="team-table"><thead><tr><th>TEAM MEMBER</th><th>ROLE</th><th>STATUS</th><th>LAST ACTIVE</th><th>JOINED</th><th>ACTION</th></tr></thead><tbody>
        {rows.map((r) => <tr key={r.user_id}><td><span className="member-cell"><span className="member-avatar">{r.full_name?.[0] ?? "U"}</span><span><b>{r.full_name}</b><small>{r.email}</small></span></span></td>
          <td><span className={`role-badge role-${r.role?.toLowerCase()}`}>{roleLabel(r.role)}</span></td>
          <td><span className={`status-badge ${r.is_active ? "status-active" : "status-inactive"}`}><i />{r.is_active ? "Active" : "Inactive"}</span></td>
          <td>{r.last_login ? ddmmyyyy(r.last_login) : <span className="muted">Never</span>}</td><td>{r.created_at ? new Date(r.created_at).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" }) : "—"}</td>
          <td>{canEditUser(r) && <button className="edit-button" onClick={() => editUser(r)}>Edit</button>}</td></tr>)}
      </tbody></table></div>
      <div className="team-member-cards">{rows.map((r) => <article className="team-member-card" key={r.user_id}>
        <div className="team-member-card-head"><span className="member-cell"><span className="member-avatar">{r.full_name?.[0] ?? "U"}</span><span><b>{r.full_name}</b><small>{r.email}</small></span></span>
          {canEditUser(r) && <button className="edit-button" onClick={() => editUser(r)}>Edit</button>}</div>
        <div className="team-member-details">
          <div><small>Role</small><span className={`role-badge role-${r.role?.toLowerCase()}`}>{roleLabel(r.role)}</span></div>
          <div><small>Account status</small><span className={`status-badge ${r.is_active ? "status-active" : "status-inactive"}`}><i />{r.is_active ? "Active" : "Inactive"}</span></div>
          <div><small>Last active</small><b>{r.last_login ? ddmmyyyy(r.last_login) : "Never"}</b></div>
          <div><small>Joined</small><b>{r.created_at ? new Date(r.created_at).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" }) : "—"}</b></div>
        </div>
      </article>)}</div>
      {!rows.length && <div className="empty-state"><span className="empty-icon">♧</span><b>No team members yet</b><p>Add an account to invite your team into StockLedger.</p><button className="secondary-button" onClick={() => setShowForm(true)}>Add your first member</button></div>}
    </div>
  </>;
}

function Profile({ me, onSaved, toast }: { me: any; onSaved: () => Promise<void>; toast: (s: string) => void }) {
  const [form, setForm] = useState({ fullName: me.name ?? "", email: me.email ?? "", phone: me.phone ?? "", currentPassword: "", newPassword: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const save = async (e: any) => {
    e.preventDefault(); setSaving(true); setError("");
    const body: Record<string, string> = { fullName: form.fullName, email: form.email, phone: form.phone };
    if (form.currentPassword || form.newPassword) {
      body.currentPassword = form.currentPassword;
      body.newPassword = form.newPassword;
    }
    try {
      const updated = await api("/me", { method: "PUT", body });
      setForm({ fullName: updated.name, email: updated.email, phone: updated.phone ?? "", currentPassword: "", newPassword: "" });
      await onSaved(); toast("Profile updated");
    } catch (x: any) { setError(x.message); }
    finally { setSaving(false); }
  };
  return <>
    <section className="welcome-row"><div><div className="eyebrow">ACCOUNT SETTINGS</div><h1>My profile</h1><p>Update your personal details and sign-in password.</p></div></section>
    <div className="profile-layout"><form className="card settings-card" onSubmit={save}>
      <div className="section-heading"><div><div className="eyebrow">PERSONAL INFORMATION</div><h3>Your details</h3></div><span className="member-avatar profile-large-avatar">{me.name?.[0] ?? "U"}</span></div>
      <div className="settings-fields"><label>Full name<input required minLength={2} maxLength={120} value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></label>
        <label>Email address<input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
        <label>Phone number<input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="08031234567" /></label>
        <div className="profile-readonly"><span>Workspace role</span><b>{me.role.replaceAll("_", " ")}</b></div></div>
      <div className="password-section"><div className="eyebrow">PASSWORD & SECURITY</div><p>Leave both password fields blank to keep your current password.</p>
        <div className="settings-fields"><label>Current password<input type="password" autoComplete="current-password" value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} /></label>
          <label>New password<input type="password" autoComplete="new-password" minLength={8} value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} placeholder="At least 8 characters" /></label></div></div>
      {error && <div className="err">{error}</div>}<div className="form-actions"><span className="muted">Your role and business access are managed by an administrator.</span><button className="primary" disabled={saving}>{saving ? "Saving…" : "Save profile"}</button></div>
    </form>
      <div className="profile-side-card card"><div className="eyebrow">YOUR ACCOUNT</div><div className="profile-card-person"><span className="member-avatar profile-large-avatar">{me.name?.[0] ?? "U"}</span><b>{me.name}</b><span>{me.email}</span></div>
        <div className="profile-detail"><span>Role</span><b>{me.role.replaceAll("_", " ")}</b></div><div className="profile-detail"><span>Workspace</span><b>{me.business?.business_name}</b></div>
        <div className="security-note"><span>✓</span><p>Your account is protected by secure, tenant-scoped access controls.</p></div>
      </div>
    </div>
  </>;
}

function SystemAdministration({ me, onSaved, toast, onNavigate }: { me: any; onSaved: () => Promise<void>; toast: (s: string) => void; onNavigate: (page: Page) => void }) {
  const [form, setForm] = useState({
    businessName: me.business?.business_name ?? "", businessType: me.business?.business_type ?? "",
    email: me.business?.email ?? "", phone: me.business?.phone ?? "", address: me.business?.address ?? "",
    state: me.business?.state ?? "", taxRate: String(me.business?.tax_rate ?? 0),
    logoUrl: me.business?.logo_url ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const chooseLogo = (e: any) => {
    const file = e.target.files?.[0] as File | undefined;
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setError("Choose a PNG, JPEG, or WebP logo image.");
      e.target.value = "";
      return;
    }
    if (file.size > 1024 * 1024) {
      setError("Logo image must be no larger than 1 MB.");
      e.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => setError("Could not read the selected logo image.");
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        setError("Could not read the selected logo image.");
        return;
      }
      const logoUrl = reader.result;
      setForm((current) => ({ ...current, logoUrl }));
      setError("");
    };
    reader.readAsDataURL(file);
  };
  const save = async (e: any) => {
    e.preventDefault(); setSaving(true); setError("");
    try {
      await api("/business", { method: "PUT", body: { ...form, logoUrl: form.logoUrl || null, taxRate: Number(form.taxRate) } });
      await onSaved(); toast("Business settings updated");
    } catch (x: any) { setError(x.message); }
    finally { setSaving(false); }
  };
  const field = (key: keyof typeof form) => (e: any) => setForm({ ...form, [key]: e.target.value });
  return <>
    <section className="welcome-row"><div><div className="eyebrow">OWNER CONTROLS</div><h1>System administration</h1><p>Manage workspace settings, staff access, and account security.</p></div></section>
    <div className="admin-overview-grid">
      <div className="card admin-summary-card"><span className="admin-summary-icon">♧</span><div><div className="eyebrow">TEAM ACCESS</div><h3>People and permissions</h3><p>{me.business?.user_count ?? 0} active account(s) on the {me.business?.plan_name ?? "current"} plan.</p><button className="secondary-button" onClick={() => onNavigate("team")}>Manage team <span>↗</span></button></div></div>
      <div className="card admin-summary-card"><span className="admin-summary-icon plan-admin-icon">◇</span><div><div className="eyebrow">SUBSCRIPTION</div><h3>{me.business?.plan_name ?? "Business"} plan</h3><p>{me.business?.max_users ?? "—"} team seat(s) · valid until {me.business?.expiry_date ? new Date(me.business.expiry_date).toLocaleDateString("en-NG") : "—"}.</p><button className="secondary-button" onClick={() => onNavigate("plans")}>Manage subscription <span>↗</span></button></div></div>
    </div>
    <form className="card settings-card business-settings" onSubmit={save}>
      <div className="section-heading"><div><div className="eyebrow">WORKSPACE CONFIGURATION</div><h3>Business profile and defaults</h3></div><span className="role-badge role-owner">Owner access</span></div>
      <div className="settings-fields"><label>Business name<input required minLength={2} maxLength={150} value={form.businessName} onChange={field("businessName")} /></label>
        <label>Business type<input required minLength={2} maxLength={40} value={form.businessType} onChange={field("businessType")} /></label>
        <label>Business email<input required type="email" value={form.email} onChange={field("email")} /></label>
        <label>Business phone<input required type="tel" value={form.phone} onChange={field("phone")} /></label>
        <label>State<input required value={form.state} onChange={field("state")} /></label>
        <label>Tax rate (%)<input required type="number" min="0" max="100" step="0.01" value={form.taxRate} onChange={field("taxRate")} /></label>
        <label className="settings-full">Business address<input value={form.address} onChange={field("address")} maxLength={255} /></label>
        <div className="business-logo-field settings-full"><div><span className="business-logo-preview">{form.logoUrl
          ? <img src={form.logoUrl} alt="Business logo preview" />
          : <span>{form.businessName?.[0] ?? "B"}</span>}</span></div>
          <div className="business-logo-controls"><label>Business logo (optional)<input type="file" accept="image/png,image/jpeg,image/webp" onChange={chooseLogo} />
            <small>PNG, JPEG, or WebP · maximum 1 MB. Shown in the workspace header.</small></label>
            {form.logoUrl && <button type="button" className="logo-remove-button" onClick={() => setForm({ ...form, logoUrl: "" })}>Remove logo</button>}
          </div>
        </div></div>
      {error && <div className="err">{error}</div>}<div className="form-actions"><span className="muted">Tax changes apply to new sales.</span><button className="primary" disabled={saving}>{saving ? "Saving…" : "Save workspace settings"}</button></div>
    </form>
    <div className="card admin-security-card"><span className="security-shield">✓</span><div><b>Protected administration</b><p>Only the business owner can change workspace-wide settings. Admins can manage staff accounts but cannot alter owner access or business configuration.</p></div></div>
  </>;
}

function Plans({ me, onSaved, toast }: { me: any; onSaved: () => Promise<void>; toast: (s: string) => void }) {
  const [plans, setPlans] = useState<any[]>([]);
  const [subscription, setSubscription] = useState<any>(null);
  const [cycle, setCycle] = useState<"monthly" | "annual">("monthly");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [pendingPlan, setPendingPlan] = useState<any>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    Promise.all([api("/plans"), api("/subscription")])
      .then(([catalog, current]) => { setPlans(catalog); setSubscription(current); })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (!pendingPlan) return;
    let checks = 0;
    const timer = window.setInterval(async () => {
      checks += 1;
      try {
        const current = await api("/subscription");
        setSubscription(current);
        if (current.subscription?.plan_name?.toLowerCase() === pendingPlan.name.toLowerCase()) {
          window.clearInterval(timer);
          setPendingPlan(null);
          setBusy("");
          await onSaved();
          toast(`${pendingPlan.name} plan activated`);
        } else if (checks >= 120) {
          window.clearInterval(timer);
          setPendingPlan(null);
          setBusy("");
          setError("Payment is not confirmed yet. Your plan will update after Paystack verifies it; refresh this page to check again.");
        }
      } catch {
        if (checks >= 120) {
          window.clearInterval(timer);
          setPendingPlan(null);
          setBusy("");
          setError("Could not confirm payment status. Refresh this page to check your subscription.");
        }
      }
    }, 3000);
    return () => window.clearInterval(timer);
  }, [pendingPlan, onSaved, toast]);
  const checkout = async (plan: any) => {
    const popup = window.open("about:blank", "_blank");
    if (!popup) { setError("Allow pop-ups to open secure Paystack checkout."); return; }
    setBusy(plan.id); setError("");
    try {
      const checkoutSession = await api("/subscription/checkout", {
        method: "POST", body: { planId: plan.id, billingCycle: cycle },
      });
      popup.location.href = checkoutSession.authorization_url;
      setPendingPlan(plan);
    } catch (e: any) {
      popup.close();
      setBusy("");
      setError(e.message);
    }
  };
  const currentName = subscription?.subscription?.expired ? "" : subscription?.subscription?.plan_name?.toLowerCase();
  const currentCycle = subscription?.subscription?.billing_cycle?.toLowerCase();
  return <>
    <section className="welcome-row"><div><div className="eyebrow">SUBSCRIPTION & BILLING</div><h1>Plans for your business</h1>
      <p>Choose the tools that fit the way your business is growing.</p></div></section>
    <div className="billing-current card"><div><div className="eyebrow">{subscription?.subscription?.expired ? "SUBSCRIPTION EXPIRED" : "CURRENT PLAN"}</div><h3>{subscription?.subscription?.plan_name ?? me.business?.plan_name ?? "Trial"}</h3>
      <p>{subscription?.subscription?.expired ? "Renew or choose another plan to restore paid features." : subscription?.subscription?.expiry_date ? `Access until ${new Date(subscription.subscription.expiry_date).toLocaleDateString("en-NG")}` : "Your trial includes access to every feature."}</p></div>
      <div className="billing-toggle" role="group" aria-label="Billing period">
        <button className={cycle === "monthly" ? "selected" : ""} onClick={() => setCycle("monthly")}>Monthly</button>
        <button className={cycle === "annual" ? "selected" : ""} onClick={() => setCycle("annual")}>Annual <span>2 months free</span></button>
      </div>
    </div>
    {loading && <div className="card">Loading plans…</div>}
    <div className="plan-grid">{plans.map((plan) => <article className={`plan-card card ${plan.id === "standard" ? "plan-featured" : ""}`} key={plan.id}>
      {plan.id === "standard" && <span className="plan-popular">MOST POPULAR</span>}
      <div className="eyebrow">{plan.name.toUpperCase()}</div><h2>{plan.name}</h2><p>{plan.description}</p>
      <div className="plan-price"><b>{naira(cycle === "annual" ? plan.annualPrice : plan.monthlyPrice)}</b><span> / {cycle === "annual" ? "year" : "month"}</span></div>
      {cycle === "annual" && <div className="plan-saving">Save {naira(plan.annualSavings)} vs monthly billing</div>}
      <ul>{plan.features.map((feature: string) => <li key={feature}><span>✓</span>{feature}</li>)}</ul>
      {currentName === plan.name.toLowerCase() && currentCycle === cycle
        ? <button className="secondary-button plan-action" disabled>Current plan</button>
        : <button className="primary plan-action" disabled={!!busy || !!pendingPlan} onClick={() => checkout(plan)}>{busy === plan.id ? "Opening checkout…" : currentName === plan.name.toLowerCase() ? `Switch to ${cycle} billing` : `Choose ${plan.name}`}</button>}
    </article>)}</div>
    {pendingPlan && <div className="billing-wait card"><span className="status-dot" />Paystack checkout is open in another tab. This page will refresh your plan after payment is verified.</div>}
    {error && <div className="err">{error}</div>}
    <p className="billing-footnote">All prices are in Nigerian naira. Annual billing is priced at ten monthly payments. Subscription activation happens only after Paystack confirms payment. Feature access is retained throughout the current subscription period.</p>
  </>;
}

function Insights() {
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState("");
  useEffect(() => { api("/analytics/ai-insights").then(setResult).catch((e) => setError(e.message)); }, []);
  return <>
    <section className="welcome-row"><div><div className="eyebrow">PREMIUM · INVENTORY INTELLIGENCE</div><h1>Smart insights</h1>
      <p>Sales-velocity forecasts and reorder guidance based on your recent business data.</p></div></section>
    <div className="insight-method card"><span className="insight-spark">✧</span><div><b>Grounded in your sales and stock data</b>
      <p>{result?.method ?? "We analyze your recent sales and stock levels locally. No external AI service is called."}</p></div></div>
    {error && <div className="err">{error}</div>}
    {!result && !error && <div className="card">Analyzing your recent sales and stock…</div>}
    {result && <div className="insight-list">{result.insights.map((item: any, i: number) => <article className={`insight-card card priority-${item.priority}`} key={`${item.type}-${item.product}-${i}`}>
      <span className="insight-type">{item.type === "stockout" ? "STOCKOUT RISK" : item.type === "reorder" ? "REORDER FORECAST" : item.type === "trend" ? "SALES TREND" : "INVENTORY HEALTH"}</span>
      <h3>{item.title}</h3><p>{item.detail}</p>{item.product && <span className="insight-product">{item.product}</span>}
    </article>)}</div>}
    {result && <p className="billing-footnote">Based on the 30 days ending {new Date(result.generatedAt).toLocaleString("en-NG")}. Forecasts are estimates and should be reviewed before placing orders.</p>}
  </>;
}

function POS({ me, online, onQueued, toast }: { me: any; online: boolean; onQueued: (n: number) => void; toast: (s: string) => void }) {
  const [q, setQ] = useState(""); const [products, setProducts] = useState<any[]>([]);
  const [cart, setCart] = useState<any[]>([]); const [method, setMethod] = useState("CASH");
  const [tendered, setTendered] = useState(""); const [receipt, setReceipt] = useState<any>(null); const [err, setErr] = useState("");
  const [customers, setCustomers] = useState<any[]>([]); const [customerId, setCustomerId] = useState("");
  const [scanFeatures, setScanFeatures] = useState<any>(null); const [scanMode, setScanMode] = useState<"barcode" | "qr" | null>(null);
  useEffect(() => { const t = setTimeout(() => api(`/products?q=${encodeURIComponent(q)}`).then((p) => { setProducts(p); localStorage.setItem("catalogue", JSON.stringify(p)); })
    .catch(() => setProducts(JSON.parse(localStorage.getItem("catalogue") ?? "[]"))), 200); return () => clearTimeout(t); }, [q]);
  useEffect(() => { api("/subscription").then((result) => setScanFeatures(result.features)).catch((e) => setErr(e.message)); }, []);
  useEffect(() => {
    if (method !== "CREDIT") return;
    api("/customers").then(setCustomers).catch((e) => setErr(e.message));
  }, [method]);
  const add = (p: any) => setCart((c) => { const e = c.find((x) => x.product_id === p.product_id); return e ? c.map((x) => x === e ? { ...x, qty: x.qty + 1 } : x) : [...c, { ...p, qty: 1 }]; });
  const addScannedProduct = async (code: string, mode: "barcode" | "qr") => {
    setScanMode(null); setErr("");
    try {
      const product = await api(`/products/lookup/${mode}?code=${encodeURIComponent(code)}`);
      if (product.quantity < 1) { setErr(`${product.product_name} is out of stock.`); return; }
      add(product); setQ(""); toast(`${product.product_name} added to sale`);
    } catch (e: any) { setErr(e.message); }
  };
  const taxRate = Number(me.business?.tax_rate ?? 0);
  const subtotal = cart.reduce((t, i) => t + i.qty * i.selling_price, 0); const vat = Math.round(subtotal * taxRate) / 100; const total = subtotal + vat;
  const checkout = async () => {
    setErr("");
    const paidAmount = tendered.trim() ? Number(tendered) : undefined;
    if (tendered.trim() && (!Number.isFinite(paidAmount) || paidAmount! < 0)) { setErr("Enter a valid payment amount."); return; }
    if (method === "CREDIT" && !customerId) { setErr("Select a customer for a credit sale."); return; }
    const body = { items: cart.map((i) => ({ productId: i.product_id, quantity: i.qty })), paymentMethod: method,
      amountPaid: ["CASH", "CREDIT"].includes(method) ? paidAmount : undefined, customerId: customerId || undefined };
    if (!online) { onQueued(await queueSale(body)); setCart([]); return; }
    try {
      const r = await api("/sales", { method: "POST", body });
      if (method === "PAYSTACK") { const init = await api("/payments/paystack/initialize", { method: "POST", body: { saleId: r.saleId, email: "customer@example.com" } }); r.paystackUrl = init.authorization_url; }
      setReceipt({ ...r, items: cart, method, customer: customers.find((c) => c.customer_id === customerId)?.customer_name });
      setCart([]); setTendered(""); setCustomerId(""); r.alerts?.forEach((a: string) => toast(a));
    } catch (x: any) { setErr(x.message); }
  };
  return <>
    <h2>Point of Sale</h2>
    <div className="pos">
      <div className="card"><div className="pos-catalog-tools"><input className="search" placeholder="Search name, SKU or scan with a hardware scanner…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        <div className="pos-scan-actions">
          {scanFeatures?.barcodeScanning && <button className="secondary-button" onClick={() => setScanMode("barcode")}>Scan barcode</button>}
          {scanFeatures?.qrScanning && <button className="secondary-button" onClick={() => setScanMode("qr")}>Scan QR code</button>}
        </div></div>
        {scanFeatures && !scanFeatures.barcodeScanning && <small className="scan-upgrade-hint">Camera barcode scanning is available on Standard and Premium.</small>}
        <div className="plist">{products.map((p) => <button key={p.product_id} className="pitem" disabled={p.quantity < 1} onClick={() => add(p)}>
          <b>{p.product_name}</b><span>{naira(p.selling_price)}</span><small className={p.quantity <= p.reorder_level ? "warn" : ""}>{p.quantity} in stock</small></button>)}</div></div>
      <div className="card cart"><h3>Current sale</h3>
        {cart.length === 0 && <p className="muted">Tap a product to add it.</p>}
        {cart.map((i) => <div key={i.product_id} className="line"><span>{i.product_name}</span>
          <span className="qty"><button onClick={() => setCart(cart.map((x) => x === i ? { ...x, qty: Math.max(1, x.qty - 1) } : x))}>−</button>{i.qty}<button onClick={() => add(i)}>+</button></span>
          <span>{naira(i.qty * i.selling_price)}</span><button className="x" onClick={() => setCart(cart.filter((x) => x !== i))}>×</button></div>)}
        <div className="totals"><div><span>Subtotal</span><span>{naira(subtotal)}</span></div><div><span>Tax {taxRate}%</span><span>{naira(vat)}</span></div><div className="big"><span>Total</span><span>{naira(total)}</span></div></div>
        <div className="methods">{["CASH", "TRANSFER", "PAYSTACK", "CREDIT"].map((m) => <button key={m} className={method === m ? "on" : ""} onClick={() => setMethod(m)}>{m === "PAYSTACK" ? "Card (Paystack)" : m[0] + m.slice(1).toLowerCase()}</button>)}</div>
        {method === "CREDIT" && <label>Customer<select value={customerId} onChange={(e) => setCustomerId(e.target.value)} required>
          <option value="">Select customer</option>{customers.map((c) => <option key={c.customer_id} value={c.customer_id}>{c.customer_name} · Owes {naira(c.outstanding_balance)}</option>)}
        </select>{customers.length === 0 && <small className="field-hint">Add a customer before recording a credit sale.</small>}</label>}
        {["CASH", "CREDIT"].includes(method) && <label>{method === "CREDIT" ? "Amount received now (optional)" : "Cash received"}
          <input type="number" min="0" step="0.01" value={tendered} onChange={(e) => setTendered(e.target.value)} placeholder={method === "CREDIT" ? "0.00" : total.toFixed(2)} /></label>}
        {err && <div className="err">{err}</div>}
        <button className="primary" disabled={!cart.length} onClick={checkout}>Complete sale · {naira(total)}</button></div>
    </div>
    {receipt && <div className="modal" onClick={() => setReceipt(null)}><div className="receipt" onClick={(e) => e.stopPropagation()}>
      <h3>Sale complete</h3><div className="muted">{receipt.invoiceNo} · {ddmmyyyy(receipt.createdAt)}</div>
      <table><tbody>{receipt.items.map((i: any) => <tr key={i.product_id}><td>{i.qty} × {i.product_name}</td><td>{naira(i.qty * i.selling_price)}</td></tr>)}</tbody></table>
      <div className="totals"><div><span>Subtotal</span><span>{naira(receipt.subtotal)}</span></div><div><span>VAT</span><span>{naira(receipt.tax)}</span></div>
        <div className="big"><span>Total</span><span>{naira(receipt.grandTotal)}</span></div><div><span>Paid ({receipt.method})</span><span>{naira(receipt.amountPaid)}</span></div>
        {receipt.change > 0 && <div><span>Change</span><span>{naira(receipt.change)}</span></div>}<div><span>Status</span><span>{receipt.paymentStatus}</span></div></div>
      {receipt.paystackUrl && <a className="primary btn" href={receipt.paystackUrl} target="_blank">Open Paystack checkout</a>}
      <button className="link" onClick={() => setReceipt(null)}>New sale</button></div></div>}
    {scanMode && <CodeScanner mode={scanMode} onDetected={(code) => { void addScannedProduct(code, scanMode); }} onClose={() => setScanMode(null)} />}
  </>;
}

function CodeScanner({ mode, onDetected, onClose }: { mode: "barcode" | "qr"; onDetected: (code: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const detectedRef = useRef(onDetected);
  const [error, setError] = useState("");
  useEffect(() => { detectedRef.current = onDetected; }, [onDetected]);
  useEffect(() => {
    let active = true;
    let controls: { stop: () => void } | undefined;
    const start = async () => {
      const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
        import("@zxing/browser"), import("@zxing/library"),
      ]);
      if (!active || !videoRef.current) return;
      const formats = mode === "qr"
        ? [BarcodeFormat.QR_CODE]
        : [BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.EAN_8, BarcodeFormat.EAN_13,
          BarcodeFormat.CODE_39, BarcodeFormat.CODE_93, BarcodeFormat.CODE_128, BarcodeFormat.ITF, BarcodeFormat.CODABAR];
      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, formats);
      const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 300 });
      controls = await reader.decodeFromConstraints({ video: { facingMode: { ideal: "environment" } } }, videoRef.current, (result) => {
        if (result && active) {
          active = false;
          detectedRef.current(result.getText());
        }
      });
      if (!active) controls.stop();
    };
    start().catch((e: unknown) => {
      if (active) setError(e instanceof Error ? e.message : "Could not start the camera.");
    });
    return () => {
      active = false;
      controls?.stop();
    };
  }, [mode]);
  return <div className="modal scanner-backdrop" onClick={onClose}><section className="scanner-modal card" role="dialog" aria-modal="true" aria-labelledby="scanner-title" onClick={(e) => e.stopPropagation()}>
    <div className="scanner-heading"><div><div className="eyebrow">POINT OF SALE</div><h3 id="scanner-title">Scan {mode === "qr" ? "a QR code" : "a barcode"}</h3></div><button className="close-button" aria-label="Close scanner" onClick={onClose}>×</button></div>
    <video ref={videoRef} autoPlay muted playsInline />
    <p className="muted">{mode === "qr" ? "Center the product QR code in the camera." : "Center the product barcode in the camera."}</p>
    {error && <div className="err" role="alert">{error} Check camera permission and use a secure connection (HTTPS or localhost).</div>}
    <button className="secondary-button" onClick={onClose}>Cancel scan</button>
  </section></div>;
}

function Inventory({ me, toast }: { me: any; toast: (s: string) => void }) {
  const [rows, setRows] = useState<any[]>([]); const [show, setShow] = useState(false); const [f, setF] = useState<any>({});
  const [adjusting, setAdjusting] = useState<any>(null); const [change, setChange] = useState(""); const [reason, setReason] = useState(""); const [adjustError, setAdjustError] = useState("");
  const load = () => api("/products").then(setRows).catch((e) => toast(e.message)); useEffect(() => { load(); }, []);
  const canEdit = me.role !== "SALES_STAFF";
  const save = async () => {
    try { await api("/products", { method: "POST", body: { ...f, expiryDate: f.expiryDate || undefined, costPrice: +f.costPrice, sellingPrice: +f.sellingPrice, reorderLevel: +(f.reorderLevel ?? 0), openingStock: +(f.openingStock ?? 0) } });
      setShow(false); setF({}); load(); toast("Product added"); } catch (x: any) { toast(x.message); }
  };
  const adjustStock = async (e: any) => {
    e.preventDefault(); setAdjustError("");
    const amount = Number(change);
    if (!Number.isInteger(amount) || amount === 0) { setAdjustError("Enter a non-zero whole number of units."); return; }
    try {
      const result = await api(`/inventory/adjust`, { method: "POST", body: { productId: adjusting.product_id, change: amount, reason } });
      await load(); setAdjusting(null); setChange(""); setReason(""); toast(`Stock updated to ${result.quantity}`);
    } catch (x: any) { setAdjustError(x.message); }
  };
  return <>
    <div className="head"><h2>Inventory</h2>{canEdit && <button className="primary" onClick={() => setShow(!show)}>+ Add product</button>}</div>
    {show && <div className="card form">{[["productName", "Product name"], ["sku", "SKU"], ["barcode", "Barcode"], ["category", "Category"], ["costPrice", "Cost price (₦)"], ["sellingPrice", "Selling price (₦)"], ["openingStock", "Opening stock"], ["reorderLevel", "Re-order level"]]
      .map(([k, l]) => <label key={k}>{l}<input value={f[k] ?? ""} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>)}<label>Expiry date<input type="date" min={new Date().toISOString().slice(0, 10)} value={f.expiryDate ?? ""} onChange={(e) => setF({ ...f, expiryDate: e.target.value })} /><small className="field-hint">Optional; alerts appear when stock expires or is within 30 days of expiry.</small></label><button className="primary" onClick={save}>Save product</button></div>}
    {adjusting && <form className="card stock-adjust-form" onSubmit={adjustStock}><div className="section-heading"><div><div className="eyebrow">INVENTORY CONTROL</div><h3>Adjust {adjusting.product_name}</h3></div><button type="button" className="close-button" aria-label="Close adjustment" onClick={() => setAdjusting(null)}>×</button></div>
      <p className="muted">Current stock: {adjusting.quantity}. Enter a positive number to add units or a negative number to remove them.</p>
      <div className="stock-adjust-fields"><label>Quantity change<input autoFocus type="number" step="1" value={change} onChange={(e) => setChange(e.target.value)} placeholder="e.g. 5 or -2" required /></label>
        <label>Reason<input value={reason} onChange={(e) => setReason(e.target.value)} minLength={3} maxLength={120} placeholder="e.g. Physical stock count" required /></label>
        <button className="primary">Save adjustment</button></div>{adjustError && <div className="err" role="alert">{adjustError}</div>}
    </form>}
    <div className="card inventory-table-card"><div className="table-scroll"><table><thead><tr><th>Product</th><th>SKU</th><th>Category</th><th>Cost</th><th>Price</th><th>In stock</th><th>Expiry date</th><th>Status</th>{canEdit && <th>Action</th>}</tr></thead><tbody>
      {rows.map((r) => {
        const expiryDays = r.expiry_date ? daysUntilDate(r.expiry_date) : null;
        return <tr key={r.product_id}><td>{r.product_name}</td><td>{r.sku}</td><td>{r.category_name}</td><td>{naira(r.cost_price)}</td><td>{naira(r.selling_price)}</td><td>{r.quantity}</td>
          <td>{r.expiry_date ? new Date(`${r.expiry_date}T00:00:00`).toLocaleDateString("en-NG") : "—"}</td>
          <td>{r.quantity === 0 ? <span className="pill bad">Out of stock</span> : r.quantity <= r.reorder_level ? <span className="pill warn">Re-order</span> : expiryDays !== null && expiryDays < 0 ? <span className="pill bad">Expired</span> : expiryDays !== null && expiryDays <= 30 ? <span className="pill warn">Expiring soon</span> : <span className="pill">OK</span>}</td>
          {canEdit && <td><button className="edit-button" onClick={() => { setAdjusting(r); setChange(""); setReason(""); setAdjustError(""); }}>Adjust stock</button></td>}</tr>;
      })}</tbody></table></div></div>
  </>;
}

function Purchasing({ toast }: { toast: (s: string) => void }) {
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [supplierForm, setSupplierForm] = useState(false);
  const [supplierName, setSupplierName] = useState("");
  const [supplierPhone, setSupplierPhone] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [items, setItems] = useState([{ productId: "", quantity: "", unitCost: "" }]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = async () => {
    try {
      const [supplierRows, productRows, orderRows] = await Promise.all([api("/suppliers"), api("/products"), api("/purchases")]);
      setSuppliers(supplierRows); setProducts(productRows); setOrders(orderRows);
    } catch (e: any) { setError(e.message); }
  };
  useEffect(() => { load(); }, []);
  const createSupplier = async (e: any) => {
    e.preventDefault(); setBusy(true); setError("");
    try {
      const supplier = await api("/suppliers", { method: "POST", body: { supplierName, phone: supplierPhone || undefined } });
      setSuppliers((current) => [...current, supplier].sort((a, b) => a.supplier_name.localeCompare(b.supplier_name)));
      setSupplierId(supplier.supplier_id); setSupplierName(""); setSupplierPhone(""); setSupplierForm(false);
      toast("Supplier added");
    } catch (x: any) { setError(x.message); }
    finally { setBusy(false); }
  };
  const createOrder = async (e: any) => {
    e.preventDefault(); setError("");
    const parsedItems = items.map((item) => ({ productId: item.productId, quantity: Number(item.quantity), unitCost: Number(item.unitCost) }));
    if (!supplierId || parsedItems.some((item) => !item.productId || !Number.isInteger(item.quantity) || item.quantity < 1 || !Number.isFinite(item.unitCost) || item.unitCost < 0)) {
      setError("Choose a supplier and enter a product, positive whole-number quantity, and valid unit cost for every line.");
      return;
    }
    setBusy(true);
    try {
      await api("/purchases", { method: "POST", body: { supplierId, items: parsedItems } });
      await load(); setItems([{ productId: "", quantity: "", unitCost: "" }]); toast("Purchase order created");
    } catch (x: any) { setError(x.message); }
    finally { setBusy(false); }
  };
  const receiveOrder = async (order: any) => {
    setError(""); setBusy(true);
    try {
      await api(`/purchases/${order.purchase_id}/receive`, { method: "POST", body: {} });
      await load(); toast(`${order.po_number} received; inventory updated`);
    } catch (x: any) { setError(x.message); }
    finally { setBusy(false); }
  };
  return <>
    <section className="welcome-row"><div><div className="eyebrow">INVENTORY OPERATIONS</div><h1>Purchasing</h1><p>Create purchase orders, manage suppliers, and receive deliveries into stock.</p></div>
      <button className="secondary-button" onClick={() => setSupplierForm((show) => !show)}>{supplierForm ? "Cancel" : "＋ Add supplier"}</button></section>
    {error && <div className="err" role="alert">{error}</div>}
    {supplierForm && <form className="card purchase-form" onSubmit={createSupplier}><div className="section-heading"><div><div className="eyebrow">SUPPLIER DIRECTORY</div><h3>Add a supplier</h3></div></div>
      <div className="purchase-form-fields"><label>Supplier name<input required minLength={2} maxLength={150} value={supplierName} onChange={(e) => setSupplierName(e.target.value)} /></label>
        <label>Phone (optional)<input type="tel" value={supplierPhone} onChange={(e) => setSupplierPhone(e.target.value)} /></label>
        <button className="primary" disabled={busy}>Save supplier</button></div></form>}
    <form className="card purchase-form" onSubmit={createOrder}><div className="section-heading"><div><div className="eyebrow">STOCK REPLENISHMENT</div><h3>New purchase order</h3><p className="team-help">Receiving an order will add the ordered quantities to this branch’s stock.</p></div></div>
      <label>Supplier<select required value={supplierId} onChange={(e) => setSupplierId(e.target.value)}><option value="">Select supplier</option>{suppliers.map((s) => <option key={s.supplier_id} value={s.supplier_id}>{s.supplier_name}</option>)}</select></label>
      {!suppliers.length && <p className="muted">Add a supplier before creating a purchase order.</p>}
      <div className="purchase-lines">{items.map((item, index) => <div className="purchase-line" key={index}>
        <label>Product<select required value={item.productId} onChange={(e) => {
          const product = products.find((p) => p.product_id === e.target.value);
          setItems((current) => current.map((line, i) => i === index ? { ...line, productId: e.target.value, unitCost: product ? String(product.cost_price) : line.unitCost } : line));
        }}><option value="">Select product</option>{products.map((p) => <option key={p.product_id} value={p.product_id}>{p.product_name} · {p.sku}</option>)}</select></label>
        <label>Quantity<input required type="number" min="1" step="1" value={item.quantity} onChange={(e) => setItems((current) => current.map((line, i) => i === index ? { ...line, quantity: e.target.value } : line))} /></label>
        <label>Unit cost (₦)<input required type="number" min="0" step="0.01" value={item.unitCost} onChange={(e) => setItems((current) => current.map((line, i) => i === index ? { ...line, unitCost: e.target.value } : line))} /></label>
        {items.length > 1 && <button type="button" className="remove-line" aria-label="Remove item" onClick={() => setItems((current) => current.filter((_, i) => i !== index))}>×</button>}
      </div>)}</div>
      <div className="purchase-form-actions"><button type="button" className="secondary-button" onClick={() => setItems((current) => [...current, { productId: "", quantity: "", unitCost: "" }])}>＋ Add product line</button>
        <button className="primary" disabled={busy || !suppliers.length || !products.length}>Create purchase order</button></div>
    </form>
    <div className="card purchase-orders"><div className="section-heading"><div><div className="eyebrow">PURCHASE HISTORY</div><h3>Purchase orders</h3></div><span className="count-badge">{orders.length} orders</span></div>
      {orders.length ? <div className="purchase-order-list">{orders.map((order) => <article className="purchase-order" key={order.purchase_id}>
        <div className="purchase-order-heading"><div><b>{order.po_number}</b><small>{order.supplier_name} · {order.order_date}</small></div>
          <div className="purchase-order-summary"><span className={`pill ${order.status === "RECEIVED" ? "" : "warn"}`}>{order.status === "RECEIVED" ? "Received" : "Awaiting delivery"}</span><b>{naira(order.total_amount)}</b></div></div>
        <div className="purchase-order-items">{(order.items ?? []).map((item: any) => <div key={item.product_id}><span>{item.product_name}</span><span>{item.quantity_received}/{item.quantity_ordered} units · {naira(item.unit_cost)} each</span></div>)}</div>
        {order.status !== "RECEIVED" && <button className="secondary-button receive-button" disabled={busy} onClick={() => receiveOrder(order)}>Receive full order</button>}
      </article>)}</div> : <div className="empty-state"><b>No purchase orders yet</b><p>Create an order above to restock your products.</p></div>}
    </div>
  </>;
}

function Sales() {
  const [rows, setRows] = useState<any[]>([]); const [sel, setSel] = useState<any>(null);
  useEffect(() => { api("/sales").then(setRows); }, []);
  return <>
    <h2>Sales history</h2>
    <div className="card"><div className="table-scroll"><table><thead><tr><th>Date</th><th>Invoice</th><th>Cashier</th><th>Method</th><th>Total</th><th>Status</th></tr></thead><tbody>
      {rows.map((r) => <tr key={r.sale_id} className="click" onClick={() => api(`/sales/${r.sale_id}`).then(setSel)}><td>{ddmmyyyy(r.created_at)}</td><td>{r.invoice_no}</td><td>{r.cashier}</td><td>{r.methods ?? "—"}</td><td>{naira(r.grand_total)}</td>
        <td><span className={`pill ${r.payment_status === "PAID" ? "" : "warn"}`}>{r.payment_status}</span></td></tr>)}</tbody></table></div></div>
    {sel && <div className="modal" onClick={() => setSel(null)}><div className="receipt" onClick={(e) => e.stopPropagation()}>
      <h3>{sel.business_name}</h3><div className="muted">{sel.address} · {sel.phone}</div><div className="muted">{sel.invoice_no} · {ddmmyyyy(sel.created_at)} · Cashier: {sel.cashier}</div>
      <table><tbody>{sel.items.map((i: any, k: number) => <tr key={k}><td>{i.quantity} × {i.product_name}</td><td>{naira(i.line_total)}</td></tr>)}</tbody></table>
      <div className="totals"><div><span>VAT</span><span>{naira(sel.tax_amount)}</span></div><div className="big"><span>Total</span><span>{naira(sel.grand_total)}</span></div><div><span>Paid</span><span>{naira(sel.amount_paid)}</span></div></div>
      <button className="link" onClick={() => window.print()}>Print receipt</button></div></div>}
  </>;
}

function CRM({ toast }: { toast: (s: string) => void }) {
  const blank = () => ({ customerName: "", phone: "", email: "", address: "", creditLimit: "0", tags: "", notes: "" });
  const [rows, setRows] = useState<any[]>([]);
  const [form, setForm] = useState(blank());
  const [detailForm, setDetailForm] = useState<any>(null);
  const [detail, setDetail] = useState<any>(null);
  const [interaction, setInteraction] = useState({ interactionType: "NOTE", subject: "", notes: "", followUpAt: "" });
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");
  const load = () => api<any[]>("/customers").then(setRows).catch((e) => setError(e.message));
  const loadDetail = async (id: string) => {
    try {
      const result = await api(`/customers/${id}`);
      setDetail(result);
      setDetailForm({ ...result.customer, customerName: result.customer.customer_name, creditLimit: String(result.customer.credit_limit), tags: (result.customer.tags ?? []).join(", ") });
    } catch (e: any) { setError(e.message); }
  };
  useEffect(() => { load(); }, []);
  const filtered = rows.filter((row) => `${row.customer_name} ${row.phone ?? ""} ${row.email ?? ""} ${(row.tags ?? []).join(" ")}`.toLowerCase().includes(search.toLowerCase()));
  const save = async (e: any) => {
    e.preventDefault(); setError("");
    try {
      await api("/customers", { method: "POST", body: { ...form, creditLimit: Number(form.creditLimit), tags: form.tags.split(",").map((tag) => tag.trim()).filter(Boolean) } });
      setForm(blank()); setShowForm(false); await load(); toast("Customer added");
    } catch (x: any) { setError(x.message); }
  };
  const saveProfile = async (e: any) => {
    e.preventDefault(); setError("");
    try {
      await api(`/customers/${detail.customer.customer_id}`, { method: "PUT", body: {
        customerName: detailForm.customerName, phone: detailForm.phone ?? "", email: detailForm.email ?? "",
        address: detailForm.address ?? "", creditLimit: Number(detailForm.creditLimit), notes: detailForm.notes ?? "",
        tags: String(detailForm.tags ?? "").split(",").map((tag: string) => tag.trim()).filter(Boolean),
      } });
      await Promise.all([load(), loadDetail(detail.customer.customer_id)]); toast("Customer profile updated");
    } catch (x: any) { setError(x.message); }
  };
  const addInteraction = async (e: any) => {
    e.preventDefault(); setError("");
    try {
      await api(`/customers/${detail.customer.customer_id}/interactions`, { method: "POST", body: {
        ...interaction, followUpAt: interaction.followUpAt ? new Date(interaction.followUpAt).toISOString() : null,
      } });
      setInteraction({ interactionType: "NOTE", subject: "", notes: "", followUpAt: "" });
      await Promise.all([load(), loadDetail(detail.customer.customer_id)]); toast("Activity logged");
    } catch (x: any) { setError(x.message); }
  };
  return <>
    <div className="head"><div><div className="eyebrow">CUSTOMER RELATIONSHIPS</div><h2>CRM</h2></div><button className="primary" onClick={() => setShowForm((open) => !open)}>{showForm ? "Cancel" : "＋ Add customer"}</button></div>
    {error && <div className="err" role="alert">{error}</div>}
    <div className="crm-metrics"><div><span>Customers</span><strong>{rows.length}</strong></div><div><span>Lifetime sales</span><strong>{naira(rows.reduce((sum, row) => sum + Number(row.lifetime_value ?? 0), 0))}</strong></div><div><span>Open credit</span><strong>{naira(rows.reduce((sum, row) => sum + Number(row.outstanding_balance ?? 0), 0))}</strong></div><div><span>Follow-ups logged</span><strong>{rows.reduce((sum, row) => sum + Number(row.interaction_count ?? 0), 0)}</strong></div></div>
    {showForm && <form className="card" onSubmit={save}><div className="section-heading"><div><div className="eyebrow">CUSTOMER DIRECTORY</div><h3>Add a customer</h3></div></div>
      <div className="crm-form-grid"><label>Customer name<input required minLength={2} maxLength={120} value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} /></label>
        <label>Phone<input required type="tel" pattern="\+?\d{10,14}" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="08031234567" /></label>
        <label>Email<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
        <label>Address<input maxLength={255} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></label>
        <label>Credit limit (₦)<input type="number" min="0" step="0.01" value={form.creditLimit} onChange={(e) => setForm({ ...form, creditLimit: e.target.value })} /></label>
        <label>Tags, separated by commas<input maxLength={300} value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="Wholesale, VIP" /></label>
        <label className="crm-wide">Notes<textarea maxLength={5000} rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
        <button className="primary">Save customer</button></div></form>}
    <div className="card"><div className="section-heading"><div><div className="eyebrow">CUSTOMER ACCOUNTS</div><h3>Directory</h3><p className="team-help">Purchase history, credit status, and logged customer touchpoints.</p></div><span className="count-badge">{filtered.length} customers</span></div>
      <div className="crm-toolbar"><input aria-label="Search customers" placeholder="Search name, phone, email, or tag" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      {filtered.length ? <div className="table-scroll"><table><thead><tr><th>Customer</th><th>Contact</th><th>Orders</th><th>Lifetime sales</th><th>Balance</th><th>Last purchase</th></tr></thead><tbody>
        {filtered.map((row) => <tr key={row.customer_id} className="click" onClick={() => loadDetail(row.customer_id)}><td><strong>{row.customer_name}</strong><div className="crm-tags">{(row.tags ?? []).map((tag: string) => <span className="crm-tag" key={tag}>{tag}</span>)}</div></td><td>{row.phone || "—"}<div className="muted">{row.email || ""}</div></td><td>{row.orders_count}</td><td>{naira(row.lifetime_value)}</td><td className={row.outstanding_balance > 0 ? "warn" : ""}>{naira(row.outstanding_balance)}</td><td>{row.last_purchase_at ? ddmmyyyy(row.last_purchase_at) : "—"}</td></tr>)}
      </tbody></table></div> : <div className="empty-state"><b>{rows.length ? "No matching customers" : "No customers yet"}</b><p>Add customer accounts to keep contact and sales history together.</p></div>}
    </div>
    {detail && detailForm && <div className="modal crm-overlay" onClick={() => setDetail(null)}><section className="crm-modal" role="dialog" aria-modal="true" aria-label={`${detail.customer.customer_name} customer profile`} onClick={(e) => e.stopPropagation()}>
      <div className="head"><div><div className="eyebrow">CUSTOMER PROFILE</div><h2>{detail.customer.customer_name}</h2></div><button className="link" onClick={() => setDetail(null)}>Close</button></div>
      <div className="crm-detail-metrics"><div><span>Orders</span><strong>{detail.sales.length}</strong></div><div><span>Lifetime sales</span><strong>{naira(detail.sales.reduce((sum: number, sale: any) => sum + Number(sale.grand_total), 0))}</strong></div><div><span>Outstanding</span><strong>{naira(detail.customer.outstanding_balance)}</strong></div></div>
      {error && <div className="err" role="alert">{error}</div>}
      <div className="crm-detail-grid"><form className="crm-section" onSubmit={saveProfile}><div className="section-heading"><div><h3>Contact details</h3></div></div>
        <label>Name<input required value={detailForm.customerName} onChange={(e) => setDetailForm({ ...detailForm, customerName: e.target.value })} /></label>
        <label>Phone<input value={detailForm.phone ?? ""} onChange={(e) => setDetailForm({ ...detailForm, phone: e.target.value })} /></label>
        <label>Email<input type="email" value={detailForm.email ?? ""} onChange={(e) => setDetailForm({ ...detailForm, email: e.target.value })} /></label>
        <label>Address<input value={detailForm.address ?? ""} onChange={(e) => setDetailForm({ ...detailForm, address: e.target.value })} /></label>
        <label>Credit limit (₦)<input type="number" min="0" step="0.01" value={detailForm.creditLimit} onChange={(e) => setDetailForm({ ...detailForm, creditLimit: e.target.value })} /></label>
        <label>Tags<input value={detailForm.tags} onChange={(e) => setDetailForm({ ...detailForm, tags: e.target.value })} /></label>
        <label>Notes<textarea rows={3} value={detailForm.notes ?? ""} onChange={(e) => setDetailForm({ ...detailForm, notes: e.target.value })} /></label>
        <button className="primary">Save profile</button>
      </form><form className="crm-section" onSubmit={addInteraction}><div className="section-heading"><div><h3>Log an interaction</h3><p className="team-help">Calls, emails, meetings, and notes.</p></div></div>
        <label>Type<select value={interaction.interactionType} onChange={(e) => setInteraction({ ...interaction, interactionType: e.target.value })}><option value="NOTE">Note</option><option value="CALL">Call</option><option value="EMAIL">Email</option><option value="MEETING">Meeting</option></select></label>
        <label>Subject<input required minLength={2} maxLength={120} value={interaction.subject} onChange={(e) => setInteraction({ ...interaction, subject: e.target.value })} /></label>
        <label>Notes<textarea rows={3} value={interaction.notes} onChange={(e) => setInteraction({ ...interaction, notes: e.target.value })} /></label>
        <label>Follow-up<input type="datetime-local" value={interaction.followUpAt} onChange={(e) => setInteraction({ ...interaction, followUpAt: e.target.value })} /></label>
        <button className="secondary">Log activity</button>
      </form></div>
      <div className="crm-detail-grid crm-history-grid"><section className="crm-section"><div className="section-heading"><h3>Recent activity</h3><span className="count-badge">{detail.interactions.length}</span></div>
        {detail.interactions.length ? <div className="crm-timeline">{detail.interactions.map((item: any) => <article key={item.interaction_id}><div className="crm-timeline-top"><span className="crm-tag">{item.interaction_type}</span><time>{ddmmyyyy(item.created_at)}</time></div><strong>{item.subject}</strong><p>{item.notes || "No notes"}</p>{item.follow_up_at && <small>Follow up {ddmmyyyy(item.follow_up_at)}</small>}<small>Logged by {item.created_by ?? "Team"}</small></article>)}</div> : <div className="empty-state"><b>No activity logged</b><p>Add the first customer touchpoint above.</p></div>}
      </section><section className="crm-section"><div className="section-heading"><h3>Purchase history</h3><span className="count-badge">{detail.sales.length}</span></div>
        {detail.sales.length ? <div className="table-scroll"><table><thead><tr><th>Invoice</th><th>Date</th><th>Total</th><th>Payment</th></tr></thead><tbody>{detail.sales.map((sale: any) => <tr key={sale.sale_id}><td>{sale.invoice_no}</td><td>{ddmmyyyy(sale.created_at)}</td><td>{naira(sale.grand_total)}</td><td>{sale.payment_status}</td></tr>)}</tbody></table></div> : <div className="empty-state"><b>No sales recorded</b><p>Completed sales linked to this customer appear here.</p></div>}
      </section></div>
    </section></div>}
  </>;
}

function Complaints({ me, toast }: { me: any; toast: (s: string) => void }) {
  const manager = ["OWNER", "ADMIN"].includes(me.role);
  const [rows, setRows] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [edit, setEdit] = useState<any>(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ customerId: "", category: "SERVICE", subject: "", description: "", priority: "NORMAL", assignedTo: "" });
  const load = () => api<any[]>(`/complaints${statusFilter ? `?status=${statusFilter}` : ""}`).then(setRows).catch((e) => setError(e.message));
  useEffect(() => {
    api<any[]>("/customers").then((items) => { setCustomers(items); if (items[0]) setForm((current) => ({ ...current, customerId: current.customerId || items[0].customer_id })); }).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [statusFilter]);
  useEffect(() => { if (manager) api<any[]>("/users").then(setUsers).catch((e) => setError(e.message)); }, [manager]);
  const filtered = rows.filter((row) => `${row.subject} ${row.customer_name} ${row.category} ${row.assigned_name ?? ""}`.toLowerCase().includes(search.toLowerCase()));
  const openCount = rows.filter((row) => row.status === "OPEN").length;
  const urgentCount = rows.filter((row) => row.priority === "URGENT" && !["RESOLVED", "CLOSED"].includes(row.status)).length;
  const create = async (e: any) => {
    e.preventDefault(); setError("");
    try {
      await api("/complaints", { method: "POST", body: { ...form, assignedTo: manager ? form.assignedTo || null : null } });
      setForm({ customerId: customers[0]?.customer_id ?? "", category: "SERVICE", subject: "", description: "", priority: "NORMAL", assignedTo: "" });
      setShowForm(false); await load(); toast("Complaint recorded");
    } catch (x: any) { setError(x.message); }
  };
  const openComplaint = (row: any) => { setSelected(row); setEdit({ status: row.status, priority: row.priority, assignedTo: row.assigned_to ?? "", resolution: row.resolution ?? "" }); };
  const saveComplaint = async (e: any) => {
    e.preventDefault(); setError("");
    try {
      const body: any = { status: edit.status, priority: edit.priority, resolution: edit.resolution };
      if (manager) body.assignedTo = edit.assignedTo || null;
      await api(`/complaints/${selected.complaint_id}`, { method: "PUT", body });
      setSelected(null); await load(); toast("Complaint updated");
    } catch (x: any) { setError(x.message); }
  };
  return <>
    <div className="head"><div><div className="eyebrow">CUSTOMER SERVICE</div><h2>Complaints</h2></div><button className="primary" onClick={() => setShowForm((open) => !open)}>{showForm ? "Cancel" : "＋ Record complaint"}</button></div>
    {error && <div className="err" role="alert">{error}</div>}
    <div className="crm-metrics complaint-metrics"><div><span>All shown</span><strong>{rows.length}</strong></div><div><span>Open</span><strong>{openCount}</strong></div><div><span>Urgent unresolved</span><strong>{urgentCount}</strong></div></div>
    {showForm && <form className="card" onSubmit={create}><div className="section-heading"><div><div className="eyebrow">CUSTOMER SUPPORT</div><h3>Record a complaint</h3></div></div>
      <div className="crm-form-grid"><label>Customer<select required value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })}><option value="">Select customer</option>{customers.map((customer) => <option key={customer.customer_id} value={customer.customer_id}>{customer.customer_name} · {customer.phone}</option>)}</select></label>
        <label>Category<select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}><option value="PRODUCT">Product</option><option value="PAYMENT">Payment</option><option value="DELIVERY">Delivery</option><option value="SERVICE">Service</option><option value="OTHER">Other</option></select></label>
        <label>Priority<select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}><option value="LOW">Low</option><option value="NORMAL">Normal</option><option value="HIGH">High</option><option value="URGENT">Urgent</option></select></label>
        <label>Subject<input required minLength={3} maxLength={160} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} /></label>
        {manager && <label>Assign to<select value={form.assignedTo} onChange={(e) => setForm({ ...form, assignedTo: e.target.value })}><option value="">Unassigned</option>{users.filter((user) => user.is_active).map((user) => <option key={user.user_id} value={user.user_id}>{user.full_name}</option>)}</select></label>}
        <label className="crm-wide">Description<textarea required minLength={5} maxLength={5000} rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
        <button className="primary" disabled={!customers.length}>Save complaint</button></div></form>}
    <div className="card"><div className="section-heading"><div><div className="eyebrow">SERVICE QUEUE</div><h3>Complaint records</h3></div><span className="count-badge">{filtered.length} shown</span></div>
      <div className="crm-toolbar"><input aria-label="Search complaints" placeholder="Search subject, customer, or assignee" value={search} onChange={(e) => setSearch(e.target.value)} /><select aria-label="Filter complaint status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option value="">All statuses</option><option value="OPEN">Open</option><option value="IN_PROGRESS">In progress</option><option value="RESOLVED">Resolved</option><option value="CLOSED">Closed</option></select></div>
      {filtered.length ? <div className="table-scroll"><table><thead><tr><th>Complaint</th><th>Customer</th><th>Category</th><th>Priority</th><th>Status</th><th>Assigned to</th><th>Reported</th></tr></thead><tbody>{filtered.map((row) => <tr key={row.complaint_id} className="click" onClick={() => openComplaint(row)}><td><strong>{row.subject}</strong><div className="muted">{row.invoice_no ? `Invoice ${row.invoice_no}` : "No linked sale"}</div></td><td>{row.customer_name}<div className="muted">{row.customer_phone}</div></td><td>{row.category.toLowerCase()}</td><td><span className={`complaint-priority priority-${row.priority.toLowerCase()}`}>{row.priority}</span></td><td><span className={`pill ${row.status === "OPEN" || row.status === "IN_PROGRESS" ? "warn" : ""}`}>{row.status.replaceAll("_", " ")}</span></td><td>{row.assigned_name ?? "Unassigned"}</td><td>{ddmmyyyy(row.created_at)}</td></tr>)}</tbody></table></div> : <div className="empty-state"><b>{rows.length ? "No matching complaints" : "No complaints recorded"}</b><p>Record a customer issue to start tracking ownership and resolution.</p></div>}
    </div>
    {selected && edit && <div className="modal crm-overlay" onClick={() => setSelected(null)}><form className="crm-modal complaint-modal" role="dialog" aria-modal="true" aria-label="Complaint details" onSubmit={saveComplaint} onClick={(e) => e.stopPropagation()}>
      <div className="head"><div><div className="eyebrow">{selected.customer_name} · {selected.category}</div><h2>{selected.subject}</h2></div><button type="button" className="link" onClick={() => setSelected(null)}>Close</button></div>
      <p className="complaint-description">{selected.description}</p><p className="team-help">Reported {ddmmyyyy(selected.created_at)} by {selected.created_by_name ?? "Team member"}{selected.invoice_no ? ` · Invoice ${selected.invoice_no}` : ""}</p>
      <div className="crm-form-grid"><label>Status<select value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}><option value="OPEN">Open</option><option value="IN_PROGRESS">In progress</option><option value="RESOLVED">Resolved</option><option value="CLOSED">Closed</option></select></label>
        <label>Priority<select value={edit.priority} onChange={(e) => setEdit({ ...edit, priority: e.target.value })}><option value="LOW">Low</option><option value="NORMAL">Normal</option><option value="HIGH">High</option><option value="URGENT">Urgent</option></select></label>
        {manager && <label>Assigned to<select value={edit.assignedTo} onChange={(e) => setEdit({ ...edit, assignedTo: e.target.value })}><option value="">Unassigned</option>{users.filter((user) => user.is_active).map((user) => <option key={user.user_id} value={user.user_id}>{user.full_name}</option>)}</select></label>}
        <label className="crm-wide">Resolution / response<textarea rows={4} maxLength={5000} value={edit.resolution} onChange={(e) => setEdit({ ...edit, resolution: e.target.value })} /></label>
      </div>
      <div className="complaint-modal-actions"><button type="button" className="secondary" onClick={() => setSelected(null)}>Cancel</button><button className="primary">Save changes</button></div>
    </form></div>}
  </>;
}

function csvCell(value: string | number | null | undefined, numeric = false) {
  const text = value == null ? "" : String(value);
  const isNumericValue = numeric && /^-?(?:\d+\.?\d*|\.\d+)$/.test(text);
  const safe = !isNumericValue && /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

function downloadReportCsv(report: any, days: number) {
  const headers = ["Section", "Period", "Metric", "Value", "Product", "Quantity", "Staff", "Sales", "Revenue"];
  const rows: (string | number | null | undefined)[][] = [
    ["Summary", `${days} days`, "Sales count", report.sales_count],
    ["Summary", `${days} days`, "Revenue (NGN)", report.revenue],
    ["Summary", `${days} days`, "Collected (NGN)", report.collected],
    ["Summary", `${days} days`, "Gross profit (NGN)", report.grossProfit],
    ["Summary", `${days} days`, "Gross margin (%)", report.grossMargin],
    ["Summary", `${days} days`, "Stock value at cost (NGN)", report.stock_value],
    ["Summary", `${days} days`, "Low-stock products", report.low_stock],
    ...(report.daily ?? []).map((item: any) => ["Daily revenue", item.day, "Revenue (NGN)", item.revenue]),
    ...(report.topProducts ?? []).map((item: any) => ["Top products", `${days} days`, "", "", item.product_name, item.qty, "", "", item.revenue]),
    ...(report.staff ?? []).map((item: any) => ["Staff performance", `${days} days`, "", "", "", "", item.full_name, item.sales, item.revenue]),
  ];
  const content = [headers, ...rows].map((row) => row.map((cell, index) => csvCell(cell, [3, 5, 7, 8].includes(index))).join(",")).join("\r\n");
  const blob = new Blob(["\uFEFF", content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `stockledger-report-${days}-days-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function Reports() {
  const [days, setDays] = useState(30); const [s, setS] = useState<any>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setS(null);
    setError("");
    api(`/reports/summary?days=${days}`).then((report) => {
      if (active) setS(report);
    }).catch((e) => {
      if (active) setError(e.message);
    });
    return () => { active = false; };
  }, [days]);
  return <>
    <div className="head report-head"><h2>Reports</h2><div className="report-actions"><select aria-label="Report period" value={days} onChange={(e) => setDays(+e.target.value)}><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option></select>
      <button className="secondary-button" disabled={!s} onClick={() => s && downloadReportCsv(s, days)}>Download report as CSV</button></div></div>
    {error && <div className="err" role="alert">{error}</div>}
    {!s && !error && <div className="card">Loading report…</div>}
    {s && <>
    <div className="kpis"><Kpi label="Revenue" value={naira(s.revenue)} /><Kpi label="Collected" value={naira(s.collected)} /><Kpi label="Gross profit" value={naira(s.grossProfit)} sub={`${s.grossMargin}% margin`} /><Kpi label="Transactions" value={s.sales_count} /></div>
    <div className="grid2">
      <div className="card"><h3>Top products</h3><div className="table-scroll"><table><thead><tr><th>Product</th><th>Qty</th><th>Revenue</th></tr></thead><tbody>{s.topProducts.map((t: any) => <tr key={t.product_name}><td>{t.product_name}</td><td>{t.qty}</td><td>{naira(t.revenue)}</td></tr>)}</tbody></table></div></div>
      <div className="card"><h3>Staff performance</h3><div className="table-scroll"><table><thead><tr><th>Staff</th><th>Sales</th><th>Revenue</th></tr></thead><tbody>{s.staff.map((t: any) => <tr key={t.full_name}><td>{t.full_name}</td><td>{t.sales}</td><td>{naira(t.revenue)}</td></tr>)}</tbody></table></div></div>
    </div>
    <div className="card"><h3>Revenue by day</h3><Bars data={s.daily.slice(-14)} /></div>
    </>}
  </>;
}
