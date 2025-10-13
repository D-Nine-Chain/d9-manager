import { Keyring } from '@polkadot/keyring';
import { cryptoWaitReady, mnemonicGenerate, mnemonicToMiniSecret, naclKeypairFromSeed, schnorrkelKeypairFromSeed } from '@polkadot/util-crypto';
import { u8aToHex, hexToU8a } from '@polkadot/util';
import { ALL_KEY_TYPES, PATHS, buildKeystorePath } from '../config/constants.ts';

/**
 * Proper seed/private key handling for Polkadot.js
 * 
 * IMPORTANT: The standard Polkadot.js KeyPair interface does NOT expose
 * the private key or seed directly. This is by design for security.
 * 
 * The code in setup.ts that tries to access `keypair.privateKey` or 
 * `keypair.seed` is incorrect - these properties don't exist.
 */

export async function properSeedHandling() {
  await cryptoWaitReady();

  console.log('=== Proper Seed/Private Key Handling ===\n');

  // The Issue: Polkadot.js KeyPair objects don't expose private keys
  const keyring = new Keyring({ type: 'sr25519', ss58Format: 9 });
  const mnemonic = mnemonicGenerate(12);
  const pair = keyring.addFromUri(mnemonic);
  
  console.log('Standard KeyPair properties:');
  console.log('- address:', pair.address);
  console.log('- publicKey:', u8aToHex(pair.publicKey));
  console.log('- type:', pair.type);
  console.log('- isLocked:', pair.isLocked);
  console.log('- privateKey:', (pair as any).privateKey); // undefined!
  console.log('- seed:', (pair as any).seed); // undefined!

  console.log('\n=== Solution 1: Use the node\'s key commands ===');
  console.log('The d9-node binary handles key generation and storage:');
  console.log('');
  console.log('# Generate a new key and get the seed');
  console.log('d9-node key generate --scheme Sr25519');
  console.log('');
  console.log('# Inspect a key to get its hex representation');
  console.log('d9-node key inspect "mnemonic//path" --scheme Sr25519');
  console.log('');
  console.log('# Insert a key into the keystore');
  console.log('d9-node key insert --key-type aura --scheme Sr25519 --suri "mnemonic//path"');

  console.log('\n=== Solution 2: Generate raw seeds manually ===');
  
  // For sr25519 keys
  const sr25519Example = async () => {
    // Convert mnemonic to mini secret (32 bytes)
    const miniSecret = mnemonicToMiniSecret(mnemonic);
    console.log('Mini secret from mnemonic:', u8aToHex(miniSecret));
    
    // Generate keypair from seed
    const { publicKey, secretKey } = schnorrkelKeypairFromSeed(miniSecret);
    console.log('SR25519 Public key:', u8aToHex(publicKey));
    console.log('SR25519 Secret key:', u8aToHex(secretKey)); // 64 bytes (32 secret + 32 nonce)
    
    // For keystore, you typically store just the first 32 bytes
    const seedForKeystore = secretKey.slice(0, 32);
    console.log('Seed for keystore:', u8aToHex(seedForKeystore));
  };

  await sr25519Example();

  console.log('\n=== Solution 3: Derive keys with paths ===');
  
  // The problem: How to get the derived seed for a path like "//validator//0"
  // The solution: Use the node's built-in commands or derive manually
  
  // You cannot easily extract the derived seed from a Polkadot.js keypair
  // Instead, you should:
  // 1. Use the full SURI (mnemonic + path) when inserting keys
  // 2. Let the node handle the derivation internally

  console.log('\n=== Correct Pattern for Key Storage ===');
  const correctKeyStorage = async (mnemonic: string, basePath: string) => {
    const keyConfigs = ALL_KEY_TYPES.map(kt => ({
      type: kt.type,
      keyType: kt.prefix,
      scheme: kt.scheme
    }));

    for (const config of keyConfigs) {
      // Option 1: Use the node's key insert command with full SURI
      const suri = `${mnemonic}//${config.type}`;
      console.log(`\nFor ${config.type}:`);
      console.log(`d9-node key insert --base-path ${basePath} --key-type ${config.type} --scheme ${config.scheme} --suri "${suri}"`);
      
      // Option 2: If you must generate the hex manually, use the node's key inspect
      console.log(`Or get hex with: d9-node key inspect "${suri}" --scheme ${config.scheme}`);
    }
  };

  await correctKeyStorage(mnemonic, PATHS.DATA_DIR_NEW);

  console.log('\n=== The Problem with the Current Code ===');
  console.log('The current setup.ts code tries to do this:');
  console.log('```');
  console.log('const seed = derivedPair.isLocked ?');
  console.log('  u8aToHex(derivedPair.publicKey.slice(0, 32)) : // WRONG!');
  console.log('  u8aToHex(derivedPair.privateKey || derivedPair.seed || new Uint8Array(32));');
  console.log('```');
  console.log('');
  console.log('Issues:');
  console.log('1. derivedPair.privateKey and derivedPair.seed don\'t exist');
  console.log('2. Using publicKey.slice(0, 32) as seed is completely wrong');
  console.log('3. This will store incorrect data in the keystore');

  console.log('\n=== Recommended Fix ===');
  console.log('Instead of trying to extract seeds from keypairs, use one of these approaches:');
  console.log('');
  console.log('1. Use d9-node key commands (preferred):');
  console.log('   - Let the node handle all key generation and storage');
  console.log('   - Use "d9-node key generate" to create keys');
  console.log('   - Use "d9-node key insert" with SURIs');
  console.log('');
  console.log('2. Store full SURIs in keystore:');
  console.log('   - Store "mnemonic//path" instead of trying to extract seeds');
  console.log('   - The node can use these directly');
  console.log('');
  console.log('3. Use temporary key generation:');
  console.log('   - Generate a random hex key for each service');
  console.log('   - Store that hex key (not derived from mnemonic)');
}

/**
 * Example of how to properly generate and store keys for the keystore
 */
export async function generateKeystoreFiles(mnemonic: string, basePath: string) {
  await cryptoWaitReady();
  
  const keystorePath = buildKeystorePath(basePath);
  
  // Generate a temporary random key for each service
  // This is what should be stored in the keystore files
  const generateServiceKey = (keyType: string, scheme: 'sr25519' | 'ed25519') => {
    const keyring = new Keyring({ type: scheme, ss58Format: 9 });
    
    // Option 1: Generate a random key (not derived from mnemonic)
    const randomSeed = new Uint8Array(32);
    crypto.getRandomValues(randomSeed);
    const randomHex = u8aToHex(randomSeed);
    
    // Create keypair from random seed
    const pair = keyring.addFromUri(randomHex);
    
    // Keystore filename format: keyType + publicKey (without 0x)
    const filename = `${keyType}${u8aToHex(pair.publicKey).substring(2)}`;
    
    return {
      filename,
      content: `"${randomHex}"`, // Quoted hex string
      publicKey: u8aToHex(pair.publicKey),
      address: pair.address
    };
  };
  
  // Example usage
  const auraKey = generateServiceKey(ALL_KEY_TYPES[0].prefix, 'sr25519'); // Use AURA key type
  console.log('Generated Aura key:');
  console.log('- File:', `${keystorePath}/${auraKey.filename}`);
  console.log('- Content:', auraKey.content);
  console.log('- Public Key:', auraKey.publicKey);
  console.log('- Address:', auraKey.address);
}

if (import.meta.main) {
  properSeedHandling().catch(console.error);
}