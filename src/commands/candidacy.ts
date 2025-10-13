import { Input, Confirm } from '@cliffy/prompt';
import { Messages, NodeMetadataStruct } from '../types.ts';
import { getD9API } from '../utils/polkadot.ts';
import { getNodeAddress } from '../utils/keystore.ts';
import { createProgressBar } from '../utils/system.ts';
import { checkBalanceWithPrompt } from '../utils/balance.ts';
import { PATHS, SERVICE } from '../config/constants.ts';

export async function submitCandidacy(messages: Messages): Promise<void> {
  console.log('\n' + messages.submitCandidacy);
  
  // Check if validator node is properly configured
  const isValidatorReady = await checkValidatorConfiguration();
  if (!isValidatorReady) {
    const convert = await Confirm.prompt('Node is not configured as validator. Convert now?');
    if (convert) {
      await convertToValidator();
    } else {
      return;
    }
  }

  // Get node address
  const nodeAddress = await getNodeAddress();
  if (!nodeAddress) {
    console.log(`❌ ${messages.errors.keyNotFound}`);
    return;
  }

  console.log(`\n🔗 Node Address: ${nodeAddress}`);

  // Check balance
  const api = getD9API();
  try {
    await createProgressBar(2000, messages.checkingBalance);
    
    const balanceResult = await checkBalanceWithPrompt(nodeAddress);
    
    if (balanceResult.isEmpty) {
      console.log('❌ Cannot submit candidacy with empty balance');
      return;
    }
    
    // Check if already a candidate
    const candidacyStatus = await api.checkCandidacyStatus(nodeAddress);
    if (candidacyStatus.isCandidate) {
      console.log('ℹ️  You are already a validator candidate');
      console.log('Current metadata:', candidacyStatus.metadata);
      return;
    }

    // Collect candidacy information
    const nodeName = await Input.prompt({
      message: messages.candidacyForm.namePrompt,
      hint: messages.candidacyForm.nameNote
    });

    if (!nodeName || nodeName.length === 0) {
      console.log('❌ Node name is required');
      return;
    }

    if (nodeName.length > 128) {
      console.log('❌ Node name must be 128 characters or less');
      return;
    }

    // Create metadata structure
    const metadata: NodeMetadataStruct = {
      name: nodeName,
      sharing_percent: 0,
      index_of_last_percent_change: 0
    };

    // Show confirmation
    console.log('\n📋 Candidacy Information:');
    console.log(`Name: ${metadata.name}`);
    console.log(`Sharing Percent: ${metadata.sharing_percent}%`);
    console.log(`Address: ${nodeAddress}`);

    const confirm = await Confirm.prompt(messages.candidacyForm.confirmSubmission);
    if (!confirm) {
      return;
    }

    // Submit candidacy
    console.log('\n🚀 Submitting candidacy...');
    const result = await api.submitCandidacy(metadata);

    if (result.success) {
      console.log('✅ Candidacy submitted successfully!');
      if (result.hash) {
        console.log(`Transaction hash: ${result.hash}`);
      }
      console.log('\n🗳️  Your node is now a validator candidate.');
      console.log('Other validators need to vote for you to become an active validator.');
      console.log('Only the top 27 voted nodes can be active validators.');
    } else {
      console.log(`❌ Failed to submit candidacy: ${result.error}`);
      
      // Handle specific errors
      if (result.error?.includes('insufficient')) {
        console.log(`💡 ${messages.errors.insufficientFunds}`);
      }
    }

  } catch (error) {
    console.log(`❌ ${messages.errors.networkError}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function checkValidatorConfiguration(): Promise<boolean> {
  try {
    // Check if service file has validator flag
    const serviceContent = await Deno.readTextFile(PATHS.SERVICE_FILE);
    return serviceContent.includes('--validator');
  } catch {
    return false;
  }
}

async function convertToValidator(): Promise<void> {
  await createProgressBar(2000, 'Converting to validator node...');

  try {
    // Stop the service
    const stopResult = await new Deno.Command('sudo', {
      args: ['systemctl', 'stop', SERVICE.NAME]
    }).output();

    if (stopResult.code !== 0) {
      throw new Error('Failed to stop node service');
    }

    // Read current service file
    const serviceContent = await Deno.readTextFile(PATHS.SERVICE_FILE);

    // Remove any RPC/WebSocket flags and add validator flag
    let newServiceContent = serviceContent
      .replace(/\s*--ws-external\s*\\?\s*/g, ' ')
      .replace(/\s*--rpc-external\s*\\?\s*/g, ' ')
      .replace(/\s*--rpc-cors\s+all\s*\\?\s*/g, ' ')
      .replace(/\s*--ws-max-connections\s+\d+\s*\\?\s*/g, ' ');

    // Add validator flag if not present
    if (!newServiceContent.includes('--validator')) {
      newServiceContent = newServiceContent.replace(
        `--port ${SERVICE.PORT}`,
        `--port ${SERVICE.PORT} \\\n  --validator`
      );
    }

    // Write updated service file
    const tempServiceFile = '/tmp/d9-node.service';
    await Deno.writeTextFile(tempServiceFile, newServiceContent);
    const moveResult = await new Deno.Command('sudo', {
      args: ['mv', tempServiceFile, PATHS.SERVICE_FILE]
    }).output();

    if (moveResult.code !== 0) {
      throw new Error('Failed to update service file');
    }

    // Reload systemd and start service
    await new Deno.Command('sudo', { args: ['systemctl', 'daemon-reload'] }).output();

    const startResult = await new Deno.Command('sudo', {
      args: ['systemctl', 'start', SERVICE.NAME]
    }).output();

    if (startResult.code !== 0) {
      throw new Error('Failed to start node service');
    }

    console.log('✅ Node converted to validator configuration');

    // Wait a moment for the node to start
    await new Promise(resolve => setTimeout(resolve, 3000));

  } catch (error) {
    console.log(`❌ Failed to convert node: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

