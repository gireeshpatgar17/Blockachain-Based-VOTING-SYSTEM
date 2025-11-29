const { ethers } = require("ethers");

// Generate wallet
const wallet = ethers.Wallet.createRandom();
console.log("Public Address:", wallet.address);

// Voter chooses password
const password = "VoterSecretPassword123";

// Encrypt private key into keystore JSON
wallet.encrypt(password).then((keystoreJson) => {
    // Save keystoreJson as file for voter to download
    console.log("Keystore File:", keystoreJson);
});
