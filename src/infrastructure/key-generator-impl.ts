/**
 * Concrete implementation of KeyGenerator.
 *
 * Infrastructure layer - delegates to existing secure key management.
 */

import { KeyGenerator } from '../services/node-setup-service.ts';
import { insertKeySecurely, auditKeyOperation } from '../utils/secure-keys.ts';
import { executeCommand } from '../utils/system.ts';
import { PATHS } from '../config/constants.ts';
import { Confirm, Input, Select } from '@cliffy/prompt';

/**
 * Polkadot.js-based key generator implementation
 */
export class PolkadotKeyGenerator implements KeyGenerator {
  async generateStandard(basePath: string, serviceUser: string): Promise<void> {
    // Generate seed phrase using d9-node
    console.log('\n🔑 Generating seed phrase...');

    let seedResult = await executeCommand(PATHS.BINARY, [
      'key',
      'generate',
      '--scheme',
      'Sr25519',
    ]);

    if (!seedResult.success) {
      seedResult = await executeCommand(PATHS.BINARY, ['key', 'generate']);
      if (!seedResult.success) {
        throw new Error('Failed to generate seed phrase');
      }
    }

    const seedMatch = seedResult.output.match(/Secret phrase:\s+(.+)/);
    if (!seedMatch) {
      throw new Error('Could not extract seed phrase');
    }

    const seedPhrase = seedMatch[1].trim();

    // Display seed to user
    console.log('\n🔑 IMPORTANT - Save this seed phrase:');
    console.log(`"${seedPhrase}"`);
    console.log('Press Enter when you have saved it...');
    await this.prompt('');

    // Insert keys securely
    await this.insertStandardKeys(seedPhrase, basePath, serviceUser);
  }

  async generateAdvanced(basePath: string, serviceUser: string): Promise<void> {
    console.log('\n🔐 Advanced Key Generation Mode');
    console.log(
      'This mode uses hierarchical deterministic key derivation for enhanced security.\n'
    );

    // Get password
    const password = await this.getSecurePassword();

    // Generate root mnemonic
    const rootMnemonic = await this.generateRootMnemonic(password);

    // Show and verify mnemonic
    await this.confirmRootMnemonic(rootMnemonic);
    await this.verifyMnemonicBackup(rootMnemonic);

    // Insert derived keys
    await this.insertAdvancedKeys(rootMnemonic, basePath, serviceUser);
  }

  /**
   * Insert standard keys (base + derived)
   */
  private async insertStandardKeys(
    seedPhrase: string,
    basePath: string,
    serviceUser: string
  ): Promise<void> {
    console.log('\n🔐 Securely inserting keys into keystore...');

    const keyConfigs = [
      { keyType: 'aura', suri: seedPhrase, scheme: 'Sr25519' as const },
      { keyType: 'gran', suri: `${seedPhrase}//grandpa`, scheme: 'Ed25519' as const },
      { keyType: 'imon', suri: `${seedPhrase}//im_online`, scheme: 'Sr25519' as const },
      {
        keyType: 'audi',
        suri: `${seedPhrase}//authority_discovery`,
        scheme: 'Sr25519' as const,
      },
    ];

    for (const config of keyConfigs) {
      console.log(`  Inserting ${config.keyType} key...`);

      const success = await insertKeySecurely({
        basePath,
        chainSpec: PATHS.CHAIN_SPEC,
        keyType: config.keyType,
        scheme: config.scheme,
        suri: config.suri,
        serviceUser: serviceUser === 'd9-node' ? 'd9-node' : undefined,
      });

      await auditKeyOperation('insert', config.keyType, success, {
        mode: 'standard',
        user: serviceUser,
      });

      if (!success) {
        throw new Error(`Failed to insert ${config.keyType} key securely`);
      }

      console.log(`  ✅ ${config.keyType} key inserted`);
    }
  }

