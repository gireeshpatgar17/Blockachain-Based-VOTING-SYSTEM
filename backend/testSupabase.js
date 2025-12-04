import fetch from "node-fetch";
globalThis.fetch = fetch;
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
dotenv.config();

console.log("🚀 Testing Supabase connection...");

try {
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { data, error } = await supabase.from("voters").select("*").limit(1);
  console.log("✅ Result:", data);
  if (error) console.error("❌ Error:", error);
} catch (err) {
  console.error("🔥 Exception:", err);
}
