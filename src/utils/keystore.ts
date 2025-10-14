import { Keyring } from "@polkadot/keyring";
import { u8aToHex, hexToU8a } from "@polkadot/util";
import { mnemonicValidate } from "@polkadot/util-crypto";
import { cryptoWaitReady } from "@polkadot/util-crypto";
import { PATHS, CHAIN, KEY_TYPES } from "../config/constants.ts";

export interface KeystoreInfo {
	address: string;
	publicKey: string;
	hasKeys: boolean;
}

/**
 * Build keystore path from a base data directory
 */
export function buildKeystorePath(basePath: string): string {
	return `${basePath}/${CHAIN.KEYSTORE_SUFFIX}`;
}

/**
 * Get the actual data directory in use by checking which one exists.
 * Returns null if no data directory is found.
 */
export async function getDataDirectory(): Promise<string | null> {
	const possiblePaths: string[] = [
		PATHS.DATA_DIR_NEW,
		PATHS.DATA_DIR_UBUNTU,
		PATHS.DATA_DIR_ADMIN,
		PATHS.DATA_DIR_DEBIAN,
	];

	// Add current user's path if SUDO_USER is set
	const sudoUser = Deno.env.get("SUDO_USER") || Deno.env.get("USER");
	if (sudoUser && sudoUser !== "ubuntu" && sudoUser !== "admin" && sudoUser !== "debian") {
		possiblePaths.push(`/home/${sudoUser}/node-data`);
	}

	for (const path of possiblePaths) {
		try {
			const stat = await Deno.stat(path);
			if (stat.isDirectory) {
				return path;
			}
		} catch {
			// Path doesn't exist, continue
		}
	}

	return null;
}

/**
 * Find the keystore directory path across multiple possible locations.
 * This is the single source of truth for keystore location.
 */
export async function findKeystorePath(options?: { verbose?: boolean }): Promise<string | null> {
	const verbose = options?.verbose ?? true;

	// Build possible keystore paths from data directories
	const possiblePaths: string[] = [
		buildKeystorePath(PATHS.DATA_DIR_NEW),
		buildKeystorePath(PATHS.DATA_DIR_UBUNTU),
		buildKeystorePath(PATHS.DATA_DIR_ADMIN),
		buildKeystorePath(PATHS.DATA_DIR_DEBIAN),
	];

	// Add current user's path if SUDO_USER is set
	const sudoUser = Deno.env.get("SUDO_USER") || Deno.env.get("USER");
	if (sudoUser && sudoUser !== "ubuntu" && sudoUser !== "admin" && sudoUser !== "debian") {
		possiblePaths.push(buildKeystorePath(`/home/${sudoUser}/node-data`));
	}

	if (verbose) {
		console.log("🔍 Searching for keystore in the following locations:");
		possiblePaths.forEach((path, idx) => {
			console.log(`   ${idx + 1}. ${path}`);
		});
	}

	// Find the first existing keystore directory
	for (const path of possiblePaths) {
		try {
			const stat = await Deno.stat(path);
			if (stat.isDirectory) {
				if (verbose) {
					console.log(`✅ Found keystore at: ${path}`);
				}
				return path;
			}
		} catch (error) {
			if (verbose) {
				console.log(`   ❌ Not found: ${path}`);
			}
		}
	}

	if (verbose) {
		console.log("❌ No keystore directory found in any of the expected locations.");
		console.log("💡 Tip: Keystore is created during node setup. Run node setup first.");
	}
	return null;
}

