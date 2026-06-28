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
      ADD COLUMN IF NOT EXISTS monthly_token_quota integer NOT NULL DEFAULT ${DEFAULT_MONTHLY_TOKEN_QUOTA},
      ADD COLUMN IF NOT EXISTS last_study_date timestamptz,
      ADD COLUMN IF NOT EXISTS current_streak integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS longest_streak integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user',
      ADD COLUMN IF NOT EXISTS subscription_tier text NOT NULL DEFAULT 'free',
      ADD COLUMN IF NOT EXISTS is_paying_customer boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS bit_name text,
      ADD COLUMN IF NOT EXISTS token_balance integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS last_token_refill_at timestamptz NOT NULL DEFAULT now();
  `);

  await pool.query(`
    ALTER TABLE flashcards
      ADD COLUMN IF NOT EXISTS concept text;
  `);

  await pool.query(`
    ALTER TABLE questions
      ADD COLUMN IF NOT EXISTS concept text,
      ADD COLUMN IF NOT EXISTS option_explanations text[];
  `);

  await pool.query(`
    ALTER TABLE materials
      ADD COLUMN IF NOT EXISTS cram_mode boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS exam_date timestamptz,
      ADD COLUMN IF NOT EXISTS share_id text;
  `);

  // share_id's uniqueness (materials.ts's .unique()) is enforced via index
  // rather than ADD CONSTRAINT, since Postgres has no
  // "ADD CONSTRAINT IF NOT EXISTS" -- this is the idempotent equivalent.
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS materials_share_id_unique ON materials (share_id);
  `);

  // Course Glossary: student-defined course-specific terminology used to
  // ground the AI summary pipeline (see ai.ts's buildGlossaryContext).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS glossary_terms (
      id serial PRIMARY KEY,
      course_id integer NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      term text NOT NULL,
      definition text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS glossary_terms_course_id_idx ON glossary_terms (course_id);
  `);

  // Token top-up purchases credited by the payment webhook (routes/billing.ts).
  // provider_transaction_id is UNIQUE so a gateway's at-least-once webhook
  // retry can never double-credit the same payment.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS transactions (
      id serial PRIMARY KEY,
      user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      package_id text NOT NULL,
      tokens integer NOT NULL,
      price_ils integer NOT NULL,
      provider text NOT NULL DEFAULT 'cardcom',
      provider_transaction_id text NOT NULL UNIQUE,
      status text NOT NULL DEFAULT 'completed',
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS transactions_user_id_idx ON transactions (user_id);
  `);
}
