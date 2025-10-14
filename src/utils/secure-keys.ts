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
 * Securely insert a key into the keystore using stdin.
 * This prevents key material from appearing in process lists.
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
      '--key-type', keyType
    );

    // Use stdin for the SURI - DO NOT pass it as --suri argument
    const command = new Deno.Command(baseCommand, {
      args,
      stdin: 'piped',
      stdout: 'piped',
      stderr: 'piped'
    });

    const process = command.spawn();

    // Write SURI to stdin
    const writer = process.stdin.getWriter();
    await writer.write(new TextEncoder().encode(suri + '\n'));
    await writer.close();

    // Wait for process to complete
    const { code, stdout, stderr } = await process.output();

    if (code !== 0) {
      const errorOutput = new TextDecoder().decode(stderr);
      // Don't include the actual key in error messages
      throw new Error(`Key insertion failed with code ${code}: ${errorOutput.substring(0, 200)}`);
    }

    return true;
  } catch (error) {
    // Never log the actual key material
    console.error(`❌ Failed to insert ${keyType} key: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return false;
  }
}

/**
 * Insert a key using the most secure method (stdin only).
 * This is the only method supported by d9-node.
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
