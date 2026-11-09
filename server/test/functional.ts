// Functional, security and integration test suite. Prints a JSON array of results.
import crypto from "node:crypto";
import { Client } from "pg";
import { call } from "./seed";

const PS = "http://localhost:4100";
const SECRET = process.env.PAYSTACK_SECRET_KEY ?? "sk_test_local";
const results: { id: string; module: string; description: string; expected: string; actual: string; pass: boolean }[] = [];
let n = 0;
async function tc(module: string, description: string, expected: string, fn: () => Promise<[string, boolean]>) {
  const id = `TC${String(++n).padStart(2, "0")}`;
  try { const [actual, pass] = await fn(); results.push({ id, module, description, expected, actual, pass }); }
  catch (e: any) { results.push({ id, module, description, expected, actual: "Error: " + e.message, pass: false }); }
}
const u = () => crypto.randomBytes(3).toString("hex");
const dateFromToday = (days: number) => {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const stockOf = async (T: string, pid: string) => (await call("/products", T)).body.find((p: any) => p.product_id === pid).quantity;

async function main() {
  const tag = u();
  let A = "", B = "", staff = "", pid = "", saleId = "", customerSaleId = "", complaintId = "", cust = "", ownerId = "", staffId = "";
  await tc("Health", "Database-backed API health check", "200, database ready", async () => {
    const r = await fetch(`http://localhost:${process.env.API_PORT ?? "4000"}/api/health`);
    const body: any = await r.json();
    return [`${r.status}, ${body.status}`, r.status === 200 && body.status === "ok"];
  });
  await tc("Registration", "Register a new business with valid details", "201 Created, token returned", async () => {
    const r = await call("/auth/register", undefined, { businessName: "Test Mart " + tag, businessType: "Retail", email: `a${tag}@t.ng`, phone: "08030000000", state: "Rivers", ownerName: "Ada Obi", password: "Passw0rd!" });
    A = r.body.token; return [`${r.status}, token ${A ? "present" : "missing"}`, r.status === 201 && !!A];
  });
  await tc("Subscription", "Catalog exposes barcode and QR code plan features", "Standard includes barcode scanning; Premium includes barcode and QR code scanning", async () => {
    const plans = await call("/plans");
    const standard = plans.body.find((plan: any) => plan.id === "standard");
    const premium = plans.body.find((plan: any) => plan.id === "premium");
    return [`${plans.status}, Standard barcode ${standard?.barcodeScanning}, Premium barcode/QR ${premium?.barcodeScanning}/${premium?.qrScanning}`,
      plans.status === 200 && standard?.barcodeScanning === true && standard?.qrScanning === false
      && premium?.barcodeScanning === true && premium?.qrScanning === true
      && standard.features.includes("Camera barcode scanning") && premium.features.includes("Camera QR code scanning")];
  });
  await tc("Subscription", "Trial retains barcode and QR scanning access", "Both scanner entitlements are enabled during Trial", async () => {
    const current = await call("/subscription", A);
    return [`${current.body.subscription.plan_name}, barcode ${current.body.features.barcodeScanning}, QR ${current.body.features.qrScanning}`,
      current.status === 200 && current.body.subscription.plan_name === "Trial"
      && current.body.features.barcodeScanning === true && current.body.features.qrScanning === true];
  });
  await tc("Registration", "Register with an invalid phone number", "422, validation message", async () => {
    const r = await call("/auth/register", undefined, { businessName: "Bad", businessType: "Retail", email: `b${tag}@t.ng`, phone: "12", state: "Rivers", ownerName: "X Y", password: "Passw0rd!" });
    return [`${r.status}, "${r.body.details?.[0]}"`, r.status === 422];
  });
  await tc("Authentication", "Sign in with a wrong password", "401 Unauthorized", async () => {
    const r = await call("/auth/login", undefined, { email: `a${tag}@t.ng`, password: "wrong-pass" }); return [`${r.status}`, r.status === 401];
  });
  await tc("Authentication", "Call a protected endpoint without a token", "401 Unauthorized", async () => {
    const r = await call("/products"); return [`${r.status}`, r.status === 401];
  });
  await tc("User management", "Owner creates a sales-staff account", "201 Created", async () => {
    const r = await call("/users", A, { fullName: "Sam Staff", email: `s${tag}@t.ng`, phone: "08030000002", password: "Passw0rd!", role: "SALES_STAFF" });
    staff = (await call("/auth/login", undefined, { email: `s${tag}@t.ng`, password: "Passw0rd!" })).body.token;
    return [`${r.status}, phone ${r.body.phone}`, r.status === 201 && r.body.phone === "08030000002" && !!staff];
  });
  await tc("Profile", "Owner edits their own profile", "Updated profile details returned", async () => {
    const r = await call("/me", A, { fullName: "Ada Obi Updated", phone: "08031234568" }, "PUT");
    const me = await call("/me", A);
    return [`${r.status}, ${me.body.name}, ${me.body.phone}`, r.status === 200 && me.body.name === "Ada Obi Updated" && me.body.phone === "08031234568"];
  });
  await tc("Administration", "Owner updates business workspace settings", "Updated settings returned and reflected by /me", async () => {
    const before = await call("/me", A);
    const business = before.body.business;
    const r = await call("/business", A, {
      businessName: `${business.business_name} Updated`, businessType: business.business_type, email: business.email,
      phone: business.phone, address: business.address ?? "", state: business.state, taxRate: business.tax_rate,
    }, "PUT");
    const after = await call("/me", A);
    return [`${r.status}, ${after.body.business.business_name}`, r.status === 200 && after.body.business.business_name === `${business.business_name} Updated`];
  });
  let uploadedLogo = "";
  await tc("Business logo", "Owner adds an optional PNG logo", "Logo is saved and returned for the business", async () => {
    const business = (await call("/me", A)).body.business;
    uploadedLogo = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lE8AAAAASUVORK5CYII=";
    const saved = await call("/business", A, {
      businessName: business.business_name, businessType: business.business_type, email: business.email,
      phone: business.phone, address: business.address ?? "", state: business.state,
      taxRate: business.tax_rate, logoUrl: uploadedLogo,
    }, "PUT");
    const current = await call("/me", A);
    return [`${saved.status}, logo ${current.body.business.logo_url === uploadedLogo ? "saved" : "missing"}`,
      saved.status === 200 && current.body.business.logo_url === uploadedLogo];
  });
  await tc("Business logo", "Existing settings updates that omit a logo preserve it", "Logo remains unchanged when legacy clients update other settings", async () => {
    const business = (await call("/me", A)).body.business;
    const r = await call("/business", A, {
      businessName: business.business_name, businessType: business.business_type, email: business.email,
      phone: business.phone, address: business.address ?? "", state: business.state, taxRate: business.tax_rate,
    }, "PUT");
    const current = await call("/me", A);
    return [`${r.status}, logo ${current.body.business.logo_url === uploadedLogo ? "preserved" : "changed"}`,
      r.status === 200 && current.body.business.logo_url === uploadedLogo];
  });
  await tc("Business logo", "Reject non-image logo contents", "422 validation error", async () => {
    const business = (await call("/me", A)).body.business;
    const r = await call("/business", A, {
      businessName: business.business_name, businessType: business.business_type, email: business.email,
      phone: business.phone, address: business.address ?? "", state: business.state,
      taxRate: business.tax_rate, logoUrl: "data:image/png;base64,Zm9v",
    }, "PUT");
    return [`${r.status}, ${r.body.error}`, r.status === 422];
  });
  await tc("Business logo", "Remove an existing business logo", "Logo is cleared while business settings remain intact", async () => {
    const business = (await call("/me", A)).body.business;
    const r = await call("/business", A, {
      businessName: business.business_name, businessType: business.business_type, email: business.email,
      phone: business.phone, address: business.address ?? "", state: business.state,
      taxRate: business.tax_rate, logoUrl: null,
    }, "PUT");
    const current = await call("/me", A);
    return [`${r.status}, logo ${current.body.business.logo_url ?? "removed"}`,
      r.status === 200 && current.body.business.logo_url === null];
  });
  await tc("User management", "Owner lists team members without exposing password hashes", "200, owner and staff listed without credentials", async () => {
    const r = await call("/users", A);
    const roles = r.body.map((user: any) => user.role);
    ownerId = r.body.find((user: any) => user.role === "OWNER")?.user_id;
    staffId = r.body.find((user: any) => user.role === "SALES_STAFF")?.user_id;
    return [`${r.status}, ${r.body.length} users, credentials ${r.body.some((user: any) => "password_hash" in user) ? "exposed" : "omitted"}`,
      r.status === 200 && r.body.length === 2 && !!ownerId && !!staffId && roles.includes("OWNER") && roles.includes("SALES_STAFF") && r.body.every((user: any) => !("password_hash" in user))];
  });
  await tc("User management", "Administrator edits a staff member profile", "Staff contact details are updated", async () => {
    const r = await call(`/users/${staffId}`, A, { fullName: "Sam Staff Updated", phone: "08030000003" }, "PUT");
    return [`${r.status}, ${r.body.full_name}, ${r.body.phone}`, r.status === 200 && r.body.full_name === "Sam Staff Updated" && r.body.phone === "08030000003"];
  });
  await tc("Profile", "Staff member edits their own profile", "Updated profile is returned by /me", async () => {
    const r = await call("/me", staff, { fullName: "Sam Personal Profile", phone: "08030000004" }, "PUT");
    const me = await call("/me", staff);
    return [`${r.status}, ${me.body.name}, ${me.body.phone}`, r.status === 200 && me.body.name === "Sam Personal Profile" && me.body.phone === "08030000004"];
  });
  await tc("Profile security", "Reject an incorrect current password", "422 validation error", async () => {
    const r = await call("/me", staff, { currentPassword: "wrong-password", newPassword: "NewPassw0rd!" }, "PUT");
    return [`${r.status}, ${r.body.error}`, r.status === 422];
  });
  await tc("Profile security", "Allow staff to change password after verification", "New credentials authenticate successfully", async () => {
    const r = await call("/me", staff, { currentPassword: "Passw0rd!", newPassword: "NewPassw0rd!" }, "PUT");
    const login = await call("/auth/login", undefined, { email: `s${tag}@t.ng`, password: "NewPassw0rd!" });
    staff = login.body.token;
    return [`${r.status}, login ${login.status}`, r.status === 200 && login.status === 200 && !!staff];
  });
  await tc("Access control", "Sales staff cannot list team accounts", "403 Forbidden", async () => {
    const r = await call("/users", staff); return [`${r.status}`, r.status === 403];
  });
  await tc("Access control", "Sales staff tries to add a product", "403 Forbidden", async () => {
    const r = await call("/products", staff, { productName: "X", sku: "X", costPrice: 1, sellingPrice: 2 }); return [`${r.status}`, r.status === 403];
  });
  await tc("Access control", "Sales staff opens the profit report", "403 Forbidden", async () => {
    const r = await call("/reports/summary", staff); return [`${r.status}`, r.status === 403];
  });
  await tc("Subscription", "Trial retains full analytics and insights access", "Reports and data-based insight endpoint available during Trial", async () => {
    const reports = await call("/reports/summary", A);
    const insights = await call("/analytics/ai-insights", A);
    return [`reports ${reports.status}, insights ${insights.status}`, reports.status === 200 && insights.status === 200
      && Array.isArray(insights.body.insights) && insights.body.method.includes("no external AI service")];
  });
  await tc("Inventory", "Add product with opening stock of 10", "201, stock = 10", async () => {
    const r = await call("/products", A, { productName: "Peak Milk 400g", sku: "PK1", barcode: "012345678905", costPrice: 2000, sellingPrice: 2500, openingStock: 10, reorderLevel: 3 });
    pid = r.body.product_id; const q = await stockOf(A, pid); return [`${r.status}, stock = ${q}`, r.status === 201 && q === 10];
  });
  let expiringProductId = "";
  let expiredProductId = "";
  await tc("Expiry alerts", "Create an in-stock product expiring within 30 days", "Expiry date persists and product is listed in expiring alerts", async () => {
    const expiryDate = dateFromToday(15);
    const added = await call("/products", A, {
      productName: "Near Expiry Item", sku: "EXP-SOON", costPrice: 10, sellingPrice: 15,
      openingStock: 5, reorderLevel: 1, expiryDate,
    });
    expiringProductId = added.body.product_id;
    const product = (await call("/products", A)).body.find((item: any) => item.product_id === expiringProductId);
    const alerts = await call("/inventory/alerts", A);
    const alert = alerts.body.expiry.find((item: any) => item.product_id === expiringProductId);
    return [`${added.status}, expiry ${product?.expiry_date}, days ${alert?.days_until_expiry}`,
      added.status === 201 && product?.expiry_date === expiryDate
      && alert?.type === "expiring_soon" && alert.days_until_expiry === 15];
  });
  await tc("Expiry alerts", "Create an in-stock expired product", "Expired product is flagged separately", async () => {
    const expiryDate = dateFromToday(-2);
    const added = await call("/products", A, {
      productName: "Expired Item", sku: "EXP-PAST", costPrice: 10, sellingPrice: 15,
      openingStock: 2, expiryDate,
    });
    expiredProductId = added.body.product_id;
    const alerts = await call("/inventory/alerts", A);
    const alert = alerts.body.expiry.find((item: any) => item.product_id === expiredProductId);
    return [`${added.status}, alert ${alert?.type}, days ${alert?.days_until_expiry}`,
      added.status === 201 && alert?.type === "expired" && alert.days_until_expiry === -2];
  });
  await tc("Expiry alerts", "Reject malformed product expiry dates", "Invalid calendar date is rejected", async () => {
    const r = await call("/products", A, {
      productName: "Invalid Expiry", sku: "EXP-BAD", costPrice: 10, sellingPrice: 15, expiryDate: "2026-02-30",
    });
    return [`${r.status}`, r.status === 422];
  });
  await tc("Inventory", "Add product priced below cost", "422 rejected", async () => {
    const r = await call("/products", A, { productName: "Loss", sku: "L1", costPrice: 500, sellingPrice: 400 }); return [`${r.status}`, r.status === 422];
  });
  await tc("Inventory", "Add a product with a duplicate SKU", "409 Conflict", async () => {
    const r = await call("/products", A, { productName: "Dup", sku: "PK1", costPrice: 1, sellingPrice: 2 }); return [`${r.status}`, r.status === 409];
  });
  await tc("Point of sale", "Sell 4 units for cash", "Stock 10 → 6; total = 4 × 2,500 + 7.5% VAT = ₦10,750", async () => {
    const r = await call("/sales", staff, { items: [{ productId: pid, quantity: 4 }], paymentMethod: "CASH", amountPaid: 11000 });
    saleId = r.body.saleId; const q = await stockOf(A, pid);
    return [`stock = ${q}, total = ₦${r.body.grandTotal}, change = ₦${r.body.change}`, q === 6 && r.body.grandTotal === 10750 && r.body.change === 250];
  });
  await tc("Point of sale", "List recent sales", "Sale appears in the authenticated sales list", async () => {
    const r = await call("/sales", A);
    const sale = r.body.find((item: any) => item.sale_id === saleId);
    return [`${r.status}, sale ${sale ? "found" : "missing"}`, r.status === 200 && !!sale && Number(sale.grand_total) === 10750];
  });
  await tc("Point of sale", "Sell 7 units when only 6 remain", "409; stock stays at 6", async () => {
    const r = await call("/sales", staff, { items: [{ productId: pid, quantity: 7 }], paymentMethod: "CASH" }); const q = await stockOf(A, pid);
    return [`${r.status} "${r.body.error}", stock = ${q}`, r.status === 409 && q === 6];
  });
  await tc("Alerts", "Sale takes stock to the re-order level (3)", "Low-stock alert raised", async () => {
    const r = await call("/sales", staff, { items: [{ productId: pid, quantity: 3 }], paymentMethod: "TRANSFER" });
    const notes = (await call("/notifications", A)).body;
    const alerts = await call("/inventory/alerts", A);
    const stockAlert = alerts.body.stock.find((item: any) => item.product_id === pid);
    const soonAlert = alerts.body.expiry.find((item: any) => item.product_id === expiringProductId);
    const pastAlert = alerts.body.expiry.find((item: any) => item.product_id === expiredProductId);
    return [`stock ${stockAlert?.type}; expiry ${soonAlert?.type}/${soonAlert?.days_until_expiry}d and ${pastAlert?.type}; notifications ${notes.length}`,
      r.body.alerts?.length === 1 && notes.length >= 1 && stockAlert?.type === "low_stock"
      && soonAlert?.type === "expiring_soon" && pastAlert?.type === "expired"];
  });
  await tc("Purchasing", "Receive a supplier delivery of 20 units", "Stock 3 → 23; movement logged", async () => {
    const s = await call("/suppliers", A, { supplierName: "Depot" }); const po = await call("/purchases", A, { supplierId: s.body.supplier_id, items: [{ productId: pid, quantity: 20, unitCost: 2000 }] });
    const suppliers = await call("/suppliers", A); const orders = await call("/purchases", A);
    const listedOrder = orders.body.find((item: any) => item.purchase_id === po.body.purchase_id);
    await call(`/purchases/${po.body.purchase_id}/receive`, A, {}); const again = await call(`/purchases/${po.body.purchase_id}/receive`, A, {});
    const q = await stockOf(A, pid);
    return [`supplier listed ${suppliers.body.some((item: any) => item.supplier_id === s.body.supplier_id)}, order listed ${!!listedOrder}; stock = ${q}; second receipt → ${again.status}`,
      suppliers.status === 200 && !!listedOrder && listedOrder.items[0]?.product_id === pid && q === 23 && again.status === 409];
  });
  await tc("Inventory", "Adjust stock and restore the original quantity", "Both adjustments succeed; stock remains 23", async () => {
    const down = await call("/inventory/adjust", A, { productId: pid, change: -2, reason: "Test stock correction" });
    const up = await call("/inventory/adjust", A, { productId: pid, change: 2, reason: "Restore test stock" });
    const q = await stockOf(A, pid);
    return [`decrease ${down.status}, increase ${up.status}, stock ${q}`, down.status === 200 && up.status === 200 && q === 23];
  });
  await tc("Inventory", "Reject a stock adjustment that would go negative", "409; stock remains unchanged", async () => {
    const r = await call("/inventory/adjust", A, { productId: pid, change: -24, reason: "Reject negative stock" });
    const q = await stockOf(A, pid);
    return [`${r.status}, stock = ${q}`, r.status === 409 && q === 23];
  });
  await tc("Customers", "Credit sale without a customer", "422 rejected", async () => {
    const r = await call("/sales", staff, { items: [{ productId: pid, quantity: 1 }], paymentMethod: "CREDIT" }); return [`${r.status}`, r.status === 422];
  });
  await tc("Customers", "Credit sale to a named customer", "Customer balance rises by ₦2,687.50", async () => {
    cust = (await call("/customers", A, { customerName: "Ibiso", phone: "08055500000", creditLimit: 10000 })).body.customer_id;
    customerSaleId = (await call("/sales", staff, { items: [{ productId: pid, quantity: 1 }], paymentMethod: "CREDIT", customerId: cust })).body.saleId;
    const c = (await call("/customers", A)).body.find((x: any) => x.customer_id === cust); return [`balance = ₦${c.outstanding_balance}`, c.outstanding_balance === 2687.5];
  });
  await tc("CRM", "Update a customer profile with contact notes and tags", "Updated details and sales summary are returned", async () => {
    const updated = await call(`/customers/${cust}`, A, {
      email: `crm${tag}@t.ng`, address: "12 Market Road", notes: "Prefers afternoon calls", tags: ["Wholesale", "VIP"],
    }, "PUT");
    const detail = await call(`/customers/${cust}`, A);
    const listed = (await call("/customers", A)).body.find((customer: any) => customer.customer_id === cust);
    return [`${updated.status}, ${detail.body.interactions.length} interactions, ${listed.orders_count} orders, ${listed.lifetime_value} lifetime value`,
      updated.status === 200 && detail.body.customer.email === `crm${tag}@t.ng`
      && detail.body.customer.notes === "Prefers afternoon calls" && detail.body.customer.tags.includes("VIP")
      && detail.body.sales.some((sale: any) => sale.sale_id === customerSaleId)
      && listed.orders_count === 1 && listed.lifetime_value === 2687.5];
  });
  await tc("CRM", "Log a customer interaction with a follow-up", "Interaction appears in the customer timeline", async () => {
    const created = await call(`/customers/${cust}/interactions`, staff, {
      interactionType: "CALL", subject: "Discussed next order", notes: "Customer requested a callback.", followUpAt: new Date(Date.now() + 86400000).toISOString(),
    });
    const detail = await call(`/customers/${cust}`, A);
    return [`${created.status}, ${detail.body.interactions[0]?.interaction_type}, follow-up ${!!detail.body.interactions[0]?.follow_up_at}`,
      created.status === 201 && detail.body.interactions[0]?.subject === "Discussed next order" && !!detail.body.interactions[0]?.follow_up_at];
  });
  await tc("Complaints", "Create a complaint linked to the customer's sale", "Complaint appears in the filtered queue with its invoice", async () => {
    const created = await call("/complaints", staff, {
      customerId: cust, saleId: customerSaleId, category: "PAYMENT", subject: "Payment allocation question",
      description: "Customer needs the credit payment explained.", priority: "HIGH",
    });
    complaintId = created.body.complaint_id;
    const queue = await call("/complaints?status=OPEN", A);
    const item = queue.body.find((complaint: any) => complaint.complaint_id === complaintId);
    return [`${created.status}, linked invoice ${item?.invoice_no}, assigned ${item?.assigned_name ?? "none"}`,
      created.status === 201 && !!item && item.customer_name === "Ibiso" && !!item.invoice_no && item.priority === "HIGH"];
  });
  await tc("Complaints", "Restrict assignment and resolve a complaint", "Staff cannot assign; owner can assign and resolve", async () => {
    const denied = await call(`/complaints/${complaintId}`, staff, { assignedTo: ownerId }, "PUT");
    const assigned = await call(`/complaints/${complaintId}`, A, { assignedTo: ownerId, status: "IN_PROGRESS" }, "PUT");
    const resolved = await call(`/complaints/${complaintId}`, A, { status: "RESOLVED", resolution: "Explained payment allocation." }, "PUT");
    const queue = await call("/complaints?status=RESOLVED", A);
    const item = queue.body.find((complaint: any) => complaint.complaint_id === complaintId);
    return [`staff assign ${denied.status}, owner update ${assigned.status}, resolve ${resolved.status}`,
      denied.status === 403 && assigned.status === 200 && resolved.status === 200
      && item?.status === "RESOLVED" && item?.assigned_to === ownerId && !!item?.resolved_at];
  });
  await tc("Customers", "Reject a credit sale that exceeds the customer limit", "409; stock and balance remain unchanged", async () => {
    const stockBefore = await stockOf(A, pid);
    const r = await call("/sales", staff, { items: [{ productId: pid, quantity: 3 }], paymentMethod: "CREDIT", customerId: cust });
    const customer = (await call("/customers", A)).body.find((x: any) => x.customer_id === cust);
    const stockAfter = await stockOf(A, pid);
    return [`${r.status} "${r.body.error}", balance ₦${customer.outstanding_balance}, stock ${stockAfter}`,
      r.status === 409 && customer.outstanding_balance === 2687.5 && stockAfter === stockBefore];
  });
  await tc("Reports", "Gross profit for the period", "8 units × ₦500 margin = ₦4,000", async () => {
    const r = await call("/reports/summary?days=1", A); return [`₦${r.body.grossProfit}, margin ${r.body.grossMargin}%`, r.body.grossProfit === 4000];
  });
  await tc("Subscription", "Add a 4th user on the Trial plan (limit 3)", "402, plan limit message", async () => {
    await call("/users", A, { fullName: "Third", email: `t${tag}@t.ng`, password: "Passw0rd!", role: "ADMIN" });
    const r = await call("/users", A, { fullName: "Fourth", email: `f${tag}@t.ng`, password: "Passw0rd!", role: "ADMIN" }); return [`${r.status} "${r.body.error}"`, r.status === 402];
  });
  let adminToken = "";
  await tc("Administration", "Administrator signs in", "Admin account can authenticate", async () => {
    adminToken = (await call("/auth/login", undefined, { email: `t${tag}@t.ng`, password: "Passw0rd!" })).body.token;
    return [`${adminToken ? "token present" : "token missing"}`, !!adminToken];
  });
  await tc("Administration", "Administrator edits their own profile", "Admin can update their profile without changing their role", async () => {
    const r = await call("/me", adminToken, { fullName: "Administrator Profile Updated" }, "PUT");
    const me = await call("/me", adminToken);
    return [`${r.status}, ${me.body.name}, ${me.body.role}`, r.status === 200 && me.body.name === "Administrator Profile Updated" && me.body.role === "ADMIN"];
  });
  await tc("Subscription access", "Only the owner can start subscription checkout", "Administrator receives 403", async () => {
    const r = await call("/subscription/checkout", adminToken, { planId: "basic", billingCycle: "monthly" });
    return [`${r.status}`, r.status === 403];
  });
  await tc("Administration", "Administrator edits a staff profile", "Staff profile changes while the assigned role is preserved", async () => {
    const r = await call(`/users/${staffId}`, adminToken, { fullName: "Staff Edited By Admin" }, "PUT");
    return [`${r.status}, ${r.body.full_name}, ${r.body.role}`, r.status === 200 && r.body.full_name === "Staff Edited By Admin" && r.body.role === "SALES_STAFF"];
  });
  await tc("Administration", "Administrator cannot edit the owner profile", "403 Forbidden", async () => {
    const r = await call(`/users/${ownerId}`, adminToken, { fullName: "Impersonated Owner" }, "PUT");
    return [`${r.status}`, r.status === 403];
  });
  await tc("Administration", "Administrator cannot change workspace-wide settings", "403 Forbidden", async () => {
    const r = await call("/business", adminToken, { businessName: "Unauthorized", businessType: "Retail", email: `a${tag}@t.ng`, phone: "08030000000", address: "", state: "Rivers", taxRate: 7.5 }, "PUT");
    return [`${r.status}`, r.status === 403];
  });
  await tc("Administration", "Administrator cannot edit their own role from team management", "403 Forbidden", async () => {
    const users = await call("/users", A);
    const adminId = users.body.find((user: any) => user.role === "ADMIN")?.user_id;
    const r = await call(`/users/${adminId}`, adminToken, { role: "SALES_STAFF" }, "PUT");
    return [`${r.status}`, !!adminId && r.status === 403];
  });
  // ---- multi-tenancy ----
  await tc("Multi-tenancy", "Tenant B lists products", "Sees none of tenant A's products", async () => {
    B = (await call("/auth/register", undefined, { businessName: "Other " + tag, businessType: "Pharmacy", email: `o${tag}@t.ng`, phone: "08030000001", state: "Lagos", ownerName: "Bola Ade", password: "Passw0rd!" })).body.token;
    const r = await call("/products", B); return [`${r.body.length} products visible`, r.body.length === 0];
  });
  await tc("Multi-tenancy", "Tenant B requests tenant A's sale by its ID", "404 Not Found", async () => {
    const r = await call(`/sales/${saleId}`, B); return [`${r.status}`, r.status === 404];
  });
  await tc("Multi-tenancy", "Tenant B sells tenant A's product by ID", "404; A's stock unchanged", async () => {
    const before = await stockOf(A, pid); const r = await call("/sales", B, { items: [{ productId: pid, quantity: 1 }], paymentMethod: "CASH" });
    return [`${r.status}, A's stock ${before} → ${await stockOf(A, pid)}`, r.status === 404 && before === (await stockOf(A, pid))];
  });
  await tc("Multi-tenancy", "Tenant B cannot access customer CRM or complaint records", "Customer and complaint access is tenant-scoped", async () => {
    const profile = await call(`/customers/${cust}`, B);
    const created = await call("/complaints", B, {
      customerId: cust, category: "OTHER", subject: "Cross-tenant attempt", description: "Should not be accepted.",
    });
    const updated = await call(`/complaints/${complaintId}`, B, { status: "CLOSED" }, "PUT");
    const queue = await call("/complaints", B);
    return [`profile ${profile.status}, create ${created.status}, update ${updated.status}, queue ${queue.body.length}`,
      profile.status === 404 && created.status === 404 && updated.status === 404 && queue.body.length === 0];
  });
  await tc("Multi-tenancy (database)", "Unfiltered SELECT/UPDATE as app role with B's context", "0 of A's rows read or changed", async () => {
    const db = new Client({ host: process.env.PGHOST ?? "localhost", database: process.env.PGDATABASE ?? "sims", user: "app_user", password: "app_pass" }); await db.connect();
    const none = await db.query("SELECT count(*)::int n FROM products"); // no tenant set
    const bId = (await db.query("SELECT business_id FROM businesses WHERE email = $1", [`o${tag}@t.ng`])).rows[0].business_id;
    await db.query("BEGIN"); await db.query("SELECT set_config('app.business_id',$1,true)", [bId]);
    const upd = await db.query("UPDATE inventory SET quantity = 0"); const ins = await db.query("SELECT count(*)::int n FROM sales");
    let crossInsert = "blocked"; try { await db.query("INSERT INTO categories (business_id, category_name) SELECT business_id,'x' FROM businesses WHERE email=$1", [`a${tag}@t.ng`]); crossInsert = "allowed"; } catch { /* RLS WITH CHECK */ }
    await db.query("ROLLBACK"); await db.end();
    return [`no context: ${none.rows[0].n} rows; B updated ${upd.rowCount} rows (own only); B sees ${ins.rows[0].n} sales; insert into A: ${crossInsert}`, none.rows[0].n === 0 && upd.rowCount === 0 && ins.rows[0].n === 0 && crossInsert === "blocked"];
  });
  // ---- offline sync ----
  await tc("Offline sync", "Upload 3 queued offline sales, then upload the same batch again", "3 created, then 3 marked duplicate; stock drops by 3 once", async () => {
    const before = await stockOf(A, pid);
    const batch = [1, 2, 3].map(() => ({ items: [{ productId: pid, quantity: 1 }], paymentMethod: "CASH", syncUuid: crypto.randomUUID(), createdAt: new Date().toISOString() }));
    const r1 = await call("/sales/sync", staff, { sales: batch }); const r2 = await call("/sales/sync", staff, { sales: batch }); const after = await stockOf(A, pid);
    const dup = r2.body.results.filter((x: any) => x.duplicate).length;
    return [`first: ${r1.body.results.filter((x: any) => x.ok && !x.duplicate).length} new; second: ${dup} duplicate; stock ${before} → ${after}`, dup === 3 && before - after === 3];
  });
  // ---- Paystack ----
  let ref = "";
  await tc("Payments (Paystack)", "Webhook with a forged signature", "401 rejected", async () => {
    const body = JSON.stringify({ event: "charge.success", data: { reference: "fake" } });
    const r = await fetch("http://localhost:4000/api/webhooks/paystack".replace("4000", process.env.API_PORT ?? "4000"), { method: "POST", headers: { "Content-Type": "application/json", "x-paystack-signature": "00" + "a".repeat(126) }, body });
    return [`${r.status}`, r.status === 401];
  });
  const sendHook = async (reference: string, amount: number) => {
    const md = { business_id: (await call("/me", A)).body.businessId };
    const body = JSON.stringify({ event: "charge.success", data: { reference, amount, currency: "NGN", status: "success", metadata: md } });
    const sig = crypto.createHmac("sha512", SECRET).update(body).digest("hex");
    return (await fetch(`http://localhost:${process.env.API_PORT ?? "4000"}/api/webhooks/paystack`, { method: "POST", headers: { "Content-Type": "application/json", "x-paystack-signature": sig }, body })).json();
  };
  const sendSubscriptionHook = async (reference: string, amount: number, planId: string, billingCycle: string) => {
    const businessId = (await call("/me", A)).body.businessId;
    const body = JSON.stringify({ event: "charge.success", data: {
      reference, amount, currency: "NGN", status: "success",
      metadata: { business_id: businessId, subscription_plan: planId, billing_cycle: billingCycle },
    } });
    const sig = crypto.createHmac("sha512", SECRET).update(body).digest("hex");
    return (await fetch(`http://localhost:${process.env.API_PORT ?? "4000"}/api/webhooks/paystack`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-paystack-signature": sig }, body,
    })).json();
  };
  let cardSale = "";
  await tc("Payments (Paystack)", "Webhook for a reference the customer never paid", "Not reconciled; sale stays PENDING", async () => {
    cardSale = (await call("/sales", staff, { items: [{ productId: pid, quantity: 2 }], paymentMethod: "PAYSTACK" })).body.saleId;
    const init = await call("/payments/paystack/initialize", staff, { saleId: cardSale, email: "c@t.ng" }); ref = init.body.reference;
    const h: any = await sendHook(ref, 537500); const s = (await call(`/sales/${cardSale}`, A)).body;
    return [`result "${h.result}", sale ${s.payment_status}`, h.result === "mismatch" && s.payment_status === "PENDING"];
  });
  await tc("Payments (Paystack)", "Customer pays; signed webhook arrives", "Verified with Paystack; sale marked PAID (₦5,375)", async () => {
    const init = await call("/payments/paystack/initialize", staff, { saleId: cardSale, email: "c@t.ng" }); ref = init.body.reference;
    await fetch(`${PS}/__test/succeed/${ref}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const h: any = await sendHook(ref, 537500); const s = (await call(`/sales/${cardSale}`, A)).body;
    return [`result "${h.result}", sale ${s.payment_status}, paid ₦${s.amount_paid}`, h.result === "reconciled" && s.payment_status === "PAID"];
  });
  await tc("Payments (Paystack)", "Same webhook delivered a second time", "Ignored as duplicate; paid amount not doubled", async () => {
    const h: any = await sendHook(ref, 537500); const s = (await call(`/sales/${cardSale}`, A)).body;
    return [`result "${h.result}", paid ₦${s.amount_paid}`, h.result === "duplicate" && Number(s.amount_paid) === 5375];
  });
  // ---- Subscription billing and entitlements ----
  let subscriptionRef = "";
  await tc("Subscription payments", "Start Basic monthly checkout using the server catalog price", "Paystack receives ₦2,999; current Trial remains active until verified", async () => {
    const checkout = await call("/subscription/checkout", A, { planId: "basic", billingCycle: "monthly", amount: 1 });
    subscriptionRef = checkout.body.reference;
    const current = await call("/subscription", A);
    return [`${checkout.status}, ₦${checkout.body.amount}, still ${current.body.subscription.plan_name}`,
      checkout.status === 200 && checkout.body.amount === 2999 && !!subscriptionRef
      && current.body.subscription.plan_name === "Trial"];
  });
  await tc("Subscription payments", "Reject a successful gateway payment with a mismatched amount", "Plan remains Trial and payment is not activated", async () => {
    await fetch(`${PS}/__test/succeed/${subscriptionRef}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amount: 299800 }),
    });
    const h: any = await sendSubscriptionHook(subscriptionRef, 299800, "basic", "MONTHLY");
    const current = await call("/subscription", A);
    return [`${h.result}, current plan ${current.body.subscription.plan_name}`,
      h.result === "mismatch" && current.body.subscription.plan_name === "Trial"];
  });
  await tc("Subscription payments", "Activate Basic only after verified Paystack confirmation", "Basic activates; Standard analytics endpoint is gated", async () => {
    const checkout = await call("/subscription/checkout", A, { planId: "basic", billingCycle: "monthly" });
    subscriptionRef = checkout.body.reference;
    await fetch(`${PS}/__test/succeed/${subscriptionRef}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const h: any = await sendSubscriptionHook(subscriptionRef, 299900, "basic", "MONTHLY");
    const current = await call("/subscription", A);
    const report = await call("/reports/summary", A);
    const barcode = await call("/products/lookup/barcode?code=012345678905", A);
    const qr = await call("/products/lookup/qr?code=PK1", A);
    return [`${h.result}, current plan ${current.body.subscription.plan_name}, report ${report.status}`,
      h.result === "subscription_activated" && current.body.subscription.plan_name === "Basic"
      && report.status === 402 && current.body.features.analytics === false
      && current.body.features.barcodeScanning === false && current.body.features.qrScanning === false
      && barcode.status === 402 && qr.status === 402];
  });
  await tc("Subscription payments", "Duplicate subscription webhook does not extend or reapply a plan", "Duplicate is ignored", async () => {
    const before = await call("/subscription", A);
    const h: any = await sendSubscriptionHook(subscriptionRef, 299900, "basic", "MONTHLY");
    const after = await call("/subscription", A);
    return [`${h.result}, expiry unchanged ${before.body.subscription.expiry_date === after.body.subscription.expiry_date}`,
      h.result === "duplicate" && before.body.subscription.expiry_date === after.body.subscription.expiry_date];
  });
  await tc("Subscription payments", "Annual Standard checkout uses ten months of pricing", "₦49,990 per year and analytics unlock after payment", async () => {
    const checkout = await call("/subscription/checkout", A, { planId: "standard", billingCycle: "annual" });
    subscriptionRef = checkout.body.reference;
    await fetch(`${PS}/__test/succeed/${subscriptionRef}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const h: any = await sendSubscriptionHook(subscriptionRef, 4999000, "standard", "ANNUAL");
    const current = await call("/subscription", A);
    const report = await call("/reports/summary", A);
    const barcode = await call("/products/lookup/barcode?code=012345678905", A);
    const qr = await call("/products/lookup/qr?code=PK1", A);
    return [`${h.result}, ₦${checkout.body.amount}/${checkout.body.billingCycle}, report ${report.status}`,
      checkout.status === 200 && checkout.body.amount === 49990 && checkout.body.billingCycle === "ANNUAL"
      && h.result === "subscription_activated" && current.body.subscription.plan_name === "Standard"
      && current.body.subscription.billing_cycle === "ANNUAL" && report.status === 200
      && current.body.features.barcodeScanning === true && current.body.features.qrScanning === false
      && barcode.status === 200 && barcode.body.sku === "PK1"
      && qr.status === 402 && qr.body.error.includes("Premium")];
  });
  await tc("Subscription payments", "Premium plan unlocks data-based insights", "₦9,999 monthly; insights return recommendation data", async () => {
    const checkout = await call("/subscription/checkout", A, { planId: "premium", billingCycle: "monthly" });
    subscriptionRef = checkout.body.reference;
    await fetch(`${PS}/__test/succeed/${subscriptionRef}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const h: any = await sendSubscriptionHook(subscriptionRef, 999900, "premium", "MONTHLY");
    const current = await call("/subscription", A);
    const insights = await call("/analytics/ai-insights", A);
    const barcode = await call("/products/lookup/barcode?code=012345678905", A);
    const qr = await call("/products/lookup/qr?code=PK1", A);
    return [`${h.result}, current plan ${current.body.subscription.plan_name}, ${insights.body.insights?.length ?? 0} insights`,
      checkout.body.amount === 9999 && h.result === "subscription_activated"
      && current.body.features.aiInsights === true && insights.status === 200
      && current.body.features.barcodeScanning === true && current.body.features.qrScanning === true
      && barcode.status === 200 && qr.status === 200
      && Array.isArray(insights.body.insights)];
  });
  await tc("Subscription access", "Expired plans lose gated features and can be renewed", "Expired Premium loses reports/insights and owner can start renewal", async () => {
    const businessId = (await call("/me", A)).body.businessId;
    const db = new Client({ host: process.env.PGHOST ?? "localhost", database: process.env.PGDATABASE ?? "sims", user: "postgres" });
    await db.connect();
    await db.query("UPDATE subscriptions SET expiry_date = CURRENT_DATE - 1 WHERE business_id = $1 AND status = 'ACTIVE'", [businessId]);
    await db.end();
    const current = await call("/subscription", A);
    const report = await call("/reports/summary", A);
    const insights = await call("/analytics/ai-insights", A);
    const barcode = await call("/products/lookup/barcode?code=PK1", A);
    const qr = await call("/products/lookup/qr?code=PK1", A);
    const renewal = await call("/subscription/checkout", A, { planId: "premium", billingCycle: "monthly" });
    return [`expired ${current.body.subscription.expired}, reports ${report.status}, insights ${insights.status}, renewal ${renewal.status}`,
      current.body.subscription.expired === true && current.body.features.analytics === false
      && current.body.features.aiInsights === false && current.body.features.barcodeScanning === false
      && current.body.features.qrScanning === false && report.status === 402
      && insights.status === 402 && barcode.status === 402 && qr.status === 402 && renewal.status === 200];
  });
  await tc("Subscription payments", "Plan checkout rejects unsupported plans", "Invalid plan is rejected", async () => {
    const r = await call("/subscription/checkout", A, { planId: "enterprise", billingCycle: "monthly" });
    return [`${r.status}`, r.status === 422];
  });
  await tc("Audit", "Every sale and product change is logged", "Audit rows ≥ sales + products", async () => {
    const db = new Client({ host: process.env.PGHOST ?? "localhost", database: process.env.PGDATABASE ?? "sims", user: "postgres" }); await db.connect();
    const r = await db.query(`SELECT (SELECT count(*) FROM audit_logs a JOIN businesses b USING (business_id) WHERE b.email=$1)::int a,
      (SELECT count(*) FROM sales s JOIN businesses b USING (business_id) WHERE b.email=$1)::int s`, [`a${tag}@t.ng`]); await db.end();
    return [`${r.rows[0].a} audit rows for ${r.rows[0].s} sales + 1 product`, r.rows[0].a >= r.rows[0].s + 1];
  });
  await tc("Administration", "Deactivated staff account cannot continue using an existing session", "401 while inactive; access restored after reactivation", async () => {
    const disabled = await call(`/users/${staffId}`, A, { isActive: false }, "PUT");
    const blocked = await call("/products", staff);
    const enabled = await call(`/users/${staffId}`, A, { isActive: true }, "PUT");
    const restored = await call("/products", staff);
    return [`deactivate ${disabled.status}, inactive request ${blocked.status}, reactivate ${enabled.status}, restored ${restored.status}`,
      disabled.status === 200 && blocked.status === 401 && enabled.status === 200 && restored.status === 200];
  });
  console.log(JSON.stringify(results, null, 1));
  const failed = results.filter((result) => !result.pass);
  console.log(`\n${results.length - failed.length}/${results.length} API checks passed.`);
  if (failed.length) process.exitCode = 1;
}
main();
