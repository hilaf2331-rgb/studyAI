import { pool } from "./index";
import { DEFAULT_MONTHLY_TOKEN_QUOTA } from "./schema/users";

/**
 * Idempotent, additive-only schema patches applied on every server boot.
 *
 * This exists because the deployment target (Render free tier) has no shell
 * access, so `drizzle-kit push` can't be run by hand against the live
 * database. Each statement uses `IF NOT EXISTS` so it's a no-op once applied
 * and safe to re-run on every restart. Only ever ADD nullable/defaulted
 * columns here — never drop or alter existing columns, since a bad
 * statement would crash the app on boot for every future deploy.
 */
export async function runStartupMigrations(): Promise<void> {
  await pool.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS tokens_remaining integer NOT NULL DEFAULT ${DEFAULT_MONTHLY_TOKEN_QUOTA},
      ADD COLUMN IF NOT EXISTS monthly_token_quota integer NOT NULL DEFAULT ${DEFAULT_MONTHLY_TOKEN_QUOTA};
  `);
}
