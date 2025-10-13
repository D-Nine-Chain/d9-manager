/**
 * Node setup service - orchestrates node installation using domain models.
 *
 * This service separates business logic (domain) from infrastructure concerns
 * using dependency injection.
 */

import { NodeConfiguration } from '../domain/node-configuration.ts';
import { InstallationMode } from '../domain/installation-mode.ts';
import { TransactionManager } from '../core/transaction-manager.ts';
import { Operation } from '../core/operations.ts';
import {
  CreateDirectoryOperation,
  CreateUserOperation,
  CreateServiceFileOperation,
  EnableServiceOperation,
} from '../core/system-operations.ts';
import { Messages } from '../types.ts';

/**
 * Package manager abstraction
 */
export interface PackageManager {
  update(): Promise<void>;
  install(packages: string[]): Promise<void>;
  isInstalled(packageName: string): Promise<boolean>;
}

/**
 * Binary downloader abstraction
 */
export interface BinaryDownloader {
  download(url: string, destination: string): Promise<void>;
  verify(path: string, expectedHash?: string): Promise<boolean>;
}

/**
 * Key generator abstraction
 */
export interface KeyGenerator {
  generateStandard(basePath: string, serviceUser: string): Promise<void>;
  generateAdvanced(basePath: string, serviceUser: string): Promise<void>;
}

/**
 * Service dependencies (injected)
 */
export interface NodeSetupServiceDependencies {
  packageManager: PackageManager;
  binaryDownloader: BinaryDownloader;
  keyGenerator: KeyGenerator;
  messages: Messages;
}

/**
 * Node setup service
 */
export class NodeSetupService {
  constructor(private readonly deps: NodeSetupServiceDependencies) {}

  /**
   * Setup a node with the given configuration
   */
  async setupNode(config: NodeConfiguration): Promise<void> {
    // Validate configuration
    if (!config.isValid()) {
      throw new Error('Invalid node configuration');
    }

    // Build operations sequence
    const operations = this.buildOperations(config);

    // Create transaction manager
    const txManager = new TransactionManager(this.deps.messages);

    // Initialize transaction
    await txManager.initialize(operations, {
      mode: config.mode.type,
      nodeType: config.nodeType.type,
      configuration: {
        nodeName: config.name,
        basePath: config.dataDirectory,
        serviceUser: config.serviceUser,
        keystorePath: `${config.dataDirectory}/chains/d9_main/keystore`,
      },
    });

    // Execute with automatic rollback on failure
    const result = await txManager.execute();

    if (!result.success) {
      throw new Error(`Node setup failed: ${result.error}`);
    }

    // Clear state on success
    await txManager.clear();
  }

  /**
   * Build operations sequence for a configuration
   */
  private buildOperations(config: NodeConfiguration): Operation[] {
    const operations: Operation[] = [];

    // Step 1: Create service user (if needed)
    if (config.mode.type !== 'legacy') {
      operations.push(
        new CreateUserOperation('d9-node', {
          system: true,
          noCreateHome: true,
          shell: '/bin/false',
        })
      );
    }

    // Step 2: Create data directory
    const permissions = config.mode.type === 'legacy' ? undefined : '750';
    const owner = config.mode.type === 'legacy'
      ? `${config.serviceUser}:${config.serviceUser}`
      : 'd9-node:d9-node';

    operations.push(
      new CreateDirectoryOperation(config.dataDirectory, owner, permissions)
    );

    // Step 3: Create systemd service
    operations.push(
      new CreateServiceFileOperation(
        config.serviceName,
        config.getServiceFileContent(),
        `/etc/systemd/system/${config.serviceName}.service`
      )
    );

    // Step 4: Enable service
    operations.push(
      new EnableServiceOperation(`${config.serviceName}.service`)
    );

    // Note: Key generation and service start are handled separately
    // as they may require user interaction

    return operations;
  }

  /**
   * Generate keys for a configuration
   */
  async generateKeys(config: NodeConfiguration): Promise<void> {
    const mode = config.mode;

    if (mode.type === 'advanced' && mode.keystoreGeneration === 'hd-derived') {
      await this.deps.keyGenerator.generateAdvanced(
        config.dataDirectory,
        config.serviceUser
      );
    } else {
      await this.deps.keyGenerator.generateStandard(
        config.dataDirectory,
        config.serviceUser
      );
    }
  }
}

/**
 * Factory for creating NodeSetupService with default dependencies
 */
export class NodeSetupServiceFactory {
  /**
   * Create service with default dependencies
   */
  static createDefault(): NodeSetupService {
    // Default implementations would be injected here
    // For now, this is a placeholder for the refactoring
    throw new Error('Default dependencies not yet implemented. Use createWithDependencies()');
  }

  /**
   * Create service with custom dependencies
   */
  static createWithDependencies(deps: NodeSetupServiceDependencies): NodeSetupService {
    return new NodeSetupService(deps);
  }
}
