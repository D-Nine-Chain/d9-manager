/**
 * Centralized configuration constants for the D9 Manager.
 * This is the single source of truth for all paths, names, and configuration values.
 */

/**
 * System file paths
 */
export const PATHS = {
	/** D9 node binary location */
	BINARY: '/usr/local/bin/d9-node',
	/** Chain specification file location */
	CHAIN_SPEC: '/usr/local/bin/new-main-spec.json',
	/** Systemd service file location */
	SERVICE_FILE: '/etc/systemd/system/d9-node.service',
	/** Data directory for new installations (dedicated user mode) */
	DATA_DIR_NEW: '/var/lib/d9-node',
	/** Legacy data directory for Ubuntu installations */
	DATA_DIR_UBUNTU: '/home/ubuntu/node-data',
	/** Legacy data directory for Debian admin user */
	DATA_DIR_ADMIN: '/home/admin/node-data',
	/** Legacy data directory for Debian installations */
	DATA_DIR_DEBIAN: '/home/debian/node-data',
} as const;

/**
 * Chain configuration
 */
export const CHAIN = {
	/** Chain identifier */
	NAME: 'd9_main',
	/** Relative path from base directory to keystore */
	KEYSTORE_SUFFIX: 'chains/d9_main/keystore',
} as const;

/**
 * Service configuration
 */
export const SERVICE = {
	/** Systemd service name */
	NAME: 'd9-node.service',
	/** System user for service */
	USER: 'd9-node',
	/** System group for service */
	GROUP: 'd9-node',
	/** P2P network port */
	PORT: 40100,
} as const;

/**
 * Validator key types and their configuration
 */
export const KEY_TYPES = {
	/** Aura consensus key (Sr25519) */
	AURA: {
		/** Hex prefix for aura key files */
		prefix: '61757261',
		/** Key type identifier */
		type: 'aura',
		/** Cryptographic scheme */
		scheme: 'Sr25519',
	},
	/** Grandpa finality key (Ed25519) */
	GRANDPA: {
		/** Hex prefix for grandpa key files */
		prefix: '6772616e',
		/** Key type identifier */
		type: 'gran',
		/** Cryptographic scheme */
		scheme: 'Ed25519',
	},
	/** I'm Online key (Sr25519) */
	IM_ONLINE: {
		/** Hex prefix for im_online key files */
		prefix: '696d6f6e',
		/** Key type identifier */
		type: 'imon',
		/** Cryptographic scheme */
		scheme: 'Sr25519',
	},
	/** Authority Discovery key (Sr25519) */
	AUTHORITY_DISCOVERY: {
		/** Hex prefix for authority_discovery key files */
		prefix: '61756469',
		/** Key type identifier */
		type: 'audi',
		/** Cryptographic scheme */
		scheme: 'Sr25519',
	},
} as const;

/**
 * Key derivation paths for different security modes
 */
export const DERIVATION_PATHS = {
	/** Standard derivation paths (easy mode) */
	STANDARD: {
		AURA: '',
		GRANDPA: '//grandpa',
		IM_ONLINE: '//im_online',
		AUTHORITY_DISCOVERY: '//authority_discovery',
	},
	/** Advanced derivation paths with index (hard mode) */
	ADVANCED: {
		AURA: '//aura//0',
		GRANDPA: '//grandpa//0',
		IM_ONLINE: '//im_online//0',
		AUTHORITY_DISCOVERY: '//authority_discovery//0',
	},
} as const;

/**
 * Network configuration
 */
export const NETWORK = {
	/** WebSocket endpoint for D9 mainnet */
	ENDPOINT: 'wss://mainnet.d9network.com:40300',
} as const;

/**
 * External URLs
 */
export const URLS = {
	/** GitHub repository for D9 node */
	GITHUB_REPO: 'https://github.com/D-Nine-Chain/d9-node',
	/** GitHub repository for D9 manager */
	GITHUB_MANAGER_REPO: 'https://github.com/D-Nine-Chain/d9-manager',
	/** Raw GitHub URL for build script */
	BUILD_SCRIPT: 'https://raw.githubusercontent.com/D-Nine-Chain/d9-node/main/scripts/build-node.sh',
	/** Raw GitHub URL for chain spec */
	CHAIN_SPEC: 'https://raw.githubusercontent.com/D-Nine-Chain/d9-node/main/new-main-spec.json',
	/** GitHub API URL for latest release */
	LATEST_RELEASE_API: 'https://api.github.com/repos/D-Nine-Chain/d9-node/releases/latest',
} as const;

/**
 * Helper to get all key types as an array
 */
export const ALL_KEY_TYPES = [
	KEY_TYPES.AURA,
	KEY_TYPES.GRANDPA,
	KEY_TYPES.IM_ONLINE,
	KEY_TYPES.AUTHORITY_DISCOVERY,
] as const;
