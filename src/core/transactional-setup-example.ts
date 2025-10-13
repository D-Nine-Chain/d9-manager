/**
 * Example integration showing how to use TransactionManager with setup operations.
 *
 * This demonstrates wrapping critical setup steps with automatic rollback capability.
 * The actual setup.ts should be refactored to use this pattern.
 */

import { TransactionManager } from './transaction-manager.ts';
import {
  CreateDirectoryOperation,
  CreateUserOperation,
  DownloadFileOperation,
  InstallPackagesOperation,
  CreateServiceFileOperation,
  EnableServiceOperation,
  StartServiceOperation,
} from './system-operations.ts';
import { PATHS, SERVICE } from '../config/constants.ts';

/**
 * Example: Transactional node setup with automatic rollback
 */
export async function transactionalNodeSetup(
  mode: 'legacy' | 'easy' | 'hard',
  nodeType: 'full' | 'validator' | 'archiver',
  nodeName: string,
  osUser: string
): Promise<void> {
  // Define the operations sequence
  const operations = [];

  // Step 1: Create service user (non-legacy mode)
  if (mode !== 'legacy') {
    operations.push(
      new CreateUserOperation('d9-node', {
        system: true,
        noCreateHome: true,
        shell: '/bin/false',
      })
    );
  }

  // Step 2: Install required packages
  operations.push(
    new InstallPackagesOperation(['curl', 'jq', 'wget'])
  );

  // Step 3: Download d9-node binary
  operations.push(
    new DownloadFileOperation(
      'https://github.com/D-Nine-Chain/d9-node/releases/latest/download/d9-node.tar.gz',
      '/tmp/d9-node.tar.gz'
    )
  );

  // Step 4: Create data directory
  const dataDir = mode === 'legacy' ? `/home/${osUser}/node-data` : PATHS.DATA_DIR_NEW;
  const owner = mode === 'legacy' ? `${osUser}:${osUser}` : 'd9-node:d9-node';
  operations.push(
    new CreateDirectoryOperation(dataDir, owner, mode === 'legacy' ? undefined : '750')
  );

  // Step 5: Create systemd service
  const serviceContent = buildServiceContent(mode, nodeType, nodeName, osUser, dataDir);
  operations.push(
    new CreateServiceFileOperation('d9-node', serviceContent, PATHS.SERVICE_FILE)
  );

  // Step 6: Enable service
  operations.push(
    new EnableServiceOperation('d9-node.service')
  );

  // Step 7: Start service
  operations.push(
    new StartServiceOperation('d9-node.service')
  );

  // Create transaction manager
  const txManager = new TransactionManager();

  // Initialize transaction
  await txManager.initialize(operations, {
    mode,
    nodeType,
    configuration: {
      nodeName,
      basePath: dataDir,
      serviceUser: mode === 'legacy' ? osUser : 'd9-node',
    },
  });

  // Execute with automatic rollback on failure
  const result = await txManager.execute();

  if (result.success) {
    console.log('\n✅ Node setup completed successfully!');
    await txManager.clear();
  } else {
    console.error(`\n❌ Setup failed: ${result.error}`);
    if (result.canResume) {
      console.log('\n💡 You can resume the setup later by running the resume command');
    }
    throw new Error(result.error);
  }
}

/**
 * Example: Resume a failed setup
 */
export async function resumeFailedSetup(): Promise<void> {
  const txManager = new TransactionManager();

  const hasState = await txManager.loadExisting();
  if (!hasState) {
    console.log('❌ No existing setup to resume');
    return;
  }

  console.log('🔄 Resuming setup from last checkpoint...');
  txManager.displayProgress();

  const result = await txManager.execute();

  if (result.success) {
    console.log('\n✅ Setup completed successfully!');
    await txManager.clear();
  } else {
    console.error(`\n❌ Setup failed again: ${result.error}`);
    if (result.canResume) {
      console.log('\n💡 You can try resuming again after fixing the issue');
    }
  }
}

/**
 * Helper to build service file content
 */
function buildServiceContent(
  mode: 'legacy' | 'easy' | 'hard',
  nodeType: 'full' | 'validator' | 'archiver',
  nodeName: string,
  osUser: string,
  dataDir: string
): string {
  const user = mode === 'legacy' ? osUser : 'd9-node';
  const workingDir = mode === 'legacy' ? '' : `WorkingDirectory=${dataDir}\n`;

  let execStart = `ExecStart=${PATHS.BINARY} \\
  --base-path ${dataDir} \\
  --chain ${PATHS.CHAIN_SPEC} \\
  --name "${nodeName}" \\
  --port ${SERVICE.PORT}`;

  // Add node type specific flags
  switch (nodeType) {
    case 'validator':
      execStart += ' \\\n  --validator';
      break;
    case 'archiver':
      execStart += ' \\\n  --pruning archive';
      break;
    default: // full
      execStart += ' \\\n  --pruning 1000';
  }

  return `[Unit]
Description=D9 Node
After=network.target

[Service]
Type=simple
User=${user}
${mode === 'legacy' ? '' : 'Group=d9-node\n'}${workingDir}${execStart}

Restart=on-failure

[Install]
WantedBy=multi-user.target
`;
}

/**
 * Example usage in setup.ts:
 *
 * Instead of:
 *   await installD9Node(messages, osInfo, mode);
 *   await configureNode(nodeType, messages, osInfo, mode);
 *
 * Use:
 *   await transactionalNodeSetup(mode, nodeType, nodeName, osInfo.user);
 *
 * This provides:
 * - Automatic rollback on any failure
 * - Progress tracking and state persistence
 * - Ability to resume from failures
 * - Clear audit trail of what succeeded and what failed
 */
