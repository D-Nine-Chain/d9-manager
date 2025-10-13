/**
 * Installation mode state machine with type-safe transitions.
 *
 * This enforces valid mode configurations and makes invalid states
 * unrepresentable through discriminated unions.
 */

/**
 * Installation mode discriminated union
 */
export type InstallationMode =
  | LegacyMode
  | StandardMode
  | AdvancedMode;

/**
 * Legacy mode - for existing installations with ubuntu/debian user
 */
export interface LegacyMode {
  type: 'legacy';
  dataDirectory: string;
  serviceUser: string;
  keystoreGeneration: 'standard';
}

/**
 * Standard mode - dedicated d9-node user with standard key generation
 */
export interface StandardMode {
  type: 'standard';
  dataDirectory: '/var/lib/d9-node';
  serviceUser: 'd9-node';
  keystoreGeneration: 'standard';
}

/**
 * Advanced mode - dedicated d9-node user with HD key derivation
 */
export interface AdvancedMode {
  type: 'advanced';
  dataDirectory: '/var/lib/d9-node';
  serviceUser: 'd9-node';
  keystoreGeneration: 'hd-derived';
}

/**
 * Mode configuration based on OS and existing installations
 */
export interface ModeDetectionContext {
  osType: 'ubuntu' | 'debian';
  osUser: string;
  hasExistingLegacyInstallation: boolean;
}

/**
 * Factory for creating installation modes
 */
export class InstallationModeFactory {
  /**
   * Detect appropriate mode based on system state
   */
  static detect(context: ModeDetectionContext): InstallationMode {
    if (context.hasExistingLegacyInstallation) {
      return this.createLegacy(context.osUser);
    }

    // For new installations, return undefined - user must choose
    throw new Error('Mode must be explicitly selected for new installations');
  }

  /**
   * Create legacy mode
   */
  static createLegacy(osUser: string): LegacyMode {
    return {
      type: 'legacy',
      dataDirectory: `/home/${osUser}/node-data`,
      serviceUser: osUser,
      keystoreGeneration: 'standard',
    };
  }

  /**
   * Create standard mode
   */
  static createStandard(): StandardMode {
    return {
      type: 'standard',
      dataDirectory: '/var/lib/d9-node',
      serviceUser: 'd9-node',
      keystoreGeneration: 'standard',
    };
  }

  /**
   * Create advanced mode
   */
  static createAdvanced(): AdvancedMode {
    return {
      type: 'advanced',
      dataDirectory: '/var/lib/d9-node',
      serviceUser: 'd9-node',
      keystoreGeneration: 'hd-derived',
    };
  }

  /**
   * Parse mode from user selection
   */
  static fromSelection(
    selection: 'legacy' | 'easy' | 'hard',
    osUser: string
  ): InstallationMode {
    switch (selection) {
      case 'legacy':
        return this.createLegacy(osUser);
      case 'easy':
        return this.createStandard();
      case 'hard':
        return this.createAdvanced();
    }
  }
}

/**
 * Type guards for mode checking
 */
export function isLegacyMode(mode: InstallationMode): mode is LegacyMode {
  return mode.type === 'legacy';
}

export function isStandardMode(mode: InstallationMode): mode is StandardMode {
  return mode.type === 'standard';
}

export function isAdvancedMode(mode: InstallationMode): mode is AdvancedMode {
  return mode.type === 'advanced';
}

/**
 * Mode capabilities - what each mode supports
 */
export interface ModeCapabilities {
  requiresUserCreation: boolean;
  requiresRootPrivileges: boolean;
  supportsHDKeyDerivation: boolean;
  dataDirectoryPermissions: string;
  serviceFileTemplate: 'legacy' | 'standard';
}

/**
 * Get capabilities for a mode
 */
export function getModeCapabilities(mode: InstallationMode): ModeCapabilities {
  switch (mode.type) {
    case 'legacy':
      return {
        requiresUserCreation: false,
        requiresRootPrivileges: true,
        supportsHDKeyDerivation: false,
        dataDirectoryPermissions: '755',
        serviceFileTemplate: 'legacy',
      };
    case 'standard':
      return {
        requiresUserCreation: true,
        requiresRootPrivileges: true,
        supportsHDKeyDerivation: false,
        dataDirectoryPermissions: '750',
        serviceFileTemplate: 'standard',
      };
    case 'advanced':
      return {
        requiresUserCreation: true,
        requiresRootPrivileges: true,
        supportsHDKeyDerivation: true,
        dataDirectoryPermissions: '750',
        serviceFileTemplate: 'standard',
      };
  }
}

/**
 * Get keystore path for a mode
 */
export function getKeystorePath(mode: InstallationMode): string {
  return `${mode.dataDirectory}/chains/d9_main/keystore`;
}

/**
 * Get service user for a mode
 */
export function getServiceUser(mode: InstallationMode): string {
  return mode.serviceUser;
}

/**
 * Get data directory for a mode
 */
export function getDataDirectory(mode: InstallationMode): string {
  return mode.dataDirectory;
}

/**
 * Check if mode requires service user creation
 */
export function requiresUserCreation(mode: InstallationMode): boolean {
  return mode.type !== 'legacy';
}

/**
 * Check if mode supports HD key derivation
 */
export function supportsHDKeyDerivation(mode: InstallationMode): boolean {
  return mode.keystoreGeneration === 'hd-derived';
}

/**
 * Mode display helpers
 */
export function getModeDisplayName(mode: InstallationMode): string {
  switch (mode.type) {
    case 'legacy':
      return 'Legacy Mode (Ubuntu/Debian user)';
    case 'standard':
      return 'Standard Mode (Dedicated user)';
    case 'advanced':
      return 'Advanced Mode (HD key derivation)';
  }
}

export function getModeDescription(mode: InstallationMode): string {
  switch (mode.type) {
    case 'legacy':
      return 'Maintains compatibility with existing installations running under ubuntu/debian user';
    case 'standard':
      return 'Recommended for new installations - runs under dedicated d9-node system user';
    case 'advanced':
      return 'Maximum security with HD key derivation and dedicated system user';
  }
}
