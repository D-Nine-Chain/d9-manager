import { Keyring } from "@polkadot/keyring";
import { u8aToHex, hexToU8a } from "@polkadot/util";
import { mnemonicValidate } from "@polkadot/util-crypto";
import { cryptoWaitReady } from "@polkadot/util-crypto";

export interface KeystoreInfo {
	address: string;
	publicKey: string;
	hasKeys: boolean;
}

export async function readKeystoreInfo(): Promise<KeystoreInfo | null> {
	await cryptoWaitReady();

	// Try multiple possible keystore locations
	const possiblePaths = [
		"/var/lib/d9-node/chains/d9_main/keystore",  // New mode (dedicated user)
		"/home/ubuntu/node-data/chains/d9_main/keystore",  // Ubuntu legacy
		"/home/admin/node-data/chains/d9_main/keystore",   // Debian legacy
	];

	// Add current user's path if SUDO_USER is set
	const sudoUser = Deno.env.get("SUDO_USER") || Deno.env.get("USER");
	if (sudoUser && sudoUser !== "ubuntu" && sudoUser !== "admin") {
		possiblePaths.push(`/home/${sudoUser}/node-data/chains/d9_main/keystore`);
	}

	let keystorePath: string | null = null;

	// Find the first existing keystore directory
	for (const path of possiblePaths) {
		try {
			const stat = await Deno.stat(path);
			if (stat.isDirectory) {
				keystorePath = path;
				break;
			}
		} catch {
			// Path doesn't exist, try next
		}
	}

	if (!keystorePath) {
		return null;
	}

	try {

		// Look for aura key (starts with 61757261)
		const files = [];
		for await (const dirEntry of Deno.readDir(keystorePath)) {
			if (dirEntry.isFile && dirEntry.name.startsWith("61757261")) {
				files.push(dirEntry.name);
			}
		}

		if (files.length === 0) {
			return { address: "", publicKey: "", hasKeys: false };
		}

		// Read the first aura key file
		const keyFilePath = `${keystorePath}/${files[0]}`;
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

		return {
			address: `Dn${keyPair.address}`,
			publicKey: u8aToHex(keyPair.publicKey),
			hasKeys: true,
		};
	} catch (error) {
		console.error(
			"Error reading keystore:",
			error instanceof Error ? error.message : String(error),
		);
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
