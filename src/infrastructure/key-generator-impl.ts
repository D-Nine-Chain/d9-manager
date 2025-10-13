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
import { Messages } from '../types.ts';

/**
 * Polkadot.js-based key generator implementation
 */
export class PolkadotKeyGenerator implements KeyGenerator {
  constructor(private readonly messages: Messages) {}
  async generateStandard(basePath: string, serviceUser: string): Promise<void> {
    // Generate seed phrase using d9-node
    console.log(this.messages.keyGeneration.generatingSeedPhrase);

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
    console.log(this.messages.keyGeneration.importantSavePhrase);
    console.log(this.messages.keyGeneration.seedPhraseLabel.replace('%s', seedPhrase));
    console.log(this.messages.keyGeneration.pressEnterWhenSaved);
    await this.prompt('');

    // Insert keys securely
    await this.insertStandardKeys(seedPhrase, basePath, serviceUser);
  }

  async generateAdvanced(basePath: string, serviceUser: string): Promise<void> {
    console.log(this.messages.keyGeneration.advancedModeTitle);
    console.log(this.messages.keyGeneration.advancedModeDesc);

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
    console.log(this.messages.keyGeneration.securingKeys);

    // Display SURI explanation
    console.log(this.messages.setup.suriExplanationTitle);
    console.log(this.messages.setup.suriExplanationDesc);
    console.log(this.messages.setup.suriFormatLabel);
    console.log(this.messages.setup.suriExampleBase);
    console.log(this.messages.setup.suriExampleDerived);
    console.log(this.messages.setup.suriExampleAdvanced);
    console.log(this.messages.setup.suriAutoProvided);
    console.log('');

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
      console.log(this.messages.setup.insertingKeyType.replace('%s', config.keyType));

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

      console.log(this.messages.keyGeneration.keyInserted.replace('%s', config.keyType));
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
    console.log(this.messages.keyGeneration.derivingKeys);

    // Display hierarchical derivation explanation
    console.log(this.messages.setup.suriHierarchicalTitle);
    console.log(this.messages.setup.suriHierarchicalDesc);
    console.log(this.messages.setup.suriHierarchicalFormat);
    console.log(this.messages.setup.suriHierarchicalExample1);
    console.log(this.messages.setup.suriHierarchicalExample2);
    console.log(this.messages.setup.suriHierarchicalNote);
    console.log('');

    const keyConfigs = [
      { type: 'aura', path: '//aura//0', scheme: 'Sr25519' as const },
      { type: 'gran', path: '//grandpa//0', scheme: 'Ed25519' as const },
      { type: 'imon', path: '//im_online//0', scheme: 'Sr25519' as const },
      { type: 'audi', path: '//authority_discovery//0', scheme: 'Sr25519' as const },
    ];

    for (const config of keyConfigs) {
      console.log(this.messages.keyGeneration.currentlyDeriving.replace('%s', config.type));

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
    console.log(this.messages.keyGeneration.creatingPassword);

    let password1: string;
    let password2: string;

    do {
      password1 = await Input.prompt({
        message: this.messages.keyGeneration.enterPassword,
        minLength: 8,
      });

      password2 = await Input.prompt({
        message: this.messages.keyGeneration.confirmPassword,
      });

      if (password1 !== password2) {
        console.log(this.messages.keyGeneration.passwordMismatch);
      }
    } while (password1 !== password2);

    return password1;
  }

  /**
   * Generate root mnemonic
   */
  private async generateRootMnemonic(_password: string): Promise<string> {
    console.log(this.messages.keyGeneration.generatingRootMnemonic);

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
    console.log(this.messages.keyGeneration.criticalSecurityTitle);
    console.log('═'.repeat(60));
    console.log(this.messages.keyGeneration.rootMnemonicLabel);
    console.log(`"${rootMnemonic}"`);
    console.log('═'.repeat(60));
    console.log(this.messages.keyGeneration.rootNotStoredWarning1);
    console.log(this.messages.keyGeneration.rootNotStoredWarning2);
    console.log(this.messages.keyGeneration.rootNotStoredWarning3);
    console.log('═'.repeat(60) + '\n');

    const understood = await Confirm.prompt(
      this.messages.keyGeneration.understandPrompt
    );

    if (!understood) {
      throw new Error(this.messages.keyGeneration.mustAcknowledge);
    }

    console.log(this.messages.keyGeneration.secondConfirmTitle);
    console.log(this.messages.keyGeneration.rootNotStoredLocalWarning);
    console.log(this.messages.keyGeneration.mustSaveWarning);

    const confirmation = await Select.prompt({
      message: this.messages.keyGeneration.confirmOptions,
      options: [
        { name: this.messages.keyGeneration.optionUnderstand, value: true },
        { name: this.messages.keyGeneration.optionCancel, value: false },
      ],
    });

    if (!confirmation) {
      throw new Error(this.messages.keyGeneration.setupCancelled);
    }
  }

  /**
   * Verify mnemonic backup
   */
  private async verifyMnemonicBackup(rootMnemonic: string): Promise<void> {
    console.log(this.messages.keyGeneration.verifyingBackup);

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

    console.log(this.messages.keyGeneration.provideWordsPrompt.replace('%s', positions.join(', ')));

    for (const pos of positions) {
      await Input.prompt({
        message: this.messages.keyGeneration.wordNumberPrompt.replace('%s', pos.toString()),
        validate: (input) => {
          if (input.trim().toLowerCase() === words[pos - 1].toLowerCase()) {
            return true;
          }
          return this.messages.keyGeneration.incorrectWordError
            .replace('%s', pos.toString())
            .replace('%s', input);
        },
      });
    }

    console.log(this.messages.keyGeneration.verificationSuccess);
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
