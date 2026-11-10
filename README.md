# StockLedger

Prototype sales and inventory platform. `server/` contains the Express/TypeScript API and PostgreSQL migrations; `web/` contains the React/Vite PWA.

## Local setup

Requirements: Node.js (LTS) and PostgreSQL. Run these commands from the project root in PowerShell; enter your local PostgreSQL superuser password when prompted.

```powershell
$env:PGPASSWORD = "your-postgres-password"
createdb -U postgres sims
psql -U postgres -d sims -f server/db/001_schema.sql
psql -U postgres -d sims -f server/db/002_performance.sql
psql -U postgres -d sims -f server/db/003_subscription_tiers.sql
psql -U postgres -d sims -f server/db/004_business_logos.sql
psql -U postgres -d sims -f server/db/005_hosted_auth_lookup.sql
psql -U postgres -d sims -f server/db/006_crm_complaints.sql
psql -U postgres -d sims -f server/db/007_platform_admin.sql

cd web
npm ci
npm run build

cd ..\server
npm ci
npm run build
```

The API defaults to `localhost:5432`, database `sims`, and the `app_user` credentials created by the schema migration. Start the API and frontend in separate terminals:

```powershell
cd server
npm start
```

```powershell
cd web
npm run dev
```

Open the Vite URL printed in the frontend terminal (normally `http://localhost:5173`); `/api` requests are proxied to the API on port 4000.

## Profiles and administration

Every signed-in user can open **My profile** to update their name, email, phone number, or password. Password changes require the current password. Owners and admins can manage team accounts; an owner can also update workspace details, the optional business logo, and the tax rate from **System administration**. Logos can be PNG, JPEG, or WebP images up to 1 MB; leaving the logo empty or removing it is supported.

The corresponding authenticated endpoints are:

- `GET /api/me` and `PUT /api/me` — view or update the signed-in user's profile.
- `GET /api/users`, `POST /api/users`, and `PUT /api/users/:id` — list, add, or edit team members. Only owners can manage administrator accounts; staff cannot list or edit team accounts.
- `PUT /api/business` — update workspace details and tax rate, and optionally set or clear `logoUrl`. Owner-only.

Deactivating a team account revokes its access on its next API request. Business administration is tenant-scoped; there is no cross-business platform-superadmin account.

## Subscription plans

New workspaces start with a 14-day Trial that retains full feature access. After the trial, owners can select a paid plan from **Plans and billing**:

| Plan | Monthly | Annual | Included features |
|---|---:|---:|---|
| Basic | ₦2,999 | ₦29,990 | Point of sale, sales history, products, inventory, customers, and team tools |
| Standard | ₦4,999 | ₦49,990 | Everything in Basic, plus camera barcode scanning, sales and inventory analytics, and reports |
| Premium | ₦9,999 | ₦99,990 | Everything in Standard, plus camera QR code scanning, data-based forecasts, reorder recommendations, and stockout/trend insights |

Annual billing is ten monthly payments (two months free). The server owns the price catalog; checkout ignores client-supplied prices. Subscription payments are stored separately from sale payments and activate only after a signed Paystack webhook is verified for the expected amount and NGN currency. The local Paystack sandbox can exercise this complete checkout and activation flow.

Premium insights use local SQL-based sales-velocity and stock-cover analysis over the previous 30 days; no external AI service is called. The results are estimates for decision support, not purchase orders.

Subscription endpoints:

- `GET /api/plans` — public plan catalog and prices.
- `GET /api/subscription` — signed-in user's current plan and feature entitlements.
- `POST /api/subscription/checkout` — owner-only Paystack checkout; body is `{ "planId": "basic|standard|premium", "billingCycle": "monthly|annual" }`.
- `GET /api/dashboard/overview` — Basic-tier dashboard totals.
- `GET /api/reports/summary` — Trial, Standard, and Premium analytics; Basic returns an upgrade-required response.
- `GET /api/analytics/ai-insights` — Trial/Premium data-driven insights; Basic and Standard require an upgrade.
- `GET /api/products/lookup/barcode?code=...` — Trial/Standard/Premium product lookup by barcode or SKU; Basic requires an upgrade.
- `GET /api/products/lookup/qr?code=...` — Trial/Premium product lookup by QR contents matching a barcode or SKU; Basic and Standard require an upgrade.

