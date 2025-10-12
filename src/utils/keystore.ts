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
		"/home/debian/node-data/chains/d9_main/keystore",  // Debian user
	];

	// Add current user's path if SUDO_USER is set
	const sudoUser = Deno.env.get("SUDO_USER") || Deno.env.get("USER");
	if (sudoUser && sudoUser !== "ubuntu" && sudoUser !== "admin" && sudoUser !== "debian") {
		possiblePaths.push(`/home/${sudoUser}/node-data/chains/d9_main/keystore`);
	}

	console.log("🔍 Searching for keystore in the following locations:");
	possiblePaths.forEach((path, idx) => {
		console.log(`   ${idx + 1}. ${path}`);
	});

	let keystorePath: string | null = null;

	// Find the first existing keystore directory
	for (const path of possiblePaths) {
		try {
			const stat = await Deno.stat(path);
			if (stat.isDirectory) {
				keystorePath = path;
				console.log(`✅ Found keystore at: ${path}`);
				break;
			}
		} catch (error) {
			console.log(`   ❌ Not found: ${path}`);
		}
	}

	if (!keystorePath) {
		console.log("❌ No keystore directory found in any of the expected locations.");
		console.log("💡 Tip: Keystore is created during node setup. Run node setup first.");
		return null;
	}

	try {
		console.log(`\n🔑 Checking for keys in keystore...`);

		// Look for aura key (starts with 61757261)
		const files = [];
		for await (const dirEntry of Deno.readDir(keystorePath)) {
			if (dirEntry.isFile && dirEntry.name.startsWith("61757261")) {
				files.push(dirEntry.name);
			}
		}

		if (files.length === 0) {
			console.log("❌ No aura key found in keystore (expected file starting with '61757261')");
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
