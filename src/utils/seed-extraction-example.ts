import { Keyring } from '@polkadot/keyring';
import { cryptoWaitReady, mnemonicGenerate } from '@polkadot/util-crypto';
import { u8aToHex, hexToU8a } from '@polkadot/util';

/**
 * Example demonstrating how to properly extract raw seed/private key from Polkadot.js keypairs
 */

async function demonstrateSeedExtraction() {
  // Ensure crypto is ready
  await cryptoWaitReady();

  console.log('=== Polkadot.js Seed/Private Key Extraction Examples ===\n');

  // Example 1: Basic keypair from mnemonic
  console.log('1. Basic keypair from mnemonic:');
  const mnemonic = mnemonicGenerate(12);
  console.log(`Mnemonic: ${mnemonic}`);
  
  const keyring = new Keyring({ type: 'sr25519', ss58Format: 9 });
  const pair = keyring.addFromUri(mnemonic);
  
  // The keypair object doesn't directly expose the seed
  // But we can extract it from the mnemonic using createFromUri
  console.log(`Address: ${pair.address}`);
  console.log(`Public Key: ${u8aToHex(pair.publicKey)}`);
  console.log(`Is Locked: ${pair.isLocked}`);
  
  // Example 2: Derived keypair with path
  console.log('\n2. Derived keypair with path:');
  const derivedPair = keyring.addFromUri(`${mnemonic}//validator//0`);
  console.log(`Derived Address: ${derivedPair.address}`);
  console.log(`Derived Public Key: ${u8aToHex(derivedPair.publicKey)}`);

  // Example 3: Getting the seed from a raw hex key
  console.log('\n3. Creating keypair from raw seed:');
  const rawSeed = '0x' + 'a'.repeat(64); // 32 bytes hex
  const rawPair = keyring.addFromUri(rawSeed);
  console.log(`Raw seed input: ${rawSeed}`);
  console.log(`Address from raw: ${rawPair.address}`);

  // Example 4: The correct way to handle derived keys for storage
  console.log('\n4. Proper seed extraction for keystore:');
  
  // For sr25519, the keypair contains a 64-byte private key (32 bytes secret + 32 bytes nonce)
  // For ed25519, it's just 32 bytes
  
  // Method A: Use the keypair's toJson() method with password
  const json = pair.toJson('mypassword');
  console.log('Encrypted JSON format:', JSON.stringify(json, null, 2));
  
  // Method B: For unencrypted storage (like in keystore files)
  // The proper way is to use the raw seed or the derived seed
  
  // If you need to store just the 32-byte seed for a derived key,
  // you should derive it separately and store that seed
  const derivedSeed = keyring.createFromUri(`${mnemonic}//validator//0`, {}, { type: 'sr25519' });
  
  // Note: The actual seed bytes are not directly accessible from the keypair object
  // This is by design for security. Instead, you should:
  // 1. Store the full derivation path (mnemonic + path)
  // 2. Or pre-derive and store the hex representation
  
  console.log('\n=== Key Storage Patterns ===');
  console.log('1. Store full derivation path: "mnemonic//path"');
  console.log('2. Store derived hex key: Use d9-node key inspect to get the hex');
  console.log('3. Use encrypted JSON: pair.toJson(password)');
  
  // Example 5: What the keystore actually stores
  console.log('\n5. Keystore file format:');
  console.log('The keystore stores a hex string representing the private key material.');
  console.log('For sr25519: 32 bytes of key material');
  console.log('For ed25519: 32 bytes of key material');
  console.log('The file contains: "0x..." (quoted hex string)');
}

// Additional helper function showing the pattern used in setup.ts
function extractSeedFromKeypair(keypair: any): string {
  // This is the pattern used in setup.ts, but it's not ideal
  // The privateKey, seed properties are not standard on Polkadot.js keypairs
  
  if (keypair.isLocked) {
    // This is a fallback that doesn't actually give you the seed
    // It's taking the first 32 bytes of the public key, which is wrong
    console.warn('WARNING: Keypair is locked, cannot extract seed');
    return u8aToHex(new Uint8Array(32)); // Returns zeros
  }
  
  // These properties don't exist on standard Polkadot.js keypairs
  // This code appears to be using a different interface or expecting
  // properties that aren't there
  const seed = keypair.privateKey || keypair.seed || new Uint8Array(32);
  return u8aToHex(seed);
}

// The correct approach for key derivation and storage
async function correctKeyDerivationApproach() {
  await cryptoWaitReady();
  
  console.log('\n=== Correct Approach for Key Storage ===\n');
  
  const mnemonic = mnemonicGenerate(12);
  const keyring = new Keyring({ type: 'sr25519', ss58Format: 9 });
  
  // Approach 1: Store the full SURI (mnemonic + derivation path)
  const suri = `${mnemonic}//validator//0`;
  console.log('1. Store full SURI:', suri);
  
  // Approach 2: Use the node's key generation commands
  // The d9-node binary has built-in key generation that outputs the hex
  console.log('\n2. Use node key commands:');
  console.log('   d9-node key generate --scheme Sr25519');
  console.log('   d9-node key inspect "mnemonic//path" --scheme Sr25519');
  
  // Approach 3: Generate a raw hex key for each service
  console.log('\n3. Generate service-specific keys:');
  const services = ['aura', 'grandpa', 'im_online', 'authority_discovery'];
  
  for (const service of services) {
    // For each service, you would:
    // 1. Derive the key using the path
    const serviceSuri = `${mnemonic}//${service}//0`;
    const servicePair = keyring.addFromUri(serviceSuri);
    
    // 2. Use the node's key insert command to add it
    console.log(`   ${service}: Use 'd9-node key insert' with the SURI`);
    
    // The node handles the actual storage format internally
  }
}

// Run the examples
if (import.meta.main) {
  demonstrateSeedExtraction()
    .then(() => correctKeyDerivationApproach())
    .catch(console.error);
}

export { demonstrateSeedExtraction, correctKeyDerivationApproach };