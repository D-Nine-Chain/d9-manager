/**
 * Resume command for continuing failed installations.
 *
 * Checks for existing installation state and allows resuming from the last
 * successful checkpoint.
 */

import { InstallationStateManager } from '../core/state-manager.ts';
import { Confirm } from '@cliffy/prompt';
import { Messages } from '../types.ts';

/**
 * Check if there's a resumable installation
 */
export async function hasResumableInstallation(messages: Messages): Promise<boolean> {
  const stateManager = new InstallationStateManager(messages);
  const state = await stateManager.loadState();

  if (!state) {
    return false;
  }

  return stateManager.canResume();
}

/**
 * Display resumable installation info and prompt user
 */
export async function promptResume(messages: Messages): Promise<boolean> {
  const stateManager = new InstallationStateManager(messages);
  const state = await stateManager.loadState();

  if (!state) {
    return false;
  }

  console.log('\n⚠️  Found incomplete installation from previous session');
  console.log('═'.repeat(50));

  // Display progress
  stateManager.displayProgress();

  // Ask if user wants to resume
  const shouldResume = await Confirm.prompt({
    message: 'Would you like to resume this installation?',
    default: true
  });

  return shouldResume;
}

/**
 * Clear abandoned installation state
 */
export async function clearAbandonedInstallation(messages: Messages): Promise<void> {
  const stateManager = new InstallationStateManager(messages);
  const state = await stateManager.loadState();

  if (!state) {
    console.log('No installation state to clear');
    return;
  }

  console.log('\n🗑️  Clearing abandoned installation state...');
  stateManager.displayProgress();

  const confirm = await Confirm.prompt({
    message: 'Are you sure you want to discard this installation progress?',
    default: false
  });

  if (confirm) {
    await stateManager.clearState();
    console.log('✅ Installation state cleared');
  } else {
    console.log('❌ Cancelled');
  }
}

/**
 * Display installation state information
 */
export async function showInstallationState(messages: Messages): Promise<void> {
  const stateManager = new InstallationStateManager(messages);
  const state = await stateManager.loadState();

  if (!state) {
    console.log('\n✅ No active installation state');
    return;
  }

  console.log('\n📊 Installation State');
  stateManager.displayProgress();

  if (stateManager.canResume()) {
    console.log('\n💡 You can resume this installation from the main menu');
  } else {
    console.log('\n✅ Installation appears to be complete');
    console.log('💡 You can clear this state with the clear command');
  }
}
