/**
 * Concrete Operation implementations for system setup tasks.
 *
 * These provide rollback capability for common operations like:
 * - Directory creation
 * - User creation
 * - File downloads
 * - Package installation
 * - Service management
 */

import { BaseOperation, OperationResult } from './operations.ts';
import { executeCommand } from '../utils/system.ts';

/**
 * Creates a directory with specified permissions
 */
export class CreateDirectoryOperation extends BaseOperation<void> {
  readonly type = 'create_directory';
  readonly description: string;

  constructor(
    private path: string,
    private owner?: string,
    private permissions?: string
  ) {
    super();
    this.description = `Create directory ${path}`;
  }

  async execute(): Promise<OperationResult<void>> {
    try {
      // Create directory
      await Deno.mkdir(this.path, { recursive: true });
      this.executionState.executed = true;
      this.executionState.previousState = { existed: false };

      // Set ownership if specified
      if (this.owner) {
        const result = await executeCommand('sudo', ['chown', '-R', this.owner, this.path]);
        if (!result.success) {
          throw new Error(`Failed to set ownership: ${result.error}`);
        }
      }

      // Set permissions if specified
      if (this.permissions) {
        const result = await executeCommand('sudo', ['chmod', this.permissions, this.path]);
        if (!result.success) {
          throw new Error(`Failed to set permissions: ${result.error}`);
        }
      }

      return this.successResult();
    } catch (error) {
      return this.errorResult(error instanceof Error ? error.message : String(error));
    }
  }