The Point of Sale provides camera-based barcode scanning on Standard and Premium, and QR scanning on Premium. Trial retains both features. Scanning requires camera permission and a secure browser context (HTTPS or localhost); the product barcode or QR contents must match an existing product barcode or SKU. Product search and compatible keyboard-wedge scanners remain available independently.

On the Reports screen, **Download report as CSV** exports the selected period's summary metrics, daily revenue, top products, and staff performance.

## Inventory alerts

Products can have an optional expiry date set when they are added. The dashboard shows branch-specific low/out-of-stock items and in-stock products that have expired or are due to expire within 30 days. The inventory list displays saved expiry dates.

- `GET /api/inventory/alerts` — returns `stock` and `expiry` alert lists for the signed-in user's branch, plus the 30-day expiry warning window.
- `GET /api/inventory/low-stock` — returns the existing low-stock-only list.
- `POST /api/products` — accepts an optional `expiryDate` in `YYYY-MM-DD` format.
- `POST /api/inventory/adjust` — authorized inventory roles can add or remove stock with a reason; adjustments cannot make stock negative.

The Purchasing screen lets owners, admins, and inventory managers add suppliers, create purchase orders, and receive orders into branch inventory. Customer accounts can be created from Customers and selected at POS for credit sales. Credit sales enforce each customer's credit limit. The POS uses the business tax rate saved in System administration.

- `GET /api/suppliers` and `GET /api/purchases` — list tenant suppliers and branch purchase orders, including their line items.
- `POST /api/suppliers`, `POST /api/purchases`, and `POST /api/purchases/:id/receive` — create suppliers and purchase orders, and receive outstanding orders.
- `POST /api/customers` and `GET /api/customers` — create and list customer accounts, including credit balances.

## Tests

With the API running and the schema applied, start the local Paystack sandbox in another terminal, then run the functional suite:

```powershell
cd server
$env:PAYSTACK_BASE_URL = "http://localhost:4100"
npx tsx src/paystack-sandbox.ts
```

```powershell
cd server
npm test
```

`npx tsx test/seed.ts` loads demo data. `npx tsx test/bench.ts` runs the longer load and consistency benchmark against a separate `sims_bench` database.

## Deploying to Render

The root `render.yaml` defines a Render web service and a managed PostgreSQL database. The web service builds both packages, applies numbered SQL migrations at startup, and serves the frontend and API from one URL. To deploy, push the repository to GitHub, create a **Blueprint** in the Render dashboard, and select this repository. Render will prompt for `PAYSTACK_SECRET_KEY`; enter the key in Render's secret field, not in this repository. `JWT_SECRET` and `PLATFORM_ADMIN_JWT_SECRET` are generated automatically.

The Blueprint uses Render's free plans. The web service may sleep when idle, and free PostgreSQL databases are temporary; upgrade the service and database plans for persistent production use before storing real business data.

## Platform administration

The platform dashboard uses a separate platform-admin identity and JWT, not a business owner's tenant login. Set `PLATFORM_ADMIN_EMAIL` and a unique `PLATFORM_ADMIN_PASSWORD` (at least 12 characters) in the Render service environment before first platform-admin sign-in. On an empty admin table the service creates that first account once; changing these variables later does not create additional administrators or rotate an existing password. For password rotation, update the platform-admin record through an approved database maintenance procedure. Keep the bootstrap values in Render secrets, never in Git. Use **Platform administrator** from the sign-in screen to open the business directory. Platform admins can review business activity/subscriptions, suspend or reactivate business access, and manage non-owner team roles and access. Owner roles cannot be changed from the platform dashboard.
