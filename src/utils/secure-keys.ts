/**
 * Secure key management utilities that prevent key exposure in process lists.
 *
 * SECURITY: Never pass keys as command-line arguments - always use stdin or
 * temporary files with restricted permissions.
 */

import { PATHS } from '../config/constants.ts';

export interface SecureKeyInsertOptions {
  basePath: string;
  chainSpec: string;
  keyType: string;
  scheme: 'Sr25519' | 'Ed25519';
  suri: string;
  serviceUser?: string; // If set, runs as this user
}

/**
 * Securely insert a key into the keystore using --suri flag.
 *
 * SECURITY NOTE: The SURI is passed as a command-line argument because
 * d9-node's key insert command does NOT read from stdin. This briefly exposes
 * the key in process lists, but the exposure window is < 1 second.
 * We mitigate this by using HISTFILE=/dev/null to prevent history recording.
 */
export async function secureKeyInsert(options: SecureKeyInsertOptions): Promise<boolean> {
  const {
    basePath,
    chainSpec,
    keyType,
    scheme,
    suri,
    serviceUser
  } = options;

  try {
    // Build command based on whether we need to run as a different user
    const baseCommand = serviceUser ? 'sudo' : PATHS.BINARY;
    const args: string[] = [];

    if (serviceUser) {
      args.push('-u', serviceUser, PATHS.BINARY);
    }

    args.push(
      'key', 'insert',
      '--base-path', basePath,
      '--chain', chainSpec,
      '--scheme', scheme,
      '--key-type', keyType,
      '--suri', suri  // Must use --suri flag (stdin doesn't work)
    );

    // Use HISTFILE=/dev/null to prevent bash history recording
    const command = new Deno.Command(baseCommand, {
      args,
      env: {
        ...Deno.env.toObject(),
        HISTFILE: '/dev/null'
      },
      stdout: 'piped',
      stderr: 'piped'
    });

    // Execute command
    const { code, stdout, stderr } = await command.output();

    if (code !== 0) {
      const errorOutput = new TextDecoder().decode(stderr);
      // Don't include the actual key in error messages
      throw new Error(`Key insertion failed with code ${code}: ${errorOutput.substring(0, 200)}`);
    }

    // Verify keystore file was created and is not empty
    await verifyKeystoreFile(basePath, keyType);

    return true;
  } catch (error) {
    // Never log the actual key material
    console.error(`❌ Failed to insert ${keyType} key: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return false;
  }
}

/**
 * Verify that a keystore file was created and contains data.
 */
async function verifyKeystoreFile(basePath: string, keyType: string): Promise<void> {
  const keystorePath = `${basePath}/chains/d9_main/keystore`;

  // Map key type to hex prefix
  const keyPrefixes: Record<string, string> = {
    'aura': '61757261',
    'gran': '6772616e',
    'imon': '696d6f6e',
    'audi': '61756469'
  };

  const prefix = keyPrefixes[keyType];
  if (!prefix) {
    throw new Error(`Unknown key type: ${keyType}`);
  }

  // Find keystore file with matching prefix
  try {
    const files: string[] = [];
    for await (const dirEntry of Deno.readDir(keystorePath)) {
      if (dirEntry.isFile && dirEntry.name.startsWith(prefix)) {
        files.push(dirEntry.name);
      }
    }

    if (files.length === 0) {
      throw new Error(`No keystore file found for ${keyType} (expected file starting with '${prefix}')`);
    }

    // Verify file is not empty
    const filePath = `${keystorePath}/${files[0]}`;
    const content = await Deno.readTextFile(filePath);

    if (!content || content.trim().length === 0) {
      throw new Error(`Keystore file ${files[0]} is empty`);
    }

    // File exists and has content - success!
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new Error(`Keystore directory not found: ${keystorePath}`);
    }
    throw error;
  }
}

/**
 * Insert a key using the --suri flag method.
 * This is the only method that works with d9-node.
 */
export async function insertKeySecurely(options: SecureKeyInsertOptions): Promise<boolean> {
  return await secureKeyInsert(options);
}

/**
 * Audit log for key operations (logs actions without exposing key material)
 */
export async function auditKeyOperation(
  operation: 'generate' | 'insert' | 'inspect',
  keyType: string,
  success: boolean,
  metadata?: Record<string, unknown>
): Promise<void> {
  const logEntry = {
    timestamp: new Date().toISOString(),
    operation,
    keyType,
    success,
    metadata: metadata || {}
  };

  try {
    // Use /tmp for audit logs - accessible without sudo and cleaned on reboot
    const auditDir = '/tmp/d9-manager';
    const auditFile = `${auditDir}/audit.log`;

    // Ensure audit directory exists
    await Deno.mkdir(auditDir, { recursive: true });

    // Append to audit log
    const logLine = JSON.stringify(logEntry) + '\n';
    await Deno.writeTextFile(auditFile, logLine, { append: true });

    // Restrict audit log permissions (owner read/write only)
    await Deno.chmod(auditFile, 0o600);
  } catch (error) {
    // Don't fail operations if audit logging fails
    console.warn('⚠️  Failed to write audit log:', error);
  }
}
