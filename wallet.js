// wallet.js
import { Wallet } from "ethers";
import fs from "fs";

// 1. Generate a new random wallet
const wallet = Wallet.createRandom();

console.log("✅ Public Address:", wallet.address);
// 2. Encrypt private key with password (Keystore JSON)
// Set KEYSTORE_PASSWORD in the process environment; do not hard-code keystore passwords.
const password = process.env.KEYSTORE_PASSWORD;
if (!password) throw new Error("Set KEYSTORE_PASSWORD before generating a keystore.");

const keystoreJson = await wallet.encrypt(password);

// 3. Save keystore file for voter
fs.writeFileSync("voter-keystore.json", keystoreJson);

console.log("✅ Keystore file generated: voter-keystore.json");
