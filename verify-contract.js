// Quick script to verify contract deployment
// Run: node verify-contract.js
import { ethers } from 'ethers';

const CONTRACT_ADDRESS = "0xd9145CCE52D386f254917e481eB44e9943F39138";
const SEPOLIA_RPC = "https://sepolia.infura.io/v3/7ce5241fd4a848e9959f3bf8d4545836";

async function verify() {
  console.log('🔍 Verifying contract deployment...\n');
  
  const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC);
  
  // Check if contract has code
  const code = await provider.getCode(CONTRACT_ADDRESS);
  
  if (code === '0x' || code === '0x0') {
    console.log('❌ No contract code found at address:', CONTRACT_ADDRESS);
    console.log('\nPossible reasons:');
    console.log('1. Deployment transaction not confirmed yet');
    console.log('2. Deployment failed');
    console.log('3. Wrong network (check if deployed to Sepolia)');
    console.log('4. Wrong address copied');
    console.log('\nCheck on Etherscan:');
    console.log(`https://sepolia.etherscan.io/address/${CONTRACT_ADDRESS}`);
  } else {
    console.log('✅ Contract code found!');
    console.log('Contract is deployed and ready.');
    console.log('\nView on Etherscan:');
    console.log(`https://sepolia.etherscan.io/address/${CONTRACT_ADDRESS}`);
  }
}

verify().catch(console.error);

