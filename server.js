// server.js
// Backend for OTP (Twilio Verify) + static frontend serving
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { ethers } from 'ethers';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
app.use(cors());
app.use(express.json());

// For ES modules (to get __dirname)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// === Twilio Setup ===
let twilioClient = null;
try {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env;
  if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
    const twilio = (await import('twilio')).default;
    twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  }
} catch (e) {
  console.warn('⚠️ Twilio not initialized yet:', e.message);
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

// === OTP ROUTES ===

// Send OTP
app.post('/otp/send', async (req, res) => {
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
app.post('/otp/verify', async (req, res) => {
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

// === Admin Wallet Funding ===
app.post('/fund', async (req, res) => {
  try {
    const { to, amount, adminPrivateKey } = req.body || {};
    if (!to || !amount)
      return res.status(400).json({ ok: false, error: 'Missing to or amount' });

    const rpcUrl = process.env.RPC_URL;
    // Accept supplied adminPrivateKey from POST or fall back to env
    const adminPk = adminPrivateKey || process.env.FUNDER_PRIVATE_KEY;
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

    // Wait for confirmation (optional, can remove to only provide the tx hash immediately)
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

// === Serve Frontend ===
app.use(express.static(path.join(__dirname, 'html')));

// Redirect root to index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'html', 'index.html'));
});

// === Start Server ===
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});

