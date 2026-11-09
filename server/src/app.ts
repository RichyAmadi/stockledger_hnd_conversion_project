import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import compression from "compression";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { pool, withTenant } from "./db";

const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret-change-me";
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY ?? "sk_test_local";
const PAYSTACK_BASE = process.env.PAYSTACK_BASE_URL ?? "https://api.paystack.co";
const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS ?? 10);

const PLAN_CATALOG = [
  {
    id: "basic", name: "Basic", monthlyPrice: 2999, annualPrice: 29990,
    description: "The essentials for running your business.",
    features: ["Point of sale and sales history", "Product and inventory management", "Customers and credit sales", "Team management and offline sales"],
    analytics: false, aiInsights: false, barcodeScanning: false, qrScanning: false,
  },
  {
    id: "standard", name: "Standard", monthlyPrice: 4999, annualPrice: 49990,
    description: "More clarity on sales and stock performance.",
    features: ["Everything in Basic", "Camera barcode scanning", "Sales and inventory analytics", "Revenue, profit, and staff reports", "Top products and sales trends"],
    analytics: true, aiInsights: false, barcodeScanning: true, qrScanning: false,
  },
  {
    id: "premium", name: "Premium", monthlyPrice: 9999, annualPrice: 99990,
    description: "Advanced, data-driven guidance for your next move.",
    features: ["Everything in Standard", "Camera QR code scanning", "Demand forecasting from sales history", "Smart reorder quantity recommendations", "Stockout risk and sales trend insights"],
    analytics: true, aiInsights: true, barcodeScanning: true, qrScanning: true,
  },
] as const;
type PaidPlanId = typeof PLAN_CATALOG[number]["id"];
type PlanFeature = "analytics" | "aiInsights" | "barcodeScanning" | "qrScanning";
const planById = (id: string) => PLAN_CATALOG.find((plan) => plan.id === id);
const planHasFeature = (planName: string | null | undefined, feature: PlanFeature) => {
  if (planName?.toLowerCase() === "trial") return true;
  const plan = PLAN_CATALOG.find((item) => item.name.toLowerCase() === planName?.toLowerCase());
  return !!plan && plan[feature];
};

type Role = "OWNER" | "ADMIN" | "INVENTORY_MANAGER" | "SALES_STAFF";
interface Auth { userId: string; businessId: string; branchId: string; role: Role; name: string }
declare global { namespace Express { interface Request { auth?: Auth } } }

class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }
const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);

function requireAuth(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const h = req.headers.authorization ?? "";
    try {
      const a = jwt.verify(h.replace(/^Bearer /, ""), JWT_SECRET) as Auth;
      if (roles.length && !roles.includes(a.role)) return next(new HttpError(403, "Your role cannot perform this action"));
      withTenant(a.businessId, (c) => c.query(
        "SELECT 1 FROM users WHERE user_id = $1 AND is_active = TRUE",
        [a.userId],
      )).then((result) => {
        if (!result.rowCount) return next(new HttpError(401, "Account is inactive or no longer exists"));
        req.auth = a;
        next();
      }).catch(next);
    } catch { next(new HttpError(401, "Not signed in")); }
  };
}

function requirePlanFeature(feature: PlanFeature) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const a = req.auth;
    if (!a) return next(new HttpError(401, "Not signed in"));
    withTenant(a.businessId, async (c) => {
      const current = await c.query(
        `SELECT plan_name, expiry_date < CURRENT_DATE AS expired FROM subscriptions
         WHERE business_id = $1 AND status = 'ACTIVE'
         ORDER BY start_date DESC LIMIT 1`,
        [a.businessId],
      );
      if (current.rows[0]?.expired || !planHasFeature(current.rows[0]?.plan_name, feature)) {
        const messages: Record<PlanFeature, string> = {
          analytics: "Sales and inventory analytics require the Standard plan or higher",
          aiInsights: "AI insights require the Premium plan",
          barcodeScanning: "Camera barcode scanning requires the Standard plan or higher",
          qrScanning: "Camera QR code scanning requires the Premium plan",
        };
        throw new HttpError(402, messages[feature]);
      }
    }).then(() => next()).catch(next);
  };
}

const money = (n: number) => Math.round(n * 100) / 100;

