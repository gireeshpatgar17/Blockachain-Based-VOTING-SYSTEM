// wallet.js
import { Wallet } from "ethers";
import fs from "fs";

// 1. Generate a new random wallet
const wallet = Wallet.createRandom();

console.log("✅ Public Address:", wallet.address);
console.log("✅ Private Key:", wallet.privateKey);

// 2. Encrypt private key with password (Keystore JSON)
const password = "VoterSecretPassword123";

const keystoreJson = await wallet.encrypt(password);

// 3. Save keystore file for voter
fs.writeFileSync("voter-keystore.json", keystoreJson);

console.log("✅ Keystore file generated: voter-keystore.json");
