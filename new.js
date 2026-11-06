const { ethers } = require("ethers");

// Generate wallet
const wallet = ethers.Wallet.createRandom();
console.log("Public Address:", wallet.address);

// Voter chooses password
// Set KEYSTORE_PASSWORD in the process environment; do not hard-code keystore passwords.
const password = process.env.KEYSTORE_PASSWORD;
if (!password) throw new Error("Set KEYSTORE_PASSWORD before generating a keystore.");

// Encrypt private key into keystore JSON
wallet.encrypt(password).then((keystoreJson) => {
    // Save keystoreJson as file for voter to download
    console.log("Keystore File:", keystoreJson);
});
