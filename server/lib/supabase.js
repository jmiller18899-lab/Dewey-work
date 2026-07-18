import { createClient } from "@supabase/supabase-js";
import { config } from "./config.js";

let client = null;

/** Service-role client (server-side only — never shipped to the browser). */
export function supabase() {
  if (!config.supabaseUrl || !config.supabaseServiceKey) return null;
  if (!client) {
    client = createClient(config.supabaseUrl, config.supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

/** Insert helper that surfaces Supabase errors as thrown Errors. */
export async function insertRow(table, row) {
  const db = supabase();
  if (!db) throw new Error("Supabase is not configured (SUPABASE_URL / SUPABASE_SERVICE_KEY).");
  const { data, error } = await db.from(table).insert(row).select().single();
  if (error) throw new Error(`Supabase insert into ${table} failed: ${error.message}`);
  return data;
}

/** Insert without needing the row back (e.g. fire-and-record logs). */
export async function insertRows(table, rows) {
  const db = supabase();
  if (!db) throw new Error("Supabase is not configured (SUPABASE_URL / SUPABASE_SERVICE_KEY).");
  const { error } = await db.from(table).insert(rows);
  if (error) throw new Error(`Supabase insert into ${table} failed: ${error.message}`);
}
