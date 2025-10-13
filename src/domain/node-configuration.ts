/**
 * Node configuration domain model.
 *
 * Pure business logic for node configuration, separated from infrastructure.
 * This model represents WHAT needs to be configured, not HOW to configure it.
 */

import { InstallationMode } from './installation-mode.ts';

/**
 * Node type discriminated union
 */
export type NodeType =
  | FullNode
  | ValidatorNode
  | ArchiverNode;

/**
 * Full node configuration
 */
export interface FullNode {
  type: 'full';
  pruning: 1000;
  validatorFlags: never;
}

/**
 * Validator node configuration
 */
export interface ValidatorNode {
  type: 'validator';
  pruning: 1000;
  validatorFlags: '--validator';
}

/**
 * Archiver node configuration
 */
export interface ArchiverNode {
  type: 'archiver';
  pruning: 'archive';
  validatorFlags: never;
}

/**
 * Node configuration value object
 */
export interface NodeConfiguration {
  // Identity
  name: string;

  // Mode
  mode: InstallationMode;

  // Type
  nodeType: NodeType;

  // Network
  port: number;
  chainSpec: string;

  // Paths
  binaryPath: string;
  dataDirectory: string;

  // Service
  serviceUser: string;
  serviceName: string;

  // Validation
  isValid(): boolean;

  // Command generation
  getCommandArgs(): string[];
  getServiceFileContent(): string;
}

/**
 * Factory for creating node configurations
 */
export class NodeConfigurationFactory {
  /**
   * Create a new node configuration
   */
  static create(params: {
    name: string;
    mode: InstallationMode;
    nodeType: 'full' | 'validator' | 'archiver';
    port?: number;
    chainSpec?: string;
    binaryPath?: string;
  }): NodeConfiguration {
    return new NodeConfigurationImpl(
      params.name,
      params.mode,
      this.createNodeType(params.nodeType),
      params.port || 40100,
      params.chainSpec || '/usr/local/bin/new-main-spec.json',
      params.binaryPath || '/usr/local/bin/d9-node'
    );
  }

  /**
   * Create node type from string
   */
  private static createNodeType(type: 'full' | 'validator' | 'archiver'): NodeType {
    switch (type) {
      case 'full':
        return {
          type: 'full',
          pruning: 1000,
          validatorFlags: undefined as never,
        };
      case 'validator':
        return {
          type: 'validator',
          pruning: 1000,
          validatorFlags: '--validator',
        };
      case 'archiver':
        return {
          type: 'archiver',
          pruning: 'archive',
          validatorFlags: undefined as never,
        };
    }
  }
}

/**
 * Implementation of NodeConfiguration
 */
class NodeConfigurationImpl implements NodeConfiguration {
  constructor(
    public readonly name: string,
    public readonly mode: InstallationMode,
    public readonly nodeType: NodeType,
    public readonly port: number,
    public readonly chainSpec: string,
    public readonly binaryPath: string
  ) {}

  get dataDirectory(): string {
    return this.mode.dataDirectory;
  }

  get serviceUser(): string {
    return this.mode.serviceUser;
  }

  get serviceName(): string {
    return 'd9-node';
  }

  /**
   * Validate configuration
   */
  isValid(): boolean {
    // Name validation
    if (!this.name || this.name.length === 0) {
      return false;
    }

    // Port validation
    if (this.port < 1024 || this.port > 65535) {
      return false;
    }

    // Path validation
    if (!this.binaryPath || !this.chainSpec) {
      return false;
    }

    return true;
  }

  /**
   * Get command-line arguments for this configuration
   */
  getCommandArgs(): string[] {
    const args = [
      '--base-path', this.dataDirectory,
      '--chain', this.chainSpec,
      '--name', `"${this.name}"`,
      '--port', this.port.toString(),
    ];

    // Add node type specific flags
    switch (this.nodeType.type) {
      case 'validator':
        args.push('--validator');
        break;
      case 'archiver':
        args.push('--pruning', 'archive');
        break;
      case 'full':
        args.push('--pruning', '1000');
        break;
    }

    return args;
  }

  /**
   * Get systemd service file content
   */
  getServiceFileContent(): string {
    const args = this.getCommandArgs();
    const execStart = `ExecStart=${this.binaryPath} \\\n  ${args.join(' \\\n  ')}`;

    const workingDir = this.mode.type === 'legacy'
      ? ''
      : `WorkingDirectory=${this.dataDirectory}\n`;

    const group = this.mode.type === 'legacy'
      ? ''
      : 'Group=d9-node\n';

    return `[Unit]
Description=D9 Node
After=network.target

[Service]
Type=simple
User=${this.serviceUser}
${group}${workingDir}${execStart}

Restart=on-failure

[Install]
WantedBy=multi-user.target
`;
  }
}

/**
 * Type guards for node types
 */
export function isFullNode(nodeType: NodeType): nodeType is FullNode {
  return nodeType.type === 'full';
}

export function isValidatorNode(nodeType: NodeType): nodeType is ValidatorNode {
  return nodeType.type === 'validator';
}

export function isArchiverNode(nodeType: NodeType): nodeType is ArchiverNode {
  return nodeType.type === 'archiver';
}

/**
 * Node type requirements
 */
export interface NodeTypeRequirements {
  minimumDiskSpace: number; // in GB
  minimumRam: number; // in GB
  description: string;
}

/**
 * Get requirements for a node type
 */
export function getNodeTypeRequirements(nodeType: NodeType): NodeTypeRequirements {
  switch (nodeType.type) {
    case 'full':
      return {
        minimumDiskSpace: 60,
        minimumRam: 4,
        description: 'Full node with pruning - stores recent chain state',
      };
    case 'validator':
      return {
        minimumDiskSpace: 60,
        minimumRam: 4,
        description: 'Validator node - participates in consensus',
      };
    case 'archiver':
      return {
        minimumDiskSpace: 120,
        minimumRam: 8,
        description: 'Archive node - stores complete chain history',
      };
  }
}

/**
 * Display helpers
 */
export function getNodeTypeDisplayName(nodeType: NodeType): string {
  switch (nodeType.type) {
    case 'full':
      return 'Full Node';
    case 'validator':
      return 'Validator Node';
    case 'archiver':
      return 'Archiver Node';
  }
}