  async rollback(): Promise<OperationResult<void>> {
    if (!this.executionState.executed) {
      return this.successResult();
    }

    try {
      // Only remove if we created it
      const previousState = this.executionState.previousState as { existed: boolean } | undefined;
      if (previousState?.existed === false) {
        await executeCommand('sudo', ['rm', '-rf', this.path]);
      }
      return this.successResult();
    } catch (error) {
      return this.errorResult(`Rollback failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  override async isAlreadyDone(): Promise<boolean> {
    try {
      const stat = await Deno.stat(this.path);
      this.executionState.previousState = { existed: true };
      return stat.isDirectory;
    } catch {
      return false;
    }
  }
}

/**
 * Creates a system user
 */
export class CreateUserOperation extends BaseOperation<void> {
  readonly type = 'create_user';
  readonly description: string;

  constructor(
    private username: string,
    private options: {
      system?: boolean;
      noCreateHome?: boolean;
      shell?: string;
    } = {}
  ) {
    super();
    this.description = `Create user ${username}`;
  }

  async execute(): Promise<OperationResult<void>> {
    try {
      const args = ['sudo', 'useradd'];

      if (this.options.system) args.push('--system');
      if (this.options.noCreateHome) args.push('--no-create-home');
      if (this.options.shell) args.push('--shell', this.options.shell);

      args.push(this.username);

      const result = await executeCommand(args[0], args.slice(1));
      if (!result.success) {
        throw new Error(result.error || 'User creation failed');
      }

      this.executionState.executed = true;
      return this.successResult();
    } catch (error) {
      return this.errorResult(error instanceof Error ? error.message : String(error));
    }
  }

  async rollback(): Promise<OperationResult<void>> {
    if (!this.executionState.executed) {
      return this.successResult();
    }

    try {
      await executeCommand('sudo', ['userdel', this.username]);
      return this.successResult();
    } catch (error) {
      return this.errorResult(`Rollback failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  override async isAlreadyDone(): Promise<boolean> {
    const result = await executeCommand('id', [this.username]);
    return result.success;
  }
}

/**
 * Downloads a file with integrity verification
 */
export class DownloadFileOperation extends BaseOperation<void> {
  readonly type = 'download_file';
  readonly description: string;

  constructor(
    private url: string,
    private destination: string,
    private expectedHash?: string
  ) {
    super();
    this.description = `Download ${url.split('/').pop() || 'file'}`;
  }

  async execute(): Promise<OperationResult<void>> {
    try {
      // Download file
      const downloadResult = await executeCommand('wget', ['-O', this.destination, this.url]);
      if (!downloadResult.success) {
        throw new Error(`Download failed: ${downloadResult.error}`);
      }

      // Verify hash if provided
      if (this.expectedHash) {
        const hashResult = await executeCommand('sha256sum', [this.destination]);
        if (!hashResult.success) {
          throw new Error('Failed to verify file integrity');
        }

        const actualHash = hashResult.output.trim().split(/\s+/)[0];
        if (actualHash !== this.expectedHash) {
          throw new Error('File integrity verification failed');
        }
      }

      this.executionState.executed = true;
      return this.successResult();
    } catch (error) {
      return this.errorResult(error instanceof Error ? error.message : String(error));
    }
  }

  async rollback(): Promise<OperationResult<void>> {
    if (!this.executionState.executed) {
      return this.successResult();
    }

    try {
      await Deno.remove(this.destination);
      return this.successResult();
    } catch (error) {
      return this.errorResult(`Rollback failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  override async isAlreadyDone(): Promise<boolean> {
    try {
      const stat = await Deno.stat(this.destination);
      return stat.isFile;
    } catch {
      return false;
    }
  }
}

/**
 * Installs system packages via apt
 */
export class InstallPackagesOperation extends BaseOperation<void> {
  readonly type = 'install_packages';
  readonly description: string;

  constructor(private packages: string[]) {
    super();
    this.description = `Install packages: ${packages.join(', ')}`;
  }

  async execute(): Promise<OperationResult<void>> {
    try {
      const result = await executeCommand('sudo', [
        'apt',
        'install',
        '-y',
        '-qq',
        ...this.packages
      ]);

      if (!result.success) {
        throw new Error(result.error || 'Package installation failed');
      }

      this.executionState.executed = true;
      return this.successResult();
    } catch (error) {
      return this.errorResult(error instanceof Error ? error.message : String(error));
    }
  }

  async rollback(): Promise<OperationResult<void>> {
    // Note: We don't automatically uninstall packages on rollback
    // as they might be used by other software
    console.log(`⚠️  Note: Packages ${this.packages.join(', ')} not removed (may be used by other software)`);
    return this.successResult();
  }

  override async isAlreadyDone(): Promise<boolean> {
    // Check if all packages are already installed
    for (const pkg of this.packages) {
      const result = await executeCommand('dpkg', ['-l', pkg]);
      if (!result.success || !result.output.includes('ii')) {
        return false;
      }
    }
    return true;
  }
}

/**
 * Creates and installs a systemd service file
 */
export class CreateServiceFileOperation extends BaseOperation<void> {
  readonly type = 'create_service';
  readonly description: string;

  constructor(
    private serviceName: string,
    private serviceContent: string,
    private serviceFilePath: string
  ) {
    super();
    this.description = `Create service ${serviceName}`;
  }

  async execute(): Promise<OperationResult<void>> {
    try {
      // Write to temp file first
      const tempFile = `/tmp/${this.serviceName}.service`;
      await Deno.writeTextFile(tempFile, this.serviceContent);

      // Move to systemd directory
      const moveResult = await executeCommand('sudo', ['mv', tempFile, this.serviceFilePath]);
      if (!moveResult.success) {
        throw new Error(`Failed to install service file: ${moveResult.error}`);
      }

      // Reload systemd
      const reloadResult = await executeCommand('sudo', ['systemctl', 'daemon-reload']);
      if (!reloadResult.success) {
        throw new Error(`Failed to reload systemd: ${reloadResult.error}`);
      }

      this.executionState.executed = true;
      return this.successResult();
    } catch (error) {
      return this.errorResult(error instanceof Error ? error.message : String(error));
    }
  }

  async rollback(): Promise<OperationResult<void>> {
    if (!this.executionState.executed) {
      return this.successResult();
    }

    try {
      // Remove service file
      await executeCommand('sudo', ['rm', this.serviceFilePath]);

      // Reload systemd
      await executeCommand('sudo', ['systemctl', 'daemon-reload']);

      return this.successResult();
    } catch (error) {
      return this.errorResult(`Rollback failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  override async isAlreadyDone(): Promise<boolean> {
    try {
      await Deno.stat(this.serviceFilePath);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Enables and starts a systemd service
 */
export class EnableServiceOperation extends BaseOperation<void> {
  readonly type = 'enable_service';
  readonly description: string;

  constructor(private serviceName: string) {
    super();
    this.description = `Enable service ${serviceName}`;
  }

  async execute(): Promise<OperationResult<void>> {
    try {
      // Enable service
      const enableResult = await executeCommand('sudo', ['systemctl', 'enable', this.serviceName]);
      if (!enableResult.success) {
        throw new Error(`Failed to enable service: ${enableResult.error}`);
      }

      this.executionState.executed = true;
      return this.successResult();
    } catch (error) {
      return this.errorResult(error instanceof Error ? error.message : String(error));
    }
  }

  async rollback(): Promise<OperationResult<void>> {
    if (!this.executionState.executed) {
      return this.successResult();
    }

    try {
      await executeCommand('sudo', ['systemctl', 'disable', this.serviceName]);
      return this.successResult();
    } catch (error) {
      return this.errorResult(`Rollback failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  override async isAlreadyDone(): Promise<boolean> {
    const result = await executeCommand('systemctl', ['is-enabled', this.serviceName]);
    return result.success && result.output.trim() === 'enabled';
  }
}

/**
 * Starts a systemd service
 */
export class StartServiceOperation extends BaseOperation<void> {
  readonly type = 'start_service';
  readonly description: string;

  constructor(private serviceName: string) {
    super();
    this.description = `Start service ${serviceName}`;
  }

  async execute(): Promise<OperationResult<void>> {
    try {
      const result = await executeCommand('sudo', ['systemctl', 'start', this.serviceName]);
      if (!result.success) {
        throw new Error(`Failed to start service: ${result.error}`);
      }

      this.executionState.executed = true;
      return this.successResult();
    } catch (error) {
      return this.errorResult(error instanceof Error ? error.message : String(error));
    }
  }

  async rollback(): Promise<OperationResult<void>> {
    if (!this.executionState.executed) {
      return this.successResult();
    }

    try {
      await executeCommand('sudo', ['systemctl', 'stop', this.serviceName]);
      return this.successResult();
    } catch (error) {
      return this.errorResult(`Rollback failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  override async isAlreadyDone(): Promise<boolean> {
    const result = await executeCommand('systemctl', ['is-active', this.serviceName]);
    return result.success && result.output.trim() === 'active';
  }
}
