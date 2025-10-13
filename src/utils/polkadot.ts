import { ApiPromise, WsProvider } from '@polkadot/api';
import { Keyring } from '@polkadot/keyring';
import { NodeMetadataStruct } from '../types.ts';
import { readKeystoreInfo, findKeystorePath } from './keystore.ts';
import { NETWORK, KEY_TYPES } from '../config/constants.ts';

class D9ChainAPI {
  private api: ApiPromise | null = null;
  private keyring: Keyring;
  private keyPair: any = null;

  constructor() {
    this.keyring = new Keyring({ type: 'sr25519', ss58Format: 9 });
  }

  async connect(): Promise<void> {
    if (this.api) {
      return;
    }

    try {
      const provider = new WsProvider(NETWORK.ENDPOINT);
      this.api = await ApiPromise.create({ provider });
      await this.api.isReady;
    } catch (error) {
      throw new Error(`Failed to connect to D9 network: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async disconnect(): Promise<void> {
    if (this.api) {
      await this.api.disconnect();
      this.api = null;
    }
  }

  async loadKeyPair(): Promise<{ success: boolean; address?: string; error?: string }> {
    try {
      const keystoreInfo = await readKeystoreInfo();
      if (!keystoreInfo?.hasKeys) {
        return { success: false, error: 'No valid keystore found' };
      }

      // Get the secret key for signing - use the same path resolution as readKeystoreInfo
      const keystorePath = await findKeystorePath({ verbose: false });
      if (!keystorePath) {
        return { success: false, error: 'Keystore directory not found' };
      }

      const files = [];
      for await (const dirEntry of Deno.readDir(keystorePath)) {
        if (dirEntry.isFile && dirEntry.name.startsWith(KEY_TYPES.AURA.prefix)) {
          files.push(dirEntry.name);
        }
      }

      if (files.length === 0) {
        return { success: false, error: 'Aura key not found' };
      }

      const keyFilePath = `${keystorePath}/${files[0]}`;
      let keyData = await Deno.readTextFile(keyFilePath);

      // Remove quotes if present (key files often have quotes around the actual key)
      keyData = keyData.trim();
      if ((keyData.startsWith('"') && keyData.endsWith('"')) ||
          (keyData.startsWith("'") && keyData.endsWith("'"))) {
        keyData = keyData.slice(1, -1);
      }

      this.keyPair = this.keyring.addFromUri(keyData);

      return {
        success: true,
        address: `Dn${this.keyPair.address}`
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async getBalance(address: string): Promise<{ free: string; reserved: string; total: string }> {
    await this.connect();
    
    // Remove Dn prefix if present for balance lookup
    const cleanAddress = address.startsWith('Dn') ? address.slice(2) : address;
    
    const accountInfo = await this.api!.query.system.account(cleanAddress);
    const balance = (accountInfo as any).data;

    return {
      free: balance.free.toString(),
      reserved: balance.reserved.toString(),
      total: balance.free.add(balance.reserved).toString()
    };
  }

  async submitCandidacy(metadata: NodeMetadataStruct): Promise<{ success: boolean; hash?: string; error?: string }> {
    await this.connect();

    try {
      if (!this.keyPair) {
        const keyResult = await this.loadKeyPair();
        if (!keyResult.success) {
          return { success: false, error: keyResult.error };
        }
      }

      // Create the extrinsic
      const extrinsic = this.api!.tx.d9NodeVoting.submitCandidacy({
        name: Array.from(new TextEncoder().encode(metadata.name)),
        sharing_percent: metadata.sharing_percent,
        index_of_last_percent_change: metadata.index_of_last_percent_change
      });

      // Submit the transaction
      return new Promise((resolve) => {
        let unsubscribe: () => void;

        extrinsic.signAndSend(this.keyPair, ({ status, events }: any) => {
          if (status.isInBlock || status.isFinalized) {
            // Check for errors in events
            const errorEvent = events.find(({ event }: any) => 
              this.api!.events.system.ExtrinsicFailed.is(event)
            );

            if (errorEvent) {
              const [dispatchError] = errorEvent.event.data;
              let errorMessage = 'Transaction failed';

              if ((dispatchError as any).isModule) {
                try {
                  const decoded = this.api!.registry.findMetaError((dispatchError as any).asModule);
                  errorMessage = `${decoded.section}.${decoded.name}: ${decoded.docs.join(' ')}`;
                } catch {
                  errorMessage = 'Unknown module error';
                }
              }

              resolve({ success: false, error: errorMessage });
            } else {
              resolve({ success: true, hash: status.asInBlock?.toString() || status.asFinalized?.toString() });
            }

            if (unsubscribe) unsubscribe();
          }
        }).then((unsub) => {
          unsubscribe = unsub;
        }).catch((error) => {
          resolve({ success: false, error: error.message });
        });
      });

    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async checkCandidacyStatus(address: string): Promise<{ isCandidate: boolean; metadata?: any }> {
    await this.connect();

    try {
      // Remove Dn prefix if present
      const cleanAddress = address.startsWith('Dn') ? address.slice(2) : address;
      
      const votes = await this.api!.query.d9NodeVoting.nodeAccumulativeVotes(cleanAddress);
      
      // If votes is null or not a number, they're not a candidate
      // If votes exists (is a number), they already have candidacy
      const isCandidate = votes && !votes.isEmpty;
      
      return {
        isCandidate,
        metadata: isCandidate ? votes.toJSON() : undefined
      };
    } catch (error) {
      console.error('Error checking candidacy status:', error);
      return { isCandidate: false };
    }
  }
}

// Singleton instance
let apiInstance: D9ChainAPI | null = null;

export function getD9API(): D9ChainAPI {
  if (!apiInstance) {
    apiInstance = new D9ChainAPI();
  }
  return apiInstance;
}

export async function disconnectD9API(): Promise<void> {
  if (apiInstance) {
    await apiInstance.disconnect();
    apiInstance = null;
  }
}

export async function loadNodeKey(): Promise<{ success: boolean; address?: string; error?: string }> {
  const api = getD9API();
  return await api.loadKeyPair();
}