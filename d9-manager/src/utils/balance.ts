import { Input } from '@cliffy/prompt';
import { getD9API } from './polkadot.ts';
import { createProgressBar } from './system.ts';

export function formatBalance(balance: string): string {
  // Convert from smallest unit to D9 (assuming 12 decimals like DOT)
  const balanceNum = BigInt(balance);
  const decimals = BigInt(10 ** 12);
  const wholePart = balanceNum / decimals;
  const fractionalPart = balanceNum % decimals;
  
  if (fractionalPart === BigInt(0)) {
    return wholePart.toString();
  }
  
  const fractionalStr = fractionalPart.toString().padStart(12, '0').replace(/0+$/, '');
  return `${wholePart}.${fractionalStr}`;
}

export async function checkBalanceWithPrompt(address: string): Promise<{ balance: string; isEmpty: boolean }> {
  const api = getD9API();
  
  try {
    const balance = await api.getBalance(address);
    const formattedBalance = formatBalance(balance.free);
    const isEmpty = BigInt(balance.free) === BigInt(0);
    
    console.log(`💰 Balance: ${formattedBalance} D9`);
    
    if (isEmpty) {
      console.log(`\n⚠️  Your account balance is empty.`);
      console.log(`Please send D9 tokens to: ${address}`);
      console.log(`Press Enter after sending money to this address so we can check again...`);
      
      await Input.prompt({ message: "" });
      
      // Wait 3 seconds while checking balance
      await createProgressBar(3000, 'Checking balance...');
      
      // Check balance again
      const newBalance = await api.getBalance(address);
      const newFormattedBalance = formatBalance(newBalance.free);
      const stillEmpty = BigInt(newBalance.free) === BigInt(0);
      
      console.log(`💰 Updated Balance: ${newFormattedBalance} D9`);
      
      if (stillEmpty) {
        console.log(`⚠️  Balance is still empty. Please make sure the transaction has been confirmed.`);
      } else {
        console.log(`✅ Balance received!`);
      }
      
      return { balance: newFormattedBalance, isEmpty: stillEmpty };
    }
    
    return { balance: formattedBalance, isEmpty: false };
    
  } catch (error) {
    console.log(`⚠️  Could not check balance: ${error instanceof Error ? error.message : String(error)}`);
    return { balance: '0', isEmpty: true };
  }
}