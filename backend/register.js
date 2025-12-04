// ✅ backend/register.js
import fetch from "node-fetch"; // Force working fetch for Node 22
globalThis.fetch = fetch; // Make it global so Supabase uses it

import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { autoFundVoter } from "./blockchain.js";
import { ethers } from "ethers";

dotenv.config();

// ---------- EXPRESS SETUP ----------
const app = express();
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    // allow the admin-secret header used by the admin UI and other common headers
    allowedHeaders: ["Content-Type", "Authorization", "x-admin-secret", "x-requested-with"],
  })
);
app.use(bodyParser.json({ limit: "2mb" }));

// ---------- SUPABASE SETUP ----------
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ Missing Supabase env. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

// ✅ Force Supabase to use our fetch
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  global: { fetch },
});

// ---------- TWILIO SETUP ----------
let twilioClient = null;
try {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env;
  if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
    const twilio = (await import('twilio')).default;
    twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  }
} catch (e) {
  console.warn('⚠️ Twilio not initialized:', e.message);
}

function assertEnv() {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SID } = process.env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_VERIFY_SID) {
    throw new Error('Missing Twilio env variables');
  }
  if (!twilioClient) {
    throw new Error('Twilio client not initialized');
  }
}

// ---------- OTP ROUTES ----------
// Send OTP
app.post("/otp/send", async (req, res) => {
  try {
    assertEnv();
    const { to } = req.body || {};
    if (!to) return res.status(400).json({ ok: false, error: 'Missing "to" field' });

    const verification = await twilioClient.verify.v2
      .services(process.env.TWILIO_VERIFY_SID)
      .verifications.create({ to, channel: 'sms' });

    return res.json({ ok: true, status: verification.status });
  } catch (e) {
    console.error('OTP send error:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// Verify OTP
app.post("/otp/verify", async (req, res) => {
  try {
    assertEnv();
    const { to, code } = req.body || {};
    if (!to || !code) return res.status(400).json({ ok: false, error: 'Missing "to" or "code"' });

    const check = await twilioClient.verify.v2
      .services(process.env.TWILIO_VERIFY_SID)
      .verificationChecks.create({ to, code });

    const valid = check.status === 'approved';
    return res.json({ ok: valid, status: check.status });
  } catch (e) {
    console.error('OTP verify error:', e.message);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ---------- FUNDING ROUTE ----------
app.post("/fund", async (req, res) => {
  try {
    const { to, amount, adminPrivateKey } = req.body || {};
    if (!to || !amount)
      return res.status(400).json({ ok: false, error: 'Missing to or amount' });

    const rpcUrl = process.env.RPC_URL;
    const adminPk = adminPrivateKey || process.env.FUNDER_PRIVATE_KEY || process.env.ADMIN_PRIVATE_KEY;
    if (!rpcUrl || !adminPk)
      return res.status(500).json({ ok: false, error: 'Server not configured with RPC_URL or private key' });

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const admin = new ethers.Wallet(adminPk, provider);

    let tx;
    try {
      tx = await admin.sendTransaction({
        to,
        value: ethers.parseEther(String(amount)),
      });
    } catch (sendErr) {
      return res.status(500).json({ ok: false, funded: false, error: sendErr.message || String(sendErr) });
    }

    let receipt;
    try {
      receipt = await tx.wait();
    } catch (waitErr) {
      return res.status(200).json({
        ok: true,
        funded: false,
        amount: amount,
        tx: tx.hash,
        error: 'Transaction sent but not confirmed: ' + (waitErr.message || waitErr)
      });
    }

    // Try to mark the voter as funded in Supabase (service role client is available)
    try {
      const updateData = {
        is_funded: true,
        funded_tx: tx.hash,
        funded_at: new Date().toISOString(),
      };

      console.log('🔔 Attempting to update voter record for metamask_address=', to);
      const { data: dbData, error: dbError } = await supabase
        .from('voters')
        .update(updateData)
        .eq('metamask_address', to);

      if (dbError) {
        console.warn('⚠️ Supabase update returned error:', dbError);
      } else {
        console.log('✅ Supabase update result:', dbData?.length ? 'updated' : 'no rows matched');
      }
    } catch (dbErr) {
      console.warn('⚠️ Failed to update Supabase voter record:', dbErr?.message || dbErr);
    }

    return res.json({
      ok: true,
      funded: true,
      amount,
      tx: tx.hash,
      blockNumber: receipt.blockNumber,
      message: `${amount} SepoliaETH funded to voter wallet. Tx: ${tx.hash}`
    });
  } catch (e) {
    console.error('Fund error:', e.message || e);
    return res.status(500).json({ ok: false, funded: false, error: e.message || String(e) });
  }
});

// ---------- FINGERPRINT SCANNING ----------
app.post("/api/scanAndRegister", async (req, res) => {
  console.log("📩 Scan request body:", req.body);

  try {
    const { aadhaar_no, name, mobile_no, dob, email } = req.body || {};

    if (!aadhaar_no || !name || !mobile_no || !dob || !email) {
      return res.status(400).json({
        ok: false,
        error: "BAD_REQUEST",
        message: "Missing required fields (aadhaar_no, name, mobile_no, dob, email)",
      });
    }

    // Generate a mock fingerprint hash (replace with actual scanner integration)
    const fingerprintHash = `fp_${aadhaar_no}_${Date.now()}`;

    // Optionally store in Supabase
    try {
      const { data: voter, error } = await supabase
        .from("voters")
        .insert([
          {
            aadhaar_no,
            name,
            mobile_no,
            dob,
            email,
            fingerprint_hash: fingerprintHash,
          },
        ])
        .select()
        .single();

      if (error) {
        console.error("❌ Supabase insert error:", error);
        // Still return hash even if DB insert fails
      }
    } catch (dbErr) {
      console.error("❌ DB insert failed:", dbErr);
      // Continue anyway
    }

    res.json({
      ok: true,
      fingerprintHash,
      message: "Fingerprint scanned and stored successfully",
    });
  } catch (error) {
    console.error("❌ Scan error:", error);
    res.status(500).json({
      ok: false,
      error: "SCAN_FAILED",
      message: String(error?.message || error),
    });
  }
});

// ---------- VOTER REGISTRATION ----------
app.post("/api/registerVoter", async (req, res) => {
  console.log("📩 Incoming request body:", req.body);
  console.log("📩 Request body keys:", Object.keys(req.body || {}));
  console.log("📩 DOB from req.body:", req.body?.dob);

  try {
    // Server-side: enforce election registration window (if configured)
    try {
      const { data: setting } = await supabase
        .from('election_settings')
        .select('start_time,end_time')
        .limit(1)
        .maybeSingle();
      if (setting && setting.start_time && setting.end_time) {
        const now = new Date();
        const start = new Date(setting.start_time);
        const end = new Date(setting.end_time);
        if (!(now >= start && now <= end)) {
          return res.status(403).json({ ok: false, error: 'REGISTRATION_CLOSED', message: 'Registration is not open at this time.' });
        }
      }
    } catch (winErr) {
      console.warn('Could not read election window:', winErr?.message || winErr);
      // If window cannot be read, allow registration to avoid accidental lockout
    }

    const { aadhaar_no, name, wallet_address, dob, mobile_no, email, face_descriptor } = req.body || {};

    if (!aadhaar_no || !name || !wallet_address) {
      return res.status(400).json({
        ok: false,
        error: "BAD_REQUEST",
        message: "Missing required fields (aadhaar_no, name, wallet_address)",
      });
    }

    if (!dob) {
      return res.status(400).json({
        ok: false,
        error: "BAD_REQUEST",
        message: "Missing required field: dob (date of birth)",
      });
    }

    console.log("🔍 Extracted values:", { aadhaar_no, name, wallet_address, dob, mobile_no, email });
    console.log("🔍 DOB type and value:", typeof dob, dob);
    
    // Ensure dob is a valid date string
    if (!dob || (typeof dob !== 'string' && typeof dob !== 'object')) {
      return res.status(400).json({
        ok: false,
        error: "BAD_REQUEST",
        message: "Invalid date of birth format",
      });
    }
    
    // Convert to ISO date string if needed
    let dobFormatted = dob;
    if (typeof dob === 'object' || (typeof dob === 'string' && dob.includes('T'))) {
      try {
        dobFormatted = new Date(dob).toISOString().split('T')[0];
      } catch (e) {
        console.warn("⚠️ Date conversion warning:", e.message);
      }
    }
    
    const insertData = {
      aadhaar_no,
      name,
      metamask_address: wallet_address,
      dob: dobFormatted,
      mobile_no: mobile_no || "0000000000", // Default value if not provided
      email: email || null,
      is_registered: true, // Mark as registered after successful registration
      face_descriptor: face_descriptor || null, // Store face descriptor as JSONB array
    };
    
    console.log("🧾 Attempting to insert/update voter record with data:", JSON.stringify(insertData, null, 2));
    
    // First, check if a voter with this aadhaar_no already exists
    const { data: existingVoter, error: checkError } = await supabase
      .from("voters")
      .select("id, aadhaar_no, metamask_address")
      .eq("aadhaar_no", aadhaar_no)
      .maybeSingle(); // Use maybeSingle() instead of single() to handle "not found" gracefully

    let voter;
    let error;

    let isUpdate = false;
    
    // If voter exists (or if checkError is just "not found", which we ignore)
    if (existingVoter && !checkError) {
      // Update existing voter record
      isUpdate = true;
      console.log("🔄 Voter with this Aadhaar number already exists. Updating record...");
      const { data: updatedVoter, error: updateError } = await supabase
        .from("voters")
        .update({
          name,
          metamask_address: wallet_address,
          dob: dobFormatted,
          mobile_no: mobile_no || "0000000000",
          email: email || null,
          is_registered: true, // Mark as registered after successful registration
          face_descriptor: face_descriptor || null, // Update face descriptor
        })
        .eq("aadhaar_no", aadhaar_no)
        .select()
        .single();
      
      voter = updatedVoter;
      error = updateError;
      console.log("🔄 Update result:", { data: voter, error });
    } else {
      // Insert new voter record
      console.log("➕ Creating new voter record...");
      const { data: newVoter, error: insertError } = await supabase
        .from("voters")
        .insert([insertData])
        .select()
        .single();
      
      voter = newVoter;
      error = insertError;
      console.log("➕ Insert result:", { data: voter, error });
    }

    if (error) {
      console.error("❌ Supabase error details:", error);
      throw new Error("Database operation failed. Check server logs for details.");
    }

    // Funding removed - voter registration only
    console.log(`✅ Voter ${name} registered successfully`);

    res.json({
      ok: true,
      id: voter?.id,
      message: isUpdate 
        ? "Voter information updated successfully" 
        : "Voter registered successfully",
      isUpdate: isUpdate,
    });
  } catch (error) {
    console.error("❌ Register error:", error);
    res.status(500).json({
      ok: false,
      error: "REGISTER_FAILED",
      message: String(error?.message || error),
    });
  }
});

// GET current election window
app.get('/api/election-window', async (req, res) => {
  try {
    const { data: setting, error } = await supabase
      .from('election_settings')
      .select('start_time,end_time')
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    // include server 'now' and an 'open' boolean to help clients avoid clock-skew problems
    const now = new Date();
    let open = false;
    if (setting && setting.start_time && setting.end_time) {
      const s = new Date(setting.start_time);
      const e = new Date(setting.end_time);
      open = now >= s && now <= e;
    }
    return res.json({ ok: true, data: setting || null, now: now.toISOString(), open });
  } catch (e) {
    console.error('Failed to fetch election window:', e?.message || e);
    return res.status(500).json({ ok: false, error: 'SERVER_ERROR', message: String(e?.message || e) });
  }
});

// POST set election window (admin)
app.post('/api/admin/set-election', async (req, res) => {
  try {
    // If ADMIN_API_SECRET is set, require it via header x-admin-secret
    const ADMIN_API_SECRET = process.env.ADMIN_API_SECRET || null;
    if (ADMIN_API_SECRET) {
      const provided = req.get('x-admin-secret');
      if (!provided || provided !== ADMIN_API_SECRET) {
        return res.status(401).json({ ok: false, error: 'UNAUTHORIZED', message: 'Missing or invalid admin secret' });
      }
    }

    const { start_time, end_time, label } = req.body || {};
    if (!start_time || !end_time) return res.status(400).json({ ok: false, error: 'BAD_REQUEST', message: 'Missing start_time or end_time' });
    const s = new Date(start_time);
    const e = new Date(end_time);
    if (!(s < e)) return res.status(400).json({ ok: false, error: 'BAD_REQUEST', message: 'start_time must be before end_time' });

    // Upsert into election_settings (single row). Try to update existing row or insert.
    const { data: existing } = await supabase.from('election_settings').select('id').limit(1).maybeSingle();
    if (existing && existing.id) {
      const { data, error } = await supabase.from('election_settings').update({ start_time, end_time, updated_at: new Date().toISOString(), label: label || 'main' }).eq('id', existing.id).select().single();
      if (error) throw error;
      return res.json({ ok: true, data });
    } else {
      const { data, error } = await supabase.from('election_settings').insert([{ start_time, end_time, label: label || 'main' }]).select().single();
      if (error) throw error;
      return res.json({ ok: true, data });
    }
  } catch (e) {
    console.error('Failed to set election window:', e?.message || e);
    return res.status(500).json({ ok: false, error: 'SERVER_ERROR', message: String(e?.message || e) });
  }
});

// ---------- SERVER START ----------
const PORT = process.env.BACKEND_PORT ? Number(process.env.BACKEND_PORT) : 4000;
app.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));