export function buildApp() {
  const app = express();
  app.use(compression());
  app.use(cors());
  // keep the raw body for Paystack signature verification
  app.use(express.json({ limit: "2mb", verify: (req, _res, buf) => { (req as any).rawBody = buf; } }));

  app.get("/api/health", wrap(async (_req, res) => {
    await pool.query("SELECT 1");
    res.json({ status: "ok", time: new Date().toISOString() });
  }));

  app.get("/api/plans", (_req, res) => {
    res.json(PLAN_CATALOG.map((plan) => ({
      ...plan,
      annualSavings: plan.monthlyPrice * 12 - plan.annualPrice,
    })));
  });

  /* ---------------- Auth & tenant onboarding ---------------- */
  const RegisterSchema = z.object({
    businessName: z.string().min(2).max(150), businessType: z.string().min(2).max(40),
    email: z.string().email(), phone: z.string().regex(/^\+?\d{10,14}$/), state: z.string().min(2),
    address: z.string().optional(), ownerName: z.string().min(2), password: z.string().min(8),
  });
  app.post("/api/auth/register", wrap(async (req, res) => {
    const b = RegisterSchema.parse(req.body);
    const businessId = crypto.randomUUID();
    const hash = await bcrypt.hash(b.password, BCRYPT_ROUNDS);
    const out = await withTenant(businessId, async (c) => {
      await c.query(`INSERT INTO businesses (business_id,business_name,business_type,email,phone,address,state)
        VALUES ($1,$2,$3,$4,$5,$6,$7)`, [businessId, b.businessName, b.businessType, b.email, b.phone, b.address ?? null, b.state]);
      const br = await c.query(`INSERT INTO branches (business_id,branch_name,address) VALUES ($1,'Main Branch',$2) RETURNING branch_id`, [businessId, b.address ?? null]);
      const u = await c.query(`INSERT INTO users (business_id,branch_id,full_name,email,phone,password_hash,role)
        VALUES ($1,$2,$3,$4,$5,$6,'OWNER') RETURNING user_id`, [businessId, br.rows[0].branch_id, b.ownerName, b.email, b.phone, hash]);
      await c.query(`INSERT INTO subscriptions (business_id,plan_name,amount,billing_cycle,max_users,max_branches,max_products,start_date,expiry_date,status)
        VALUES ($1,'Trial',0,'MONTHLY',3,1,200,CURRENT_DATE,CURRENT_DATE + 14,'ACTIVE')`, [businessId]);
      return { userId: u.rows[0].user_id, branchId: br.rows[0].branch_id };
    });
    const auth: Auth = { userId: out.userId, businessId, branchId: out.branchId, role: "OWNER", name: b.ownerName };
    res.status(201).json({ token: jwt.sign(auth, JWT_SECRET, { expiresIn: "12h" }), user: auth });
  }));

  app.post("/api/auth/login", wrap(async (req, res) => {
    const { email, password } = z.object({ email: z.string().email(), password: z.string() }).parse(req.body);
    const r = await pool.query("SELECT * FROM auth_lookup($1)", [email]);
    const u = r.rows[0];
    if (!u || !(await bcrypt.compare(password, u.password_hash))) throw new HttpError(401, "Wrong email or password");
    const auth: Auth = { userId: u.user_id, businessId: u.business_id, branchId: u.branch_id, role: u.role, name: u.full_name };
    await withTenant(u.business_id, (c) => c.query("UPDATE users SET last_login = now() WHERE user_id = $1", [u.user_id]));
    res.json({ token: jwt.sign(auth, JWT_SECRET, { expiresIn: "12h" }), user: auth });
  }));

  app.post("/api/users", requireAuth("OWNER", "ADMIN"), wrap(async (req, res) => {
    const b = z.object({ fullName: z.string().trim().min(2).max(120), email: z.string().trim().email().max(120),
      phone: z.union([z.string().regex(/^\+?\d{10,14}$/), z.literal("")]).optional(), password: z.string().min(8),
      role: z.enum(["ADMIN", "INVENTORY_MANAGER", "SALES_STAFF"]) }).parse(req.body);
    const a = req.auth!;
    const hash = await bcrypt.hash(b.password, BCRYPT_ROUNDS);
    const r = await withTenant(a.businessId, async (c) => {
      const lim = await c.query(`SELECT s.max_users, (SELECT count(*) FROM users)::int AS n FROM subscriptions s WHERE status='ACTIVE' LIMIT 1`);
      if (lim.rows[0] && lim.rows[0].n >= lim.rows[0].max_users) throw new HttpError(402, "User limit reached for your plan");
      return c.query(`INSERT INTO users (business_id,branch_id,full_name,email,phone,password_hash,role) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING user_id,full_name,email,phone,role`,
        [a.businessId, a.branchId, b.fullName, b.email.toLowerCase(), b.phone || null, hash, b.role]);
    });
    res.status(201).json(r.rows[0]);
  }));

  app.get("/api/users", requireAuth("OWNER", "ADMIN"), wrap(async (req, res) => {
    const a = req.auth!;
    const r = await withTenant(a.businessId, (c) => c.query(
      `SELECT user_id, full_name, email, phone, role, is_active, last_login, created_at
       FROM users ORDER BY CASE role WHEN 'OWNER' THEN 0 WHEN 'ADMIN' THEN 1 ELSE 2 END, full_name`));
    res.json(r.rows);
  }));

  app.put("/api/users/:id", requireAuth("OWNER", "ADMIN"), wrap(async (req, res) => {
    const b = z.object({
      fullName: z.string().trim().min(2).max(120).optional(),
      email: z.string().trim().email().max(120).optional(),
      phone: z.union([z.string().regex(/^\+?\d{10,14}$/), z.literal("")]).optional(),
      role: z.enum(["ADMIN", "INVENTORY_MANAGER", "SALES_STAFF"]).optional(),
      isActive: z.boolean().optional(),
    }).refine((value) => Object.keys(value).length > 0, "Provide at least one field to update").parse(req.body);
    const a = req.auth!;
    const user = await withTenant(a.businessId, async (c) => {
      const current = await c.query(
        "SELECT user_id, full_name, email, phone, role, is_active FROM users WHERE user_id = $1 FOR UPDATE",
        [req.params.id],
      );
      if (!current.rowCount) throw new HttpError(404, "User not found");
      const existing = current.rows[0];
      if (existing.role === "OWNER") throw new HttpError(403, "The owner profile can only be changed by its owner");
      if (a.role !== "OWNER" && existing.role === "ADMIN") throw new HttpError(403, "Only the owner can manage administrators");
      if (existing.user_id === a.userId) throw new HttpError(403, "Edit your own profile from My profile");
      if (b.isActive === true && !existing.is_active) {
        const limit = await c.query(
          `SELECT s.max_users, (SELECT count(*)::int FROM users WHERE business_id = $1 AND is_active) AS active_users
           FROM subscriptions s WHERE s.business_id = $1 AND s.status = 'ACTIVE' LIMIT 1`,
          [a.businessId],
        );
        if (limit.rows[0] && limit.rows[0].active_users >= limit.rows[0].max_users) {
          throw new HttpError(402, "User limit reached for your plan");
        }
      }
      const updated = await c.query(
        `UPDATE users SET full_name = $2, email = $3, phone = $4, role = $5, is_active = $6
         WHERE user_id = $1
         RETURNING user_id, full_name, email, phone, role, is_active, last_login, created_at`,
        [
          existing.user_id,
          b.fullName ?? existing.full_name,
          b.email?.toLowerCase() ?? existing.email,
          b.phone === undefined ? existing.phone : b.phone || null,
          b.role ?? existing.role,
          b.isActive ?? existing.is_active,
        ],
      );
      return updated.rows[0];
    });
    res.json(user);
  }));

  app.get("/api/me", requireAuth(), wrap(async (req, res) => {
    const a = req.auth!;
    const r = await withTenant(a.businessId, (c) => c.query(
      `SELECT u.full_name, u.email, u.phone, u.role,
              b.business_name, b.business_type, b.email AS business_email, b.phone AS business_phone,
              b.address, b.state, b.currency, b.tax_rate::float, b.logo_url,
              s.plan_name, s.amount::float AS subscription_amount, s.billing_cycle, s.status AS subscription_status,
              s.start_date, s.expiry_date, s.max_users,
              COALESCE(s.expiry_date < CURRENT_DATE, FALSE) AS subscription_expired,
              (SELECT count(*)::int FROM users WHERE business_id = b.business_id AND is_active) AS user_count
       FROM users u JOIN businesses b ON b.business_id = u.business_id
       LEFT JOIN subscriptions s ON s.business_id = b.business_id AND s.status = 'ACTIVE'
       WHERE u.user_id = $1 AND b.business_id = $2`, [a.userId, a.businessId]));
    if (!r.rowCount) throw new HttpError(404, "Profile not found");
    const { full_name, role, ...details } = r.rows[0];
    const { business_name, business_type, business_email, business_phone, address, state, currency, tax_rate, logo_url,
      plan_name, subscription_amount, billing_cycle, subscription_status, start_date, expiry_date,
      max_users, subscription_expired, user_count, ...profile } = details;
    res.json({ ...a, ...profile, name: full_name, role, business: {
      business_name, business_type, email: business_email, phone: business_phone, address, state, currency, tax_rate, logo_url,
      plan_name, amount: subscription_amount, billing_cycle, status: subscription_status,
      start_date, expiry_date, max_users, subscription_expired, user_count,
    } });
  }));

  app.get("/api/dashboard/overview", requireAuth("OWNER", "ADMIN"), wrap(async (req, res) => {
    const a = req.auth!;
    const days = Math.min(Math.max(Number(req.query.days ?? 7) || 7, 1), 366);
    const result = await withTenant(a.businessId, async (c) => {
      const since = new Date(Date.now() - days * 86400000);
      const sales = await c.query(
        `SELECT COUNT(*)::int AS sales_count, COALESCE(SUM(grand_total), 0)::float AS revenue
         FROM sales WHERE business_id = $1 AND created_at >= $2`,
        [a.businessId, since],
      );
      const inventory = await c.query(
        `SELECT COALESCE(SUM(i.quantity * p.cost_price), 0)::float AS stock_value,
                COUNT(*) FILTER (WHERE i.quantity <= p.reorder_level)::int AS low_stock
         FROM inventory i JOIN products p USING (product_id) WHERE i.business_id = $1`,
        [a.businessId],
      );
      return { ...sales.rows[0], ...inventory.rows[0], days };
    });
    res.json(result);
  }));

  app.put("/api/me", requireAuth(), wrap(async (req, res) => {
    const b = z.object({
      fullName: z.string().trim().min(2).max(120).optional(),
      email: z.string().trim().email().max(120).optional(),
      phone: z.union([z.string().regex(/^\+?\d{10,14}$/), z.literal("")]).optional(),
      currentPassword: z.string().optional(),
      newPassword: z.string().min(8).optional(),
    }).refine((value) => Object.keys(value).length > 0, "Provide at least one field to update")
      .refine((value) => Boolean(value.currentPassword) === Boolean(value.newPassword), {
        message: "Current and new passwords are both required to change your password",
        path: ["newPassword"],
      }).parse(req.body);
    const a = req.auth!;
    const passwordHash = b.newPassword ? await bcrypt.hash(b.newPassword, BCRYPT_ROUNDS) : undefined;
    const user = await withTenant(a.businessId, async (c) => {
      const current = await c.query("SELECT full_name, email, phone, password_hash FROM users WHERE user_id = $1 FOR UPDATE", [a.userId]);
      if (!current.rowCount) throw new HttpError(404, "Profile not found");
      if (b.currentPassword && !(await bcrypt.compare(b.currentPassword, current.rows[0].password_hash))) {
        throw new HttpError(422, "Current password is incorrect");
      }
      const updated = await c.query(
        `UPDATE users SET full_name = $2, email = $3, phone = $4, password_hash = COALESCE($5, password_hash)
         WHERE user_id = $1 RETURNING user_id, full_name, email, phone`,
        [a.userId, b.fullName ?? current.rows[0].full_name, b.email?.toLowerCase() ?? current.rows[0].email,
          b.phone === undefined ? current.rows[0].phone : b.phone || null, passwordHash ?? null],
      );
      return updated.rows[0];
    });
    res.json({ ...user, name: user.full_name });
  }));

  app.put("/api/business", requireAuth("OWNER"), wrap(async (req, res) => {
    const b = z.object({
      businessName: z.string().trim().min(2).max(150),
      businessType: z.string().trim().min(2).max(40),
      email: z.string().trim().email().max(120),
      phone: z.string().regex(/^\+?\d{10,14}$/),
      address: z.string().max(255),
      state: z.string().trim().min(2).max(50),
      taxRate: z.number().min(0).max(100),
      logoUrl: z.union([
        z.string().max(1_400_000).regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/),
        z.null(),
      ]).optional(),
    }).parse(req.body);
    if (typeof b.logoUrl === "string") {
      const [, mime, encoded] = b.logoUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/)!;
      const image = Buffer.from(encoded, "base64");
      const validSignature = mime === "image/png"
        ? image.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
        : mime === "image/jpeg"
          ? image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff
          : image.toString("ascii", 0, 4) === "RIFF" && image.toString("ascii", 8, 12) === "WEBP";
      if (image.length > 1024 * 1024 || !validSignature) {
        throw new HttpError(422, "Logo must be a PNG, JPEG, or WebP image no larger than 1 MB");
      }
    }
    const a = req.auth!;
    const r = await withTenant(a.businessId, (c) => c.query(
      `UPDATE businesses SET business_name = $2, business_type = $3, email = $4, phone = $5,
       address = $6, state = $7, tax_rate = $8,
       logo_url = CASE WHEN $9::boolean THEN $10::text ELSE logo_url END
       WHERE business_id = $1
       RETURNING business_name, business_type, email, phone, address, state, currency, tax_rate::float, logo_url`,
      [a.businessId, b.businessName, b.businessType, b.email.toLowerCase(), b.phone,
        b.address || null, b.state, b.taxRate, b.logoUrl !== undefined, b.logoUrl ?? null],
    ));
    if (!r.rowCount) throw new HttpError(404, "Business not found");
    res.json(r.rows[0]);
  }));

  /* ---------------- Products & inventory ---------------- */
  const ProductSchema = z.object({
    productName: z.string().min(2).max(150), sku: z.string().min(1).max(60), barcode: z.string().max(60).optional(),
    category: z.string().max(80).optional(), unitOfMeasure: z.string().default("piece"),
    costPrice: z.number().nonnegative(), sellingPrice: z.number().nonnegative(),
    reorderLevel: z.number().int().nonnegative().default(0), openingStock: z.number().int().nonnegative().default(0),
    expiryDate: z.string().date().optional(),
  });
  app.post("/api/products", requireAuth("OWNER", "ADMIN", "INVENTORY_MANAGER"), wrap(async (req, res) => {
    const p = ProductSchema.parse(req.body);
    if (p.sellingPrice < p.costPrice) throw new HttpError(422, "Selling price is below cost price");
    const a = req.auth!;
    const out = await withTenant(a.businessId, async (c) => {
      let catId: string | null = null;
      if (p.category) {
        const cat = await c.query(`INSERT INTO categories (business_id,category_name) VALUES ($1,$2)
          ON CONFLICT (business_id,category_name) DO UPDATE SET category_name = EXCLUDED.category_name RETURNING category_id`, [a.businessId, p.category]);
        catId = cat.rows[0].category_id;
      }
      const pr = await c.query(`INSERT INTO products
        (business_id,category_id,product_name,sku,barcode,unit_of_measure,cost_price,selling_price,reorder_level,expiry_date)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [a.businessId, catId, p.productName, p.sku, p.barcode ?? null, p.unitOfMeasure,
          p.costPrice, p.sellingPrice, p.reorderLevel, p.expiryDate ?? null]);
      const pid = pr.rows[0].product_id;
      await c.query(`INSERT INTO inventory (business_id,product_id,branch_id,quantity) VALUES ($1,$2,$3,$4)`, [a.businessId, pid, a.branchId, p.openingStock]);
      await c.query(`INSERT INTO stock_movements (business_id,product_id,branch_id,movement_type,quantity,balance_after,user_id,reason)
        VALUES ($1,$2,$3,'OPENING',$4,$4,$5,'Opening stock')`, [a.businessId, pid, a.branchId, p.openingStock, a.userId]);
      await audit(c, a, "CREATE", "product", pid, null, pr.rows[0], req.ip);
      return pr.rows[0];
    });
    res.status(201).json(out);
  }));

  app.get("/api/products", requireAuth(), wrap(async (req, res) => {
    const a = req.auth!; const q = String(req.query.q ?? "");
    const r = await withTenant(a.businessId, (c) => c.query(
      `SELECT p.product_id, p.product_name, p.sku, p.barcode, p.selling_price::float, p.cost_price::float, p.reorder_level, p.expiry_date::text AS expiry_date,
              COALESCE(i.quantity,0) AS quantity, cat.category_name
       FROM products p LEFT JOIN inventory i ON i.product_id = p.product_id AND i.branch_id = $1
       LEFT JOIN categories cat ON cat.category_id = p.category_id
       WHERE p.is_active AND ($2 = '' OR p.product_name ILIKE '%'||$2||'%' OR p.sku = $2 OR p.barcode = $2)
       ORDER BY p.product_name LIMIT 200`, [a.branchId, q]));
    res.json(r.rows);
  }));

  const lookupProduct = wrap(async (req, res) => {
    const code = z.string().trim().min(1).max(200).parse(req.query.code);
    const a = req.auth!;
    const result = await withTenant(a.businessId, (c) => c.query(
      `SELECT p.product_id, p.product_name, p.sku, p.barcode, p.selling_price::float, p.cost_price::float, p.reorder_level,
              COALESCE(i.quantity,0) AS quantity
       FROM products p LEFT JOIN inventory i ON i.product_id = p.product_id AND i.branch_id = $1
       WHERE p.is_active AND (LOWER(p.barcode) = LOWER($2) OR LOWER(p.sku) = LOWER($2))
       ORDER BY CASE WHEN LOWER(p.barcode) = LOWER($2) THEN 0 ELSE 1 END, p.product_name
       LIMIT 2`,
      [a.branchId, code],
    ));
    if (!result.rowCount) throw new HttpError(404, "No product matches this code");
    if (result.rowCount > 1) throw new HttpError(409, "This code matches multiple products; use a unique barcode or SKU");
    res.json(result.rows[0]);
  });
  app.get("/api/products/lookup/barcode", requireAuth(), requirePlanFeature("barcodeScanning"), lookupProduct);
  app.get("/api/products/lookup/qr", requireAuth(), requirePlanFeature("qrScanning"), lookupProduct);

  app.get("/api/inventory/low-stock", requireAuth(), wrap(async (req, res) => {
    const a = req.auth!;
    const r = await withTenant(a.businessId, (c) => c.query(
      `SELECT p.product_name, p.sku, i.quantity, p.reorder_level FROM inventory i JOIN products p USING (product_id)
       WHERE i.branch_id = $1 AND i.quantity <= p.reorder_level ORDER BY i.quantity`, [a.branchId]));
    res.json(r.rows);
  }));

  app.get("/api/inventory/alerts", requireAuth(), wrap(async (req, res) => {
    const a = req.auth!;
    const alerts = await withTenant(a.businessId, async (c) => {
      const stock = await c.query(
        `SELECT p.product_id, p.product_name, p.sku, i.quantity, p.reorder_level,
                CASE WHEN i.quantity = 0 THEN 'out_of_stock' ELSE 'low_stock' END AS type
         FROM inventory i JOIN products p USING (product_id)
         WHERE i.business_id = $1 AND i.branch_id = $2 AND p.is_active
           AND i.quantity <= p.reorder_level
         ORDER BY i.quantity, p.product_name`,
        [a.businessId, a.branchId],
      );
      const expiry = await c.query(
        `SELECT p.product_id, p.product_name, p.sku, i.quantity, p.expiry_date::text AS expiry_date,
                (p.expiry_date - CURRENT_DATE)::int AS days_until_expiry,
                CASE WHEN p.expiry_date < CURRENT_DATE THEN 'expired' ELSE 'expiring_soon' END AS type
         FROM inventory i JOIN products p USING (product_id)
         WHERE i.business_id = $1 AND i.branch_id = $2 AND p.is_active
           AND i.quantity > 0 AND p.expiry_date <= CURRENT_DATE + 30
         ORDER BY p.expiry_date, p.product_name`,
        [a.businessId, a.branchId],
      );
      return { stock: stock.rows, expiry: expiry.rows, expiryWarningDays: 30 };
    });
    res.json(alerts);
  }));

  app.post("/api/inventory/adjust", requireAuth("OWNER", "ADMIN", "INVENTORY_MANAGER"), wrap(async (req, res) => {
    const b = z.object({ productId: z.string().uuid(), change: z.number().int(), reason: z.string().min(3) }).parse(req.body);
    const a = req.auth!;
    const r = await withTenant(a.businessId, async (c) => {
      const u = await c.query(`UPDATE inventory SET quantity = quantity + $1, updated_at = now()
        WHERE product_id = $2 AND branch_id = $3 AND quantity + $1 >= 0 RETURNING quantity`, [b.change, b.productId, a.branchId]);
      if (!u.rowCount) throw new HttpError(409, "Adjustment would make stock negative");
      await c.query(`INSERT INTO stock_movements (business_id,product_id,branch_id,movement_type,quantity,balance_after,reason,user_id)
        VALUES ($1,$2,$3,'ADJUSTMENT',$4,$5,$6,$7)`, [a.businessId, b.productId, a.branchId, b.change, u.rows[0].quantity, b.reason, a.userId]);
      return u.rows[0];
    });
    res.json(r);
  }));

  /* ---------------- Sales (integrated with inventory) ---------------- */
  const SaleSchema = z.object({
    items: z.array(z.object({ productId: z.string().uuid(), quantity: z.number().int().positive() })).min(1),
    paymentMethod: z.enum(["CASH", "TRANSFER", "CARD", "PAYSTACK", "CREDIT"]),
    amountPaid: z.number().nonnegative().optional(), customerId: z.string().uuid().optional(),
    discount: z.number().nonnegative().default(0), syncUuid: z.string().uuid().optional(), createdAt: z.string().datetime().optional(),
  });
  type SaleInput = z.infer<typeof SaleSchema>;

  async function recordSale(a: Auth, s: SaleInput, ip?: string) {
    return withTenant(a.businessId, async (c) => {
      if (s.syncUuid) { // idempotent replay from the offline queue
        const dup = await c.query("SELECT sale_id, invoice_no, grand_total::float FROM sales WHERE sync_uuid = $1", [s.syncUuid]);
        if (dup.rowCount) return { ...dup.rows[0], duplicate: true };
      }
      const biz = await c.query("SELECT tax_rate::float FROM businesses WHERE business_id = $1", [a.businessId]);
      // lock the products in a fixed order so concurrent sales cannot deadlock or oversell
      const ids = [...new Set(s.items.map((i) => i.productId))].sort();
      const prods = await c.query(`SELECT p.product_id, p.product_name, p.selling_price::float, p.cost_price::float, p.reorder_level, i.quantity
        FROM products p JOIN inventory i ON i.product_id = p.product_id AND i.branch_id = $2
        WHERE p.product_id = ANY($1::uuid[]) ORDER BY p.product_id FOR UPDATE OF i`, [ids, a.branchId]);
      const byId = new Map(prods.rows.map((p) => [p.product_id, p]));
      let subtotal = 0;
      for (const it of s.items) {
        const p = byId.get(it.productId);
        if (!p) throw new HttpError(404, "Product not found");
        if (p.quantity < it.quantity) throw new HttpError(409, `Only ${p.quantity} ${p.product_name} left in stock`);
        p.quantity -= it.quantity;
        subtotal += p.selling_price * it.quantity;
      }
      const discount = money(Math.min(s.discount, subtotal));
      const tax = money((subtotal - discount) * biz.rows[0].tax_rate / 100);
      const total = money(subtotal - discount + tax);
      const paid = s.paymentMethod === "PAYSTACK" ? 0 : money(s.amountPaid ?? (s.paymentMethod === "CREDIT" ? 0 : total));
      const status = paid >= total ? "PAID" : s.paymentMethod === "PAYSTACK" ? "PENDING" : paid > 0 ? "PARTIAL" : "UNPAID";
      if (s.paymentMethod === "CREDIT" && !s.customerId) throw new HttpError(422, "Credit sales need a customer");
      if (s.customerId) {
        const customer = await c.query(
          `SELECT credit_limit::float, outstanding_balance::float FROM customers WHERE customer_id = $1 FOR UPDATE`,
          [s.customerId],
        );
        if (!customer.rowCount) throw new HttpError(404, "Customer not found");
        const outstanding = money(total - paid);
        if (outstanding > 0 && customer.rows[0].outstanding_balance + outstanding > customer.rows[0].credit_limit) {
          throw new HttpError(409, "Sale would exceed the customer's credit limit");
        }
      }
      const inv = `INV-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
      const sale = await c.query(`INSERT INTO sales (business_id,branch_id,user_id,customer_id,invoice_no,subtotal,discount,tax_amount,grand_total,amount_paid,payment_status,sync_uuid,created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,COALESCE($13::timestamptz, now())) RETURNING sale_id, invoice_no, created_at`,
        [a.businessId, a.branchId, a.userId, s.customerId ?? null, inv, money(subtotal), discount, tax, total, paid, status, s.syncUuid ?? null, s.createdAt ?? null]);
      const saleId = sale.rows[0].sale_id;
      const alerts: string[] = [];
      for (const it of s.items) {
        const p = byId.get(it.productId);
        await c.query(`INSERT INTO sale_items (business_id,sale_id,product_id,quantity,unit_price,unit_cost,line_total) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [a.businessId, saleId, it.productId, it.quantity, p.selling_price, p.cost_price, money(p.selling_price * it.quantity)]);
        const u = await c.query(`UPDATE inventory SET quantity = quantity - $1, updated_at = now() WHERE product_id = $2 AND branch_id = $3 RETURNING quantity`,
          [it.quantity, it.productId, a.branchId]);
        await c.query(`INSERT INTO stock_movements (business_id,product_id,branch_id,movement_type,quantity,balance_after,reference_id,user_id)
          VALUES ($1,$2,$3,'SALE',$4,$5,$6,$7)`, [a.businessId, it.productId, a.branchId, -it.quantity, u.rows[0].quantity, saleId, a.userId]);
        if (u.rows[0].quantity <= p.reorder_level) alerts.push(`${p.product_name} is low (${u.rows[0].quantity} left)`);
      }
      if (paid > 0) await c.query(`INSERT INTO payments (business_id,sale_id,amount,payment_method,status,paid_at) VALUES ($1,$2,$3,$4,'SUCCESS',now())`,
        [a.businessId, saleId, paid, s.paymentMethod]);
      if (s.customerId && paid < total) await c.query(`UPDATE customers SET outstanding_balance = outstanding_balance + $1 WHERE customer_id = $2`, [money(total - paid), s.customerId]);
      for (const msg of alerts) await c.query(`INSERT INTO notifications (business_id,channel,title,body) VALUES ($1,'IN_APP','Low stock',$2)`, [a.businessId, msg]);
      await audit(c, a, "CREATE", "sale", saleId, null, { invoice: inv, total }, ip);
      return { saleId, invoiceNo: inv, subtotal: money(subtotal), discount, tax, grandTotal: total, amountPaid: paid, paymentStatus: status, change: money(Math.max(0, paid - total)), alerts, createdAt: sale.rows[0].created_at };
    });
  }

  app.post("/api/sales", requireAuth(), wrap(async (req, res) => {
    res.status(201).json(await recordSale(req.auth!, SaleSchema.parse(req.body), req.ip));
  }));

  // Offline queue upload: each queued sale carries a client-generated sync_uuid
  app.post("/api/sales/sync", requireAuth(), wrap(async (req, res) => {
    const list = z.array(SaleSchema.extend({ syncUuid: z.string().uuid() })).max(500).parse(req.body.sales);
    const results = [];
    for (const s of list) {
      try { const r: any = await recordSale(req.auth!, s, req.ip); results.push({ syncUuid: s.syncUuid, ok: true, duplicate: !!r.duplicate, invoiceNo: r.invoiceNo ?? r.invoice_no }); }
      catch (e: any) { results.push({ syncUuid: s.syncUuid, ok: false, error: e.message }); }
    }
    res.json({ results });
  }));

  app.get("/api/sales", requireAuth(), wrap(async (req, res) => {
    const a = req.auth!;
    const r = await withTenant(a.businessId, (c) => c.query(
      `SELECT s.sale_id, s.invoice_no, s.grand_total::float, s.amount_paid::float, s.payment_status, s.created_at, u.full_name AS cashier,
              (SELECT string_agg(DISTINCT p.payment_method, ', ') FROM payments p WHERE p.sale_id = s.sale_id) AS methods
       FROM sales s JOIN users u USING (user_id) ORDER BY s.created_at DESC LIMIT 50`));
    res.json(r.rows);
  }));

  app.get("/api/sales/:id", requireAuth(), wrap(async (req, res) => {
    const a = req.auth!;
    const out = await withTenant(a.businessId, async (c) => {
      const s = await c.query(`SELECT s.*, u.full_name AS cashier, b.business_name, b.phone, b.address FROM sales s JOIN users u USING (user_id)
        JOIN businesses b ON b.business_id = s.business_id WHERE s.sale_id = $1`, [req.params.id]);
      if (!s.rowCount) throw new HttpError(404, "Sale not found");
      const items = await c.query(`SELECT p.product_name, si.quantity, si.unit_price::float, si.line_total::float FROM sale_items si JOIN products p USING (product_id) WHERE si.sale_id = $1`, [req.params.id]);
      return { ...s.rows[0], items: items.rows };
    });
    res.json(out);
  }));

  /* ---------------- Purchases (goods receipt updates stock) ---------------- */
  app.get("/api/suppliers", requireAuth("OWNER", "ADMIN", "INVENTORY_MANAGER"), wrap(async (req, res) => {
    const a = req.auth!;
    const r = await withTenant(a.businessId, (c) => c.query(
      `SELECT supplier_id, supplier_name, phone, email, address, outstanding_payable::float
       FROM suppliers ORDER BY supplier_name`,
    ));
    res.json(r.rows);
  }));
  app.post("/api/suppliers", requireAuth("OWNER", "ADMIN", "INVENTORY_MANAGER"), wrap(async (req, res) => {
    const b = z.object({ supplierName: z.string().min(2), phone: z.string().optional() }).parse(req.body);
    const a = req.auth!;
    const r = await withTenant(a.businessId, (c) => c.query(`INSERT INTO suppliers (business_id,supplier_name,phone) VALUES ($1,$2,$3) RETURNING *`, [a.businessId, b.supplierName, b.phone ?? null]));
    res.status(201).json(r.rows[0]);
  }));
  app.get("/api/purchases", requireAuth("OWNER", "ADMIN", "INVENTORY_MANAGER"), wrap(async (req, res) => {
    const a = req.auth!;
    const r = await withTenant(a.businessId, (c) => c.query(
      `SELECT po.purchase_id, po.po_number, po.order_date::text AS order_date, po.expected_date::text AS expected_date,
              po.total_amount::float, po.status, s.supplier_name,
              COALESCE(json_agg(json_build_object(
                'product_id', pi.product_id, 'product_name', pr.product_name,
                'quantity_ordered', pi.quantity_ordered, 'quantity_received', pi.quantity_received,
                'unit_cost', pi.unit_cost::float
              )) FILTER (WHERE pi.purchase_item_id IS NOT NULL), '[]'::json) AS items
       FROM purchases po
       JOIN suppliers s ON s.supplier_id = po.supplier_id
       LEFT JOIN purchase_items pi ON pi.purchase_id = po.purchase_id
       LEFT JOIN products pr ON pr.product_id = pi.product_id
       WHERE po.branch_id = $1
       GROUP BY po.purchase_id, s.supplier_name
       ORDER BY po.order_date DESC, po.po_number DESC
       LIMIT 100`,
      [a.branchId],
    ));
    res.json(r.rows);
  }));
  app.post("/api/purchases", requireAuth("OWNER", "ADMIN", "INVENTORY_MANAGER"), wrap(async (req, res) => {
    const b = z.object({ supplierId: z.string().uuid(), items: z.array(z.object({ productId: z.string().uuid(), quantity: z.number().int().positive(), unitCost: z.number().nonnegative() })).min(1) }).parse(req.body);
    const a = req.auth!;
    const r = await withTenant(a.businessId, async (c) => {
      const total = money(b.items.reduce((t, i) => t + i.quantity * i.unitCost, 0));
      const po = await c.query(`INSERT INTO purchases (business_id,branch_id,supplier_id,po_number,total_amount) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [a.businessId, a.branchId, b.supplierId, `PO-${Date.now().toString(36).toUpperCase()}`, total]);
      for (const i of b.items) await c.query(`INSERT INTO purchase_items (business_id,purchase_id,product_id,quantity_ordered,unit_cost) VALUES ($1,$2,$3,$4,$5)`,
        [a.businessId, po.rows[0].purchase_id, i.productId, i.quantity, i.unitCost]);
      return po.rows[0];
    });
    res.status(201).json(r);
  }));
  app.post("/api/purchases/:id/receive", requireAuth("OWNER", "ADMIN", "INVENTORY_MANAGER"), wrap(async (req, res) => {
    const a = req.auth!;
    const r = await withTenant(a.businessId, async (c) => {
      const po = await c.query(`SELECT * FROM purchases WHERE purchase_id = $1 FOR UPDATE`, [req.params.id]);
      if (!po.rowCount) throw new HttpError(404, "Purchase order not found");
      if (po.rows[0].status === "RECEIVED") throw new HttpError(409, "Already received");
      const items = await c.query(`SELECT * FROM purchase_items WHERE purchase_id = $1`, [req.params.id]);
      for (const i of items.rows) {
        const u = await c.query(`UPDATE inventory SET quantity = quantity + $1, updated_at = now() WHERE product_id = $2 AND branch_id = $3 RETURNING quantity`, [i.quantity_ordered, i.product_id, a.branchId]);
        await c.query(`UPDATE purchase_items SET quantity_received = quantity_ordered WHERE purchase_item_id = $1`, [i.purchase_item_id]);
        await c.query(`UPDATE products SET cost_price = $1 WHERE product_id = $2`, [i.unit_cost, i.product_id]);
        await c.query(`INSERT INTO stock_movements (business_id,product_id,branch_id,movement_type,quantity,balance_after,reference_id,user_id)
          VALUES ($1,$2,$3,'PURCHASE',$4,$5,$6,$7)`, [a.businessId, i.product_id, a.branchId, i.quantity_ordered, u.rows[0].quantity, req.params.id, a.userId]);
      }
      await c.query(`UPDATE purchases SET status = 'RECEIVED' WHERE purchase_id = $1`, [req.params.id]);
      return { received: items.rowCount };
    });
    res.json(r);
  }));

  /* ---------------- Customers ---------------- */
  app.post("/api/customers", requireAuth(), wrap(async (req, res) => {
    const b = z.object({ customerName: z.string().min(2), phone: z.string().regex(/^\+?\d{10,14}$/), creditLimit: z.number().nonnegative().default(0) }).parse(req.body);
    const a = req.auth!;
    const r = await withTenant(a.businessId, (c) => c.query(`INSERT INTO customers (business_id,customer_name,phone,credit_limit) VALUES ($1,$2,$3,$4) RETURNING *`,
      [a.businessId, b.customerName, b.phone, b.creditLimit]));
    res.status(201).json(r.rows[0]);
  }));
  app.get("/api/customers", requireAuth(), wrap(async (req, res) => {
    const a = req.auth!;
    const r = await withTenant(a.businessId, (c) => c.query(`SELECT customer_id, customer_name, phone, credit_limit::float, outstanding_balance::float FROM customers ORDER BY customer_name`));
    res.json(r.rows);
  }));

  /* ---------------- Reports ---------------- */
  app.get("/api/reports/summary", requireAuth("OWNER", "ADMIN"), requirePlanFeature("analytics"), wrap(async (req, res) => {
    const a = req.auth!;
    const days = Math.min(Number(req.query.days ?? 7), 366);
    const out = await withTenant(a.businessId, async (c) => {
      const since = new Date(Date.now() - days * 86400000);
      const k = await c.query(`SELECT COUNT(*)::int AS sales_count, COALESCE(SUM(grand_total),0)::float AS revenue,
          COALESCE(SUM(amount_paid),0)::float AS collected FROM sales WHERE business_id = $2 AND created_at >= $1`, [since, a.businessId]);
      const gp = await c.query(`SELECT COALESCE(SUM((si.unit_price - si.unit_cost) * si.quantity),0)::float AS gross_profit,
          COALESCE(SUM(si.unit_price * si.quantity),0)::float AS item_revenue
          FROM sales s JOIN sale_items si ON si.sale_id = s.sale_id WHERE s.business_id = $2 AND s.created_at >= $1`, [since, a.businessId]);
      const daily = await c.query(`WITH agg AS (SELECT (created_at AT TIME ZONE 'Africa/Lagos')::date AS d, SUM(grand_total) AS revenue
            FROM sales WHERE business_id = $2 AND created_at >= $1 GROUP BY 1)
          SELECT to_char(g::date,'DD/MM') AS day, COALESCE(agg.revenue,0)::float AS revenue
          FROM generate_series((now() AT TIME ZONE 'Africa/Lagos')::date - ($3::int - 1), (now() AT TIME ZONE 'Africa/Lagos')::date, '1 day') g
          LEFT JOIN agg ON agg.d = g::date ORDER BY g`, [since, a.businessId, days]);
      const top = await c.query(`SELECT p.product_name, SUM(si.quantity)::int AS qty, SUM(si.line_total)::float AS revenue
          FROM sales s JOIN sale_items si ON si.sale_id = s.sale_id JOIN products p ON p.product_id = si.product_id
          WHERE s.business_id = $2 AND s.created_at >= $1 GROUP BY p.product_name ORDER BY revenue DESC LIMIT 5`, [since, a.businessId]);
      const val = await c.query(`SELECT COALESCE(SUM(i.quantity * p.cost_price),0)::float AS stock_value, COUNT(*) FILTER (WHERE i.quantity <= p.reorder_level)::int AS low_stock
          FROM inventory i JOIN products p USING (product_id) WHERE i.business_id = $1`, [a.businessId]);
      const staff = await c.query(`SELECT u.full_name, COUNT(*)::int AS sales, SUM(s.grand_total)::float AS revenue FROM sales s JOIN users u USING (user_id)
          WHERE s.business_id = $2 AND s.created_at >= $1 GROUP BY u.full_name ORDER BY revenue DESC`, [since, a.businessId]);
      const g = gp.rows[0];
      return { ...k.rows[0], grossProfit: g.gross_profit, grossMargin: g.item_revenue ? money(g.gross_profit / g.item_revenue * 100) : 0,
        daily: daily.rows, topProducts: top.rows, ...val.rows[0], staff: staff.rows };
    });
    res.json(out);
  }));

  app.get("/api/analytics/ai-insights", requireAuth("OWNER", "ADMIN"), requirePlanFeature("aiInsights"), wrap(async (req, res) => {
    const a = req.auth!;
    const insights = await withTenant(a.businessId, async (c) => {
      const { rows } = await c.query(
        `SELECT p.product_name, p.sku, p.reorder_level, i.quantity,
          COALESCE(SUM(si.quantity) FILTER (WHERE s.created_at >= now() - INTERVAL '30 days'), 0)::float AS units_30d,
          COALESCE(SUM(si.quantity) FILTER (WHERE s.created_at >= now() - INTERVAL '14 days'), 0)::float AS units_recent_14d,
          COALESCE(SUM(si.quantity) FILTER (WHERE s.created_at >= now() - INTERVAL '30 days'
            AND s.created_at < now() - INTERVAL '14 days'), 0)::float AS units_previous_16d
         FROM products p
         JOIN inventory i ON i.product_id = p.product_id AND i.branch_id = $1
         LEFT JOIN sale_items si ON si.product_id = p.product_id AND si.business_id = p.business_id
         LEFT JOIN sales s ON s.sale_id = si.sale_id AND s.business_id = p.business_id
           AND s.created_at >= now() - INTERVAL '30 days'
         WHERE p.business_id = $2 AND p.is_active
         GROUP BY p.product_id, p.product_name, p.sku, p.reorder_level, i.quantity
         ORDER BY units_30d DESC, p.product_name`,
        [a.branchId, a.businessId],
      );
      const generated: { type: string; priority: string; title: string; detail: string; product: string }[] = [];
      for (const product of rows) {
        const sold30 = Number(product.units_30d);
        const soldRecent = Number(product.units_recent_14d);
        const soldPrevious = Number(product.units_previous_16d);
        const averageDailySales = sold30 / 30;
        const daysOfStock = averageDailySales > 0 ? Math.floor(Number(product.quantity) / averageDailySales) : null;
        const suggestedReorder = Math.max(0, Math.ceil(averageDailySales * 14) - Number(product.quantity));
        if (Number(product.quantity) === 0) {
          generated.push({ type: "stockout", priority: "high", title: "Out of stock",
            detail: `${product.product_name} is unavailable. Restock before the next sale.`,
            product: product.product_name });
        } else if (Number(product.quantity) <= Number(product.reorder_level) || (daysOfStock !== null && daysOfStock <= 7)) {
          generated.push({ type: "reorder", priority: daysOfStock !== null && daysOfStock <= 3 ? "high" : "medium",
            title: "Reorder recommended",
            detail: `${product.product_name}: order ${Math.max(1, suggestedReorder)} units to cover approximately 14 days of recent demand${daysOfStock === null ? "" : `; current stock may last ${daysOfStock} days`}.`,
            product: product.product_name });
        }
        if (soldRecent >= 3 && soldPrevious > 0 && soldRecent / 14 > soldPrevious / 16 * 1.25) {
          generated.push({ type: "trend", priority: "low", title: "Sales are picking up",
            detail: `${product.product_name} sold ${soldRecent} units in the last 14 days, faster than the preceding period.`,
            product: product.product_name });
        }
      }
      if (!generated.length) generated.push({
        type: "healthy", priority: "low", title: "No urgent stock risks",
        detail: "No stockout or near-term reorder risks were detected from the last 30 days of sales.",
        product: "",
      });
      return generated.sort((left, right) => ({ high: 0, medium: 1, low: 2 }[left.priority as "high" | "medium" | "low"]
        - { high: 0, medium: 1, low: 2 }[right.priority as "high" | "medium" | "low"])).slice(0, 12);
    });
    res.json({
      generatedAt: new Date().toISOString(),
      lookbackDays: 30,
      method: "Statistical sales-velocity and stock-cover analysis; no external AI service is called.",
      insights,
    });
  }));

  app.get("/api/notifications", requireAuth(), wrap(async (req, res) => {
    const a = req.auth!;
    const r = await withTenant(a.businessId, (c) => c.query(`SELECT title, body, created_at FROM notifications ORDER BY created_at DESC LIMIT 20`));
    res.json(r.rows);
  }));

  /* ---------------- Paystack ---------------- */
  app.get("/api/subscription", requireAuth(), wrap(async (req, res) => {
    const a = req.auth!;
    const result = await withTenant(a.businessId, async (c) => {
      const current = await c.query(
        `SELECT plan_name, amount::float, billing_cycle, start_date, expiry_date, status,
                (expiry_date < CURRENT_DATE) AS expired
         FROM subscriptions WHERE business_id = $1 AND status = 'ACTIVE'
         ORDER BY start_date DESC LIMIT 1`,
        [a.businessId],
      );
      const row = current.rows[0];
      const plan = PLAN_CATALOG.find((item) => item.name.toLowerCase() === row?.plan_name?.toLowerCase());
      return {
        subscription: row ?? null,
        features: {
          analytics: !row?.expired && planHasFeature(row?.plan_name, "analytics"),
          aiInsights: !row?.expired && planHasFeature(row?.plan_name, "aiInsights"),
          barcodeScanning: !row?.expired && planHasFeature(row?.plan_name, "barcodeScanning"),
          qrScanning: !row?.expired && planHasFeature(row?.plan_name, "qrScanning"),
        },
        availablePlans: PLAN_CATALOG,
      };
    });
    res.json(result);
  }));

  app.post("/api/subscription/checkout", requireAuth("OWNER"), wrap(async (req, res) => {
    const body = z.object({
      planId: z.enum(["basic", "standard", "premium"]),
      billingCycle: z.enum(["monthly", "annual"]),
    }).parse(req.body);
    const a = req.auth!;
    const plan = planById(body.planId as PaidPlanId)!;
    const cycle = body.billingCycle.toUpperCase();
    const amount = body.billingCycle === "annual" ? plan.annualPrice : plan.monthlyPrice;
    const reference = `SL-${crypto.randomUUID()}`;
    const customer = await withTenant(a.businessId, async (c) => {
      const user = await c.query("SELECT email FROM users WHERE user_id = $1", [a.userId]);
      if (!user.rowCount) throw new HttpError(404, "Account not found");
      await c.query(
        `INSERT INTO subscription_payments
          (business_id, plan_id, billing_cycle, amount, paystack_reference)
         VALUES ($1, $2, $3, $4, $5)`,
        [a.businessId, plan.id, cycle, amount, reference],
      );
      return user.rows[0].email;
    });
    const response = await fetch(`${PAYSTACK_BASE}/transaction/initialize`, {
      method: "POST",
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: customer, amount: amount * 100, currency: "NGN", reference,
        metadata: { business_id: a.businessId, subscription_plan: plan.id, billing_cycle: cycle },
      }),
    });
    const gateway: any = await response.json();
    if (!response.ok || !gateway.status || !gateway.data?.authorization_url) {
      await withTenant(a.businessId, (c) => c.query(
        "UPDATE subscription_payments SET status = 'FAILED', gateway_response = $2 WHERE paystack_reference = $1",
        [reference, gateway.message ?? "Paystack could not start the payment"],
      ));
      throw new HttpError(502, "Paystack could not start the subscription payment");
    }
    res.json({ ...gateway.data, reference, amount, plan: plan.name, billingCycle: cycle });
  }));

  app.post("/api/payments/paystack/initialize", requireAuth(), wrap(async (req, res) => {
    const { saleId, email } = z.object({ saleId: z.string().uuid(), email: z.string().email() }).parse(req.body);
    const a = req.auth!;
    const sale = await withTenant(a.businessId, (c) => c.query(`SELECT grand_total::float, amount_paid::float FROM sales WHERE sale_id = $1`, [saleId]));
    if (!sale.rowCount) throw new HttpError(404, "Sale not found");
    const due = money(sale.rows[0].grand_total - sale.rows[0].amount_paid);
    const reference = `SIMS-${saleId.slice(0, 8)}-${Date.now()}`;
    const r = await fetch(`${PAYSTACK_BASE}/transaction/initialize`, {
      method: "POST", headers: { Authorization: `Bearer ${PAYSTACK_SECRET}`, "Content-Type": "application/json" },
      body: JSON.stringify({ email, amount: Math.round(due * 100), currency: "NGN", reference, metadata: { sale_id: saleId, business_id: a.businessId } }),
    });
    const body: any = await r.json();
    if (!body.status) throw new HttpError(502, "Paystack could not start the payment");
    await withTenant(a.businessId, (c) => c.query(`INSERT INTO payments (business_id,sale_id,amount,payment_method,paystack_reference,status) VALUES ($1,$2,$3,'PAYSTACK',$4,'PENDING')`,
      [a.businessId, saleId, due, reference]));
    res.json(body.data);
  }));

  // Paystack calls this after a payment; the signature proves the call came from Paystack
  app.post("/api/webhooks/paystack", wrap(async (req, res) => {
    const sig = String(req.headers["x-paystack-signature"] ?? "");
    const expected = crypto.createHmac("sha512", PAYSTACK_SECRET).update((req as any).rawBody ?? "").digest("hex");
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return res.status(401).json({ error: "Bad signature" });
    }
    const ev = req.body;
    if (ev.event !== "charge.success") return res.sendStatus(200);
    const ref = ev.data.reference; const businessId = ev.data.metadata?.business_id;
    if (!businessId) return res.status(400).json({ error: "Missing metadata" });
    // confirm with Paystack rather than trusting the webhook body alone
    const verification = await fetch(`${PAYSTACK_BASE}/transaction/verify/${encodeURIComponent(ref)}`, { headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` } });
    const v: any = await verification.json();
    const result = await withTenant(businessId, async (c) => {
      const subscriptionPayment = await c.query(
        "SELECT * FROM subscription_payments WHERE paystack_reference = $1 FOR UPDATE",
        [ref],
      );
      if (subscriptionPayment.rowCount) {
        const payment = subscriptionPayment.rows[0];
        if (payment.status === "SUCCESS") return "duplicate";
        const kobo = Math.round(Number(payment.amount) * 100);
        const metadataMatches = ev.data.metadata?.business_id === businessId
          && ev.data.metadata?.subscription_plan === payment.plan_id
          && ev.data.metadata?.billing_cycle === payment.billing_cycle;
        if (!verification.ok || !v.status || v.data?.status !== "success"
          || v.data.reference !== ref || v.data.amount !== kobo || v.data.currency !== "NGN"
          || !metadataMatches) {
          await c.query(
            "UPDATE subscription_payments SET status = 'FAILED', gateway_response = $2 WHERE subscription_payment_id = $1",
            [payment.subscription_payment_id, "Verification mismatch"],
          );
          return "mismatch";
        }
        const plan = planById(payment.plan_id);
        if (!plan) throw new HttpError(400, "Unknown subscription plan");
        const limits = await c.query(
          `SELECT max_users, max_branches, max_products FROM subscriptions
           WHERE business_id = $1 AND status = 'ACTIVE' ORDER BY start_date DESC LIMIT 1`,
          [businessId],
        );
        const currentLimits = limits.rows[0] ?? { max_users: 3, max_branches: 1, max_products: 200 };
        await c.query(
          "UPDATE subscriptions SET status = 'REPLACED' WHERE business_id = $1 AND status = 'ACTIVE'",
          [businessId],
        );
        await c.query(
          `INSERT INTO subscriptions
            (business_id, plan_name, amount, billing_cycle, max_users, max_branches, max_products,
             start_date, expiry_date, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_DATE,
              (CURRENT_DATE + make_interval(months => $8::int))::date, 'ACTIVE')`,
          [businessId, plan.name, payment.amount, payment.billing_cycle,
            currentLimits.max_users, currentLimits.max_branches, currentLimits.max_products,
             payment.billing_cycle === "ANNUAL" ? 12 : 1],
        );
        await c.query(
          `UPDATE subscription_payments
           SET status = 'SUCCESS', paystack_channel = $2, gateway_response = $3, paid_at = $4
           WHERE subscription_payment_id = $1`,
          [payment.subscription_payment_id, v.data.channel, v.data.gateway_response, v.data.paid_at],
        );
        await c.query(
          "INSERT INTO notifications (business_id, channel, title, body) VALUES ($1, 'IN_APP', 'Subscription activated', $2)",
          [businessId, `${plan.name} ${payment.billing_cycle.toLowerCase()} plan is active.`],
        );
        return "subscription_activated";
      }
      const p = await c.query(`SELECT * FROM payments WHERE paystack_reference = $1 FOR UPDATE`, [ref]);
      if (!p.rowCount) return "unknown";
      if (p.rows[0].status === "SUCCESS") return "duplicate";
      const kobo = Math.round(Number(p.rows[0].amount) * 100);
      if (!verification.ok || !v.status || v.data.status !== "success" || v.data.reference !== ref
        || v.data.amount !== kobo || v.data.currency !== "NGN") {
        await c.query(`UPDATE payments SET status='FAILED', gateway_response=$2 WHERE payment_id=$1`, [p.rows[0].payment_id, "Verification mismatch"]);
        return "mismatch";
      }
      await c.query(`UPDATE payments SET status='SUCCESS', paystack_channel=$2, gateway_response=$3, paid_at=$4 WHERE payment_id=$1`,
        [p.rows[0].payment_id, v.data.channel, v.data.gateway_response, v.data.paid_at]);
      await c.query(`UPDATE sales SET amount_paid = amount_paid + $2, payment_status = CASE WHEN amount_paid + $2 >= grand_total THEN 'PAID' ELSE 'PARTIAL' END WHERE sale_id = $1`,
        [p.rows[0].sale_id, p.rows[0].amount]);
      await c.query(`INSERT INTO notifications (business_id,channel,title,body) VALUES ($1,'IN_APP','Payment received',$2)`, [businessId, `₦${p.rows[0].amount} via Paystack (${v.data.channel})`]);
      return "reconciled";
    });
    res.json({ result });
  }));

  /* ---------------- Baseline: "existing system" behaviour for comparison ----------------
     Sales and inventory are separate modules: the sale is saved first, then the
     inventory module is called separately with a read-then-write update (no lock,
     no shared transaction). Used only by the evaluation scripts. */
  if (process.env.ENABLE_BASELINE === "1") {
    app.post("/api/baseline/sales", requireAuth(), wrap(async (req, res) => {
      const s = SaleSchema.parse(req.body); const a = req.auth!;
      const first = s.items[0];
      const p = await withTenant(a.businessId, (c) => c.query(`SELECT selling_price::float, cost_price::float FROM products WHERE product_id=$1`, [first.productId]));
      const total = p.rows[0].selling_price * first.quantity;
      const sale = await withTenant(a.businessId, (c) => c.query(`INSERT INTO sales (business_id,branch_id,user_id,invoice_no,subtotal,grand_total,amount_paid,payment_status)
        VALUES ($1,$2,$3,$4,$5,$5,$5,'PAID') RETURNING sale_id`, [a.businessId, a.branchId, a.userId, `B-${crypto.randomUUID().slice(0, 12)}`, total]));
      await withTenant(a.businessId, (c) => c.query(`INSERT INTO sale_items (business_id,sale_id,product_id,quantity,unit_price,unit_cost,line_total) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [a.businessId, sale.rows[0].sale_id, first.productId, first.quantity, p.rows[0].selling_price, p.rows[0].cost_price, total]));
      // separate inventory module call
      const cur = await withTenant(a.businessId, (c) => c.query(`SELECT quantity FROM inventory WHERE product_id=$1 AND branch_id=$2`, [first.productId, a.branchId]));
      await new Promise((r) => setTimeout(r, 2)); // network hop between modules
      const next = Math.max(0, cur.rows[0].quantity - first.quantity);
      await withTenant(a.businessId, (c) => c.query(`UPDATE inventory SET quantity=$1 WHERE product_id=$2 AND branch_id=$3`, [next, first.productId, a.branchId]));
      res.status(201).json({ saleId: sale.rows[0].sale_id });
    }));
  }

  /* ---------------- Static web client (PWA) ---------------- */
  const web = path.resolve(process.cwd(), "../web/dist");
  app.use(express.static(web));
  app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(web, "index.html")));

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof z.ZodError) return res.status(422).json({ error: "Invalid input", details: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`) });
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err?.code === "23505") return res.status(409).json({ error: "A record with that value already exists" });
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  });
  return app;
}

async function audit(c: any, a: Auth, action: string, entity: string, id: string, oldV: unknown, newV: unknown, ip?: string) {
  await c.query(`INSERT INTO audit_logs (business_id,user_id,action,entity,entity_id,old_value,new_value,ip_address) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [a.businessId, a.userId, action, entity, id, oldV ? JSON.stringify(oldV) : null, newV ? JSON.stringify(newV) : null, ip ?? null]);
}
