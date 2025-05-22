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

	const keystorePath = "/home/ubuntu/node-data/chains/d9_main/keystore";

	try {
		// Check if keystore directory exists
		const keystoreDir = await Deno.stat(keystorePath);
		if (!keystoreDir.isDirectory) {
			return null;
		}

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
			// Hex key
			secretKey = keyData;
		} else if (keyData.includes(" ")) {
			// Mnemonic
			if (!mnemonicValidate(keyData)) {
				throw new Error("Invalid mnemonic");
			}
			secretKey = keyData;
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