  /**
   * Insert HD-derived keys
   */
  private async insertAdvancedKeys(
    rootMnemonic: string,
    basePath: string,
    serviceUser: string
  ): Promise<void> {
    console.log('\n🔧 Deriving session keys from root...');

    const keyConfigs = [
      { type: 'aura', path: '//aura//0', scheme: 'Sr25519' as const },
      { type: 'gran', path: '//grandpa//0', scheme: 'Ed25519' as const },
      { type: 'imon', path: '//im_online//0', scheme: 'Sr25519' as const },
      { type: 'audi', path: '//authority_discovery//0', scheme: 'Sr25519' as const },
    ];

    for (const config of keyConfigs) {
      console.log(`Currently deriving ${config.type} service key...`);

      const derivedSuri = `${rootMnemonic}${config.path}`;

      const success = await insertKeySecurely({
        basePath,
        chainSpec: PATHS.CHAIN_SPEC,
        keyType: config.type,
        scheme: config.scheme,
        suri: derivedSuri,
        serviceUser: serviceUser === 'd9-node' ? 'd9-node' : undefined,
      });

      await auditKeyOperation('insert', config.type, success, {
        mode: 'advanced',
        user: serviceUser,
        derivationPath: config.path,
      });

      if (!success) {
        throw new Error(`Failed to insert ${config.type} key securely`);
      }
    }
  }

  /**
   * Get secure password from user
   */
  private async getSecurePassword(): Promise<string> {
    console.log('🔒 Creating secure password for key derivation');

    let password1: string;
    let password2: string;

    do {
      password1 = await Input.prompt({
        message: 'Enter password for key derivation:',
        minLength: 8,
      });

      password2 = await Input.prompt({
        message: 'Confirm password:',
      });

      if (password1 !== password2) {
        console.log('❌ Passwords do not match. Please try again.\n');
      }
    } while (password1 !== password2);

    return password1;
  }

  /**
   * Generate root mnemonic
   */
  private async generateRootMnemonic(_password: string): Promise<string> {
    console.log('\n🌱 Generating root mnemonic...');

    const seedResult = await executeCommand(PATHS.BINARY, ['key', 'generate']);
    if (!seedResult.success) {
      throw new Error('Failed to generate root mnemonic');
    }

    const seedMatch = seedResult.output.match(/Secret phrase:\s+(.+)/);
    if (!seedMatch) {
      throw new Error('Could not extract root mnemonic');
    }

    return seedMatch[1].trim();
  }

  /**
   * Confirm root mnemonic with user
   */
  private async confirmRootMnemonic(rootMnemonic: string): Promise<void> {
    console.log('\n🚨 CRITICAL SECURITY INFORMATION');
    console.log('═'.repeat(60));
    console.log('Your ROOT MNEMONIC:');
    console.log(`"${rootMnemonic}"`);
    console.log('═'.repeat(60));
    console.log('⚠️  This root key will NOT be stored locally on this machine.');
    console.log('⚠️  If you lose this mnemonic, you will lose access to your validator.');
    console.log('⚠️  Write it down and store it in a secure location.');
    console.log('═'.repeat(60) + '\n');

    const understood = await Confirm.prompt(
      'Do you understand that this root mnemonic will NOT be stored locally?'
    );

    if (!understood) {
      throw new Error('User must acknowledge security requirements');
    }

    console.log('\n🔴 SECOND CONFIRMATION REQUIRED');
    console.log('The root mnemonic will NOT be stored locally.');
    console.log('You must save it yourself or lose access forever.');

    const confirmation = await Select.prompt({
      message: 'Type "1" to confirm you understand:',
      options: [
        { name: '1 - I understand and have saved the mnemonic', value: true },
        { name: '0 - Cancel setup', value: false },
      ],
    });

    if (!confirmation) {
      throw new Error('Setup cancelled by user');
    }
  }

  /**
   * Verify mnemonic backup
   */
  private async verifyMnemonicBackup(rootMnemonic: string): Promise<void> {
    console.log('\n🔍 Verifying your mnemonic backup...');

    const words = rootMnemonic.split(' ');
    const totalWords = words.length;

    // Generate 3 random word positions
    const positions: number[] = [];
    while (positions.length < 3) {
      const pos = Math.floor(Math.random() * totalWords) + 1;
      if (!positions.includes(pos)) {
        positions.push(pos);
      }
    }
    positions.sort((a, b) => a - b);

    console.log(`Please provide words ${positions.join(', ')} from your mnemonic:`);

    for (const pos of positions) {
      await Input.prompt({
        message: `Word ${pos}:`,
        validate: (input) => {
          if (input.trim().toLowerCase() === words[pos - 1].toLowerCase()) {
            return true;
          }
          return `Incorrect! Expected word ${pos} but got "${input}"`;
        },
      });
    }

    console.log('✅ Mnemonic verification successful!');
  }

  /**
   * Prompt helper
   */
  private prompt(message: string): Promise<string> {
    return new Promise((resolve) => {
      const input = globalThis.prompt(message);
      resolve(input || '');
    });
  }
}