export async function readKeystoreInfo(): Promise<KeystoreInfo | null> {
	await cryptoWaitReady();

	const keystorePath = await findKeystorePath({ verbose: true });

	if (!keystorePath) {
		return null;
	}

	try {
		console.log(`\n🔑 Checking for keys in keystore...`);

		// Look for aura key (starts with KEY_TYPES.AURA.prefix)
		const files = [];
		for await (const dirEntry of Deno.readDir(keystorePath)) {
			if (dirEntry.isFile && dirEntry.name.startsWith(KEY_TYPES.AURA.prefix)) {
				files.push(dirEntry.name);
			}
		}

		if (files.length === 0) {
			console.log(`❌ No aura key found in keystore (expected file starting with '${KEY_TYPES.AURA.prefix}')`);
			console.log(`   Keystore path: ${keystorePath}`);
			console.log("💡 Keys are generated during node setup. Please run setup first.");
			return { address: "", publicKey: "", hasKeys: false };
		}

		console.log(`✅ Found ${files.length} aura key(s)`);

		// Read the first aura key file
		const keyFilePath = `${keystorePath}/${files[0]}`;
		console.log(`📖 Reading key from: ${keyFilePath}`);
		let keyData = await Deno.readTextFile(keyFilePath);

		// Remove quotes if present (key files often have quotes around the actual key)
		keyData = keyData.trim();
		if ((keyData.startsWith('"') && keyData.endsWith('"')) || 
			(keyData.startsWith("'") && keyData.endsWith("'"))) {
			keyData = keyData.slice(1, -1);
		}

		// Parse the key data
		let secretKey: string;
		if (keyData.startsWith("0x")) {
			// Hex key - check for derivation path
			secretKey = keyData;
		} else if (/^[0-9a-fA-F]+$/.test(keyData)) {
			// Raw hex string without 0x prefix (common in keystore files)
			secretKey = "0x" + keyData;
		} else if (keyData.includes(" ")) {
			// Mnemonic - check for derivation path
			const parts = keyData.split("//");
			if (parts.length > 1) {
				// Has hard derivation path
				const mnemonic = parts[0].trim();
				if (!mnemonicValidate(mnemonic)) {
					throw new Error("Invalid mnemonic");
				}
				secretKey = keyData; // Keep full URI with derivation
			} else {
				// Check for soft derivation
				const softParts = keyData.split("/");
				if (softParts.length > 1 && !softParts[0].includes(" ")) {
					// Might be derivation without mnemonic, check if first part is mnemonic
					const mnemonic = softParts[0].trim();
					if (mnemonicValidate(mnemonic)) {
						secretKey = keyData; // Keep full URI with soft derivation
					} else {
						throw new Error("Invalid mnemonic with derivation");
					}
				} else if (softParts.length > 1) {
					// Mnemonic with soft derivation
					const mnemonicPart = softParts.slice(0, -1).join("/").trim();
					if (!mnemonicValidate(mnemonicPart)) {
						throw new Error("Invalid mnemonic");
					}
					secretKey = keyData; // Keep full URI
				} else {
					// Just mnemonic
					if (!mnemonicValidate(keyData)) {
						throw new Error("Invalid mnemonic");
					}
					secretKey = keyData;
				}
			}
		} else {
			throw new Error("Invalid key format");
		}

		// Create keyring and derive address
		const keyring = new Keyring({ type: "sr25519", ss58Format: 9 });
		const keyPair = keyring.addFromUri(secretKey);

		console.log(`✅ Successfully loaded key`);
		console.log(`   Address: Dn${keyPair.address}`);

		return {
			address: `Dn${keyPair.address}`,
			publicKey: u8aToHex(keyPair.publicKey),
			hasKeys: true,
		};
	} catch (error) {
		console.error("❌ Error reading keystore:");
		console.error(`   Error: ${error instanceof Error ? error.message : String(error)}`);
		if (error instanceof Error && error.stack) {
			console.error(`   Stack trace: ${error.stack}`);
		}
		console.error(`   Keystore path: ${keystorePath || 'unknown'}`);
		return null;
	}
}

export async function hasValidKeystore(): Promise<boolean> {
	const keystoreInfo = await readKeystoreInfo();
	return keystoreInfo?.hasKeys ?? false;
}

export async function getNodeAddress(): Promise<string | null> {
	const keystoreInfo = await readKeystoreInfo();
	return keystoreInfo?.address ?? null;
}
