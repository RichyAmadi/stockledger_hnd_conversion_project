import bcrypt from "bcryptjs";
import { pool } from "./db";

export async function bootstrapPlatformAdmin() {
  const email = process.env.PLATFORM_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.PLATFORM_ADMIN_PASSWORD;
  if (!email && !password) return;
  if (!email || !password) throw new Error("Set both PLATFORM_ADMIN_EMAIL and PLATFORM_ADMIN_PASSWORD to bootstrap the platform administrator");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("PLATFORM_ADMIN_EMAIL must be a valid email address");
  if (password.length < 12) throw new Error("PLATFORM_ADMIN_PASSWORD must be at least 12 characters");

  const existing = await pool.query("SELECT 1 FROM platform_admins LIMIT 1");
  if (existing.rowCount) return;

  const passwordHash = await bcrypt.hash(password, 12);
  const fullName = (process.env.PLATFORM_ADMIN_NAME?.trim() || "Platform Administrator").slice(0, 120);
  const created = await pool.query(`INSERT INTO platform_admins (email,full_name,password_hash)
    VALUES ($1,$2,$3) ON CONFLICT (email) DO NOTHING RETURNING platform_admin_id`, [email, fullName, passwordHash]);
  if (created.rowCount) console.log("Bootstrapped the initial platform administrator");
}
