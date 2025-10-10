# Polkadot.js Seed/Private Key Extraction Guide

## The Problem

The standard Polkadot.js `KeyPair` interface **does not expose** the private key or seed directly. Properties like `keypair.privateKey` and `keypair.seed` **do not exist** on the standard keypair objects.

The code in `setup.ts` that attempts to extract seeds like this is incorrect:

```typescript
// This doesn't work - these properties don't exist!
const seed = derivedPair.isLocked ? 
  u8aToHex(derivedPair.publicKey.slice(0, 32)) : // This is completely wrong!
  u8aToHex(derivedPair.privateKey || derivedPair.seed || new Uint8Array(32));
```

## Why This Happens

Polkadot.js keypairs are designed with security in mind. Once created, they don't expose the private key material directly. The keypair object only provides:

- `address`: The SS58 encoded address
- `publicKey`: The public key bytes
- `sign()`: Method to sign data
- `verify()`: Method to verify signatures
- `isLocked`: Whether the pair is encrypted
- `type`: The crypto type (sr25519, ed25519, etc.)

## Correct Solutions

### Solution 1: Use the Node's Key Commands (Recommended)

The `d9-node` binary has built-in key management commands that properly handle seed extraction:

```bash
# Generate a new key and display the seed
d9-node key generate --scheme Sr25519

# Inspect a key derivation to get the hex seed
d9-node key inspect "your mnemonic//hard//derivation" --scheme Sr25519

# Insert a key directly into the keystore
d9-node key insert \
  --base-path /var/lib/d9-node \
  --chain /usr/local/bin/new-main-spec.json \
  --key-type aura \
  --scheme Sr25519 \
  --suri "your mnemonic//aura//0"
```

### Solution 2: Store Full SURIs Instead of Seeds

Instead of trying to extract the derived seed, store the full SURI (Secret URI) in the keystore:

```typescript
// Instead of storing just the seed hex:
// "0x1234567890abcdef..."

// Store the full SURI:
// "your mnemonic phrase here//hard//derivation//path"
```

The node can use these SURIs directly to derive the keys when needed.

### Solution 3: Generate Random Keys for Each Service

For session keys that don't need to be derived from a master seed:

```typescript
import { randomAsHex } from '@polkadot/util-crypto';
import { Keyring } from '@polkadot/keyring';

// Generate a random 32-byte seed
const randomSeed = randomAsHex(32);

// Create keypair from this seed
const keyring = new Keyring({ type: 'sr25519' });
const pair = keyring.addFromUri(randomSeed);

// Store the random seed in keystore
const keystoreContent = `"${randomSeed}"`;
```

### Solution 4: Manual Seed Derivation (Advanced)

If you absolutely must derive seeds manually:

```typescript
import { mnemonicToMiniSecret, schnorrkelKeypairFromSeed } from '@polkadot/util-crypto';

// Convert mnemonic to mini secret (32 bytes)
const miniSecret = mnemonicToMiniSecret(mnemonic);

// For SR25519 keys
const { publicKey, secretKey } = schnorrkelKeypairFromSeed(miniSecret);
// Note: secretKey is 64 bytes (32 bytes secret + 32 bytes nonce)
// For keystore, typically only the first 32 bytes are stored

// For derived paths, you'd need to implement the derivation algorithm
// This is complex and not recommended - use the node's commands instead
```

## Keystore File Format

D9 keystore files follow this format:

```
/var/lib/d9-node/chains/d9_main/keystore/
├── 61757261{publicKey} # aura key
├── 6772616e{publicKey} # grandpa key  
├── 696d6f6e{publicKey} # im_online key
└── 61756469{publicKey} # authority_discovery key
```

Each file contains a quoted hex string:
```
"0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
```

## Recommended Approach for D9 Manager

1. **For key generation**: Use `d9-node key generate` to create new keys
2. **For key insertion**: Use `d9-node key insert` with full SURIs
3. **For key inspection**: Use `d9-node key inspect` to get hex representations
4. **Avoid**: Trying to extract seeds from Polkadot.js keypair objects

## Example: Fixed Key Generation Flow

```typescript
async function generateKeysCorrectly(mnemonic: string, basePath: string) {
  const keyConfigs = [
    { type: 'aura', keyType: '61757261', path: '//aura//0', scheme: 'Sr25519' },
    { type: 'gran', keyType: '6772616e', path: '//grandpa//0', scheme: 'Ed25519' },
    { type: 'imon', keyType: '696d6f6e', path: '//im_online//0', scheme: 'Sr25519' },
    { type: 'audi', keyType: '61756469', path: '//authority_discovery//0', scheme: 'Sr25519' }
  ];

  for (const config of keyConfigs) {
    // Use the node's key insert command
    const suri = `${mnemonic}${config.path}`;
    
    await executeCommand('d9-node', [
      'key', 'insert',
      '--base-path', basePath,
      '--chain', '/usr/local/bin/new-main-spec.json',
      '--scheme', config.scheme,
      '--suri', suri,
      '--key-type', config.type
    ]);
  }
}
```

## Summary

- **Don't**: Try to access `keypair.privateKey` or `keypair.seed` - they don't exist
- **Don't**: Use `publicKey.slice(0, 32)` as a seed - this is completely wrong
- **Do**: Use the node's built-in key commands for generation and insertion
- **Do**: Store full SURIs if you need to preserve derivation paths
- **Do**: Generate random keys for session keys that don't need derivation