// Local stand-in for the Paystack test API (initialize / verify / hosted checkout).
// Mirrors the request and response shapes of https://api.paystack.co so the
// platform code runs unchanged; only PAYSTACK_BASE_URL differs.
import express from "express";
import crypto from "node:crypto";

const SECRET = process.env.PAYSTACK_SECRET_KEY ?? "sk_test_local";
const WEBHOOK = process.env.WEBHOOK_URL ?? "http://localhost:4000/api/webhooks/paystack";
const tx = new Map<string, any>();
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const authed = (req: express.Request) => req.headers.authorization === `Bearer ${SECRET}`;

app.post("/transaction/initialize", (req, res) => {
  if (!authed(req)) return res.status(401).json({ status: false, message: "Invalid key" });
  const { email, amount, reference, metadata, currency } = req.body;
  const access_code = crypto.randomBytes(6).toString("hex");
  tx.set(reference, { email, amount, reference, metadata, currency: currency ?? "NGN", status: "abandoned", access_code });
  res.json({ status: true, message: "Authorization URL created",
    data: { authorization_url: `http://localhost:4100/checkout/${access_code}`, access_code, reference } });
});

app.get("/transaction/verify/:ref", (req, res) => {
  if (!authed(req)) return res.status(401).json({ status: false, message: "Invalid key" });
  const t = tx.get(req.params.ref);
  if (!t) return res.status(404).json({ status: false, message: "Transaction reference not found" });
  res.json({ status: true, message: "Verification successful", data: { ...t, gateway_response: t.status === "success" ? "Approved" : "Abandoned" } });
});

app.get("/checkout/:code", (req, res) => {
  const t = [...tx.values()].find((x) => x.access_code === req.params.code);
  if (!t) return res.status(404).send("Not found");
  res.send(`<!doctype html><html><head><meta name="viewport" content="width=device-width"><title>Paystack Checkout (test)</title>
  <style>body{font-family:Arial,sans-serif;background:#f4f4f4;display:flex;justify-content:center;padding:40px}
  .c{background:#fff;border:1px solid #ccc;border-radius:8px;width:360px;padding:24px}h3{margin:0 0 4px}
  .amt{font-size:28px;font-weight:bold;margin:12px 0}label{display:block;font-size:13px;margin-top:12px}
  input{width:100%;padding:10px;border:1px solid #bbb;border-radius:4px;box-sizing:border-box}
  button{margin-top:18px;width:100%;padding:12px;background:#0a7d3e;color:#fff;border:0;border-radius:4px;font-size:15px}
  .tag{font-size:11px;background:#fff3cd;padding:4px 8px;border-radius:4px;display:inline-block}</style></head><body><div class="c">
  <span class="tag">TEST MODE</span><h3>Pay with card</h3><div>${t.email}</div><div class="amt">NGN ${(t.amount / 100).toLocaleString("en-NG", { minimumFractionDigits: 2 })}</div>
  <form method="post" action="/checkout/${req.params.code}/pay"><label>Card number</label><input value="4084 0840 8408 4081">
  <label>Expiry / CVV</label><input value="12/30   408"><button type="submit">Pay NGN ${(t.amount / 100).toLocaleString("en-NG")}</button></form></div></body></html>`);
});

app.post("/checkout/:code/pay", async (req, res) => {
  const t = [...tx.values()].find((x) => x.access_code === req.params.code);
  if (!t) return res.status(404).send("Not found");
  Object.assign(t, { status: "success", channel: "card", paid_at: new Date().toISOString() });
  const body = JSON.stringify({ event: "charge.success", data: { reference: t.reference, amount: t.amount, currency: t.currency, channel: "card", status: "success", metadata: t.metadata } });
  const signature = crypto.createHmac("sha512", SECRET).update(body).digest("hex");
  const r = await fetch(WEBHOOK, { method: "POST", headers: { "Content-Type": "application/json", "x-paystack-signature": signature }, body });
  res.send(`<p style="font-family:Arial">Payment successful. Webhook response: ${await r.text()}</p>`);
});

/** test helper: mark a reference paid without the browser step */
app.post("/__test/succeed/:ref", (req, res) => {
  const t = tx.get(req.params.ref);
  if (!t) return res.sendStatus(404);
  if (Number.isSafeInteger(req.body.amount) && req.body.amount > 0) t.amount = req.body.amount;
  Object.assign(t, { status: "success", channel: req.body.channel ?? "card", paid_at: new Date().toISOString() });
  res.json(t);
});

app.listen(4100, () => console.log("Paystack sandbox on :4100"));
