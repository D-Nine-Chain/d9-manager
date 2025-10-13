/**
 * Concrete implementation of PackageManager using apt.
 *
 * Infrastructure layer - handles actual system commands.
 */

import { PackageManager } from '../services/node-setup-service.ts';
import { executeCommand } from '../utils/system.ts';

/**
 * APT-based package manager implementation
 */
export class AptPackageManager implements PackageManager {
  async update(): Promise<void> {
    const result = await executeCommand('sudo', ['apt', 'update', '-qq']);

    if (!result.success) {
      throw new Error(`Failed to update package lists: ${result.error}`);
    }
  }

  async install(packages: string[]): Promise<void> {
    // Check which packages are already installed
    const toInstall: string[] = [];

    for (const pkg of packages) {
      if (!(await this.isInstalled(pkg))) {
        toInstall.push(pkg);
      }
    }

    if (toInstall.length === 0) {
      console.log('✅ All packages already installed');
      return;
    }

    console.log(`📦 Installing packages: ${toInstall.join(', ')}`);

    const result = await executeCommand('sudo', [
      'apt',
      'install',
      '-y',
      '-qq',
      ...toInstall,
    ]);

    if (!result.success) {
      throw new Error(`Failed to install packages: ${result.error}`);
    }
  }

  async isInstalled(packageName: string): Promise<boolean> {
    const result = await executeCommand('dpkg', ['-l', packageName]);

    if (!result.success) {
      return false;
    }

    // Check if package is installed (status starts with 'ii')
    const lines = result.output.split('\n');
    for (const line of lines) {
      if (line.startsWith('ii') && line.includes(packageName)) {
        return true;
      }
    }

    return false;
  }
}
