/**
 * Refactored setup command using clean architecture.
 *
 * This version uses:
 * - Domain models (InstallationMode, NodeConfiguration)
 * - Service layer (NodeSetupService)
 * - Infrastructure implementations (injected dependencies)
 * - Transaction management (automatic rollback)
 */

import { Select, Confirm, Input } from '@cliffy/prompt';
import { Messages } from '../types.ts';
import { checkDiskSpace, executeCommand } from '../utils/system.ts';
import {
  InstallationMode,
  InstallationModeFactory,
  ModeDetectionContext,
} from '../domain/installation-mode.ts';
import {
  NodeConfiguration,
  NodeConfigurationFactory,
} from '../domain/node-configuration.ts';
import { NodeSetupService } from '../services/node-setup-service.ts';
import { AptPackageManager } from '../infrastructure/package-manager-impl.ts';
import { WgetBinaryDownloader } from '../infrastructure/binary-downloader-impl.ts';
import { PolkadotKeyGenerator } from '../infrastructure/key-generator-impl.ts';
import { PATHS } from '../config/constants.ts';

export async function setupNodeV2(messages: Messages): Promise<void> {
  console.log('\n' + messages.setupNewNode);

  // Step 1: Check system requirements
  console.log('\n🔍 ' + messages.setup.checkingRequirements + '\n');

  const osInfo = await detectOperatingSystem(messages);
  if (!osInfo) {
    return;
  }

  await checkArchitecture(messages);

  // Step 2: Select node type
  const nodeTypeSelection = await selectNodeType(messages);
  if (!nodeTypeSelection) {
    return;
  }

  // Step 3: Check disk space
  const hasSpace = await checkDiskSpaceRequirements(nodeTypeSelection, messages);
  if (!hasSpace) {
    return;
  }

  // Step 4: Configure swap
  console.log('\n🔧 ' + messages.setup.configuringSwap);
  await configureSwap();
  console.log('✅ ' + messages.setup.swapConfigured);

  // Step 5: Detect or select installation mode
  const mode = await selectInstallationMode(osInfo, messages);
  console.log('\n🔧 Installation mode: ' + mode.type);

  // Step 6: Get node name
  const nodeName = await Input.prompt({
    message: 'Enter a name for your node:',
    default: 'D9-Node',
  });

  // Step 7: Create node configuration
  const config = NodeConfigurationFactory.create({
    name: nodeName,
    mode,
    nodeType: nodeTypeSelection,
  });

  // Step 8: Install dependencies
  await installSystemDependencies();

  // Step 9: Download and install binary
  await downloadAndInstallBinary(osInfo);

  // Step 10: Setup node using service layer
  const service = createNodeSetupService();

  try {
    console.log('\n🚀 Starting node setup with transaction management...');
    await service.setupNode(config);
    console.log('✅ Node setup completed successfully');
  } catch (error) {
    console.error(`\n❌ Setup failed: ${error instanceof Error ? error.message : String(error)}`);
    console.log('💡 The system has been rolled back to its previous state');
    return;
  }

  // Step 11: Generate keys
  const generateKeys = await Confirm.prompt('Generate validator keys?');
  if (generateKeys) {
    try {
      // Stop service to insert keys
      console.log('\n⏸️  Stopping service to insert keys...');
      await executeCommand('sudo', ['systemctl', 'stop', 'd9-node.service']);

      await service.generateKeys(config);

      // Restart service
      console.log('\n🚀 Starting service...');
      await executeCommand('sudo', ['systemctl', 'start', 'd9-node.service']);
      console.log('✅ Service started');
    } catch (error) {
      console.error(`\n❌ Key generation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Step 12: Show logs
  console.log('\n📋 Node is starting up. Here are the recent logs:');
  console.log('──────────────────────────────────────────────────');
  console.log('Press Ctrl+C to stop viewing logs\n');

  const journalProcess = new Deno.Command('sudo', {
    args: ['journalctl', '-u', 'd9-node', '-f', '-n', '100'],
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });

  await journalProcess.spawn().status;
}

/**
 * Detect operating system
 */
async function detectOperatingSystem(
  messages: Messages
): Promise<{ type: 'ubuntu' | 'debian'; user: string } | null> {
  try {
    const osReleaseContent = await Deno.readTextFile('/etc/os-release');
    const isUbuntu = osReleaseContent.includes('ID=ubuntu');
    const isDebian = osReleaseContent.includes('ID=debian');
    const isUbuntu2204 = osReleaseContent.includes('VERSION_ID="22.04"');

    const debianVersionMatch = osReleaseContent.match(/VERSION_ID="(\d+)"/);
    const debianVersion = debianVersionMatch ? parseInt(debianVersionMatch[1]) : null;

    if (isUbuntu && isUbuntu2204) {
      console.log('✅ ' + messages.setup.ubuntu2204);
      return { type: 'ubuntu', user: 'ubuntu' };
    } else if (isDebian && debianVersion && debianVersion >= 11) {
      const versionLabel =
        debianVersion === 12 ? messages.setup.debian12 : `Debian ${debianVersion}`;
      console.log('✅ ' + versionLabel);
      return {
        type: 'debian',
        user: Deno.env.get('SUDO_USER') || Deno.env.get('USER') || 'debian',
      };
    } else if (isDebian && !debianVersionMatch) {
      console.log('✅ Debian (testing/unstable)');
      return {
        type: 'debian',
        user: Deno.env.get('SUDO_USER') || Deno.env.get('USER') || 'debian',
      };
    } else {
      console.log('❌ ' + messages.setup.osIncompatible);
      return null;
    }
  } catch {
    console.log('❌ ' + messages.setup.osIncompatible);
    return null;
  }
}

/**
 * Check architecture
 */
async function checkArchitecture(messages: Messages): Promise<void> {
  const archResult = await executeCommand('uname', ['-m']);
  if (!archResult.success || archResult.output.trim() !== 'x86_64') {
    console.log('❌ ' + messages.setup.archIncompatible);
    console.log(
      'Please use: curl -sSf https://raw.githubusercontent.com/D-Nine-Chain/d9-node/main/scripts/build-node.sh | bash'
    );
    throw new Error('Incompatible architecture');
  }
  console.log('✅ ' + messages.setup.archCompatible);
}

/**
 * Select node type
 */
async function selectNodeType(
  messages: Messages
): Promise<'full' | 'validator' | 'archiver' | null> {
  const nodeType = await Select.prompt<'full' | 'validator' | 'archiver'>({
    message: messages.setup.selectNodeType,
    options: [
      {
        name: `${messages.nodeTypes.full.name} - ${messages.nodeTypes.full.requirements}`,
        value: 'full' as const,
      },
      {
        name: `${messages.nodeTypes.validator.name} - ${messages.nodeTypes.validator.requirements}`,
        value: 'validator' as const,
      },
      {
        name: `${messages.nodeTypes.archiver.name} - ${messages.nodeTypes.archiver.requirements}`,
        value: 'archiver' as const,
      },
    ],
  });

  const selectedType = messages.nodeTypes[nodeType as keyof typeof messages.nodeTypes];
  console.log(`\n📋 ${selectedType.name}`);
  console.log(`${selectedType.description}`);
  console.log(`${selectedType.requirements}\n`);

  const proceed = await Confirm.prompt(messages.setup.continueWithNodeType);
  return proceed ? (nodeType as 'full' | 'validator' | 'archiver') : null;
}

/**
 * Check disk space requirements
 */
async function checkDiskSpaceRequirements(
  nodeType: 'full' | 'validator' | 'archiver',
  messages: Messages
): Promise<boolean> {
  const requiredSpace = nodeType === 'archiver' ? 120 : 60;
  console.log('\n💾 ' + messages.setup.currentDiskUsage);
  await executeCommand('df', ['-h', '/']);
  console.log(`\n${messages.setup.requiredSpace} ${requiredSpace}GB`);

  const hasSpace = await checkDiskSpace(requiredSpace);
  if (!hasSpace) {
    console.log(
      '\n❌ ' +
        messages.setup.insufficientDiskSpace.replace('%s', requiredSpace.toString())
    );
    return false;
  }
  console.log('✅ ' + messages.setup.sufficientDiskSpace);
  return true;
}

/**
 * Configure swap file
 */
async function configureSwap(): Promise<void> {
  await executeCommand('sudo', ['swapoff', '-a']);

  try {
    await Deno.stat('/swapfile');
    await executeCommand('sudo', ['rm', '/swapfile']);
  } catch {
    // Swapfile doesn't exist
  }

  await executeCommand('sudo', ['fallocate', '-l', '1G', '/swapfile']);
  await executeCommand('sudo', ['chmod', '600', '/swapfile']);
  await executeCommand('sudo', ['mkswap', '/swapfile']);
  await executeCommand('sudo', ['swapon', '/swapfile']);

  const fstabContent = await Deno.readTextFile('/etc/fstab');
  const fstabWithoutSwap = fstabContent
    .split('\n')
    .filter((line) => !line.includes('/swapfile'))
    .join('\n');
  await Deno.writeTextFile(
    '/tmp/fstab.tmp',
    fstabWithoutSwap + '\n/swapfile none swap sw 0 0\n'
  );
  await executeCommand('sudo', ['mv', '/tmp/fstab.tmp', '/etc/fstab']);
}

/**
 * Detect or select installation mode
 */
async function selectInstallationMode(
  osInfo: { type: 'ubuntu' | 'debian'; user: string },
  messages: Messages
): Promise<InstallationMode> {
  const context: ModeDetectionContext = {
    osType: osInfo.type,
    osUser: osInfo.user,
    hasExistingLegacyInstallation: await checkLegacyInstallation(),
  };

  if (context.hasExistingLegacyInstallation) {
    console.log('🔍 ' + messages.setup.existingInstallation);
    return InstallationModeFactory.detect(context);
  }

  const modeSelection = await Select.prompt<'easy' | 'hard' | 'legacy'>({
    message: messages.setup.selectSecurityMode,
    options: [
      { name: messages.setup.securityModes.easy, value: 'easy' as const },
      { name: messages.setup.securityModes.advanced, value: 'hard' as const },
      { name: messages.setup.securityModes.legacy, value: 'legacy' as const },
    ],
  });

  return InstallationModeFactory.fromSelection(modeSelection as 'easy' | 'hard' | 'legacy', osInfo.user);
}

/**
 * Check for legacy installation
 */
async function checkLegacyInstallation(): Promise<boolean> {
  const legacyPaths = ['/home/ubuntu/node-data', '/home/debian/node-data'];

  for (const path of legacyPaths) {
    try {
      await Deno.stat(path);
      return true;
    } catch {
      continue;
    }
  }

  const serviceResult = await executeCommand('systemctl', ['is-enabled', 'd9-node.service']);
  if (serviceResult.success) {
    const serviceContent = await Deno.readTextFile('/etc/systemd/system/d9-node.service').catch(
      () => ''
    );
    if (serviceContent.includes('User=ubuntu') || serviceContent.includes('User=debian')) {
      return true;
    }
  }

  return false;
}

/**
 * Install system dependencies
 */
async function installSystemDependencies(): Promise<void> {
  console.log('\n📦 Installing system dependencies...');

  const packageManager = new AptPackageManager();

  console.log('Updating package lists...');
  await packageManager.update();

  console.log('Installing required packages...');
  await packageManager.install(['curl', 'jq', 'wget']);

  console.log('✅ Dependencies installed');
}

/**
 * Download and install D9 binary
 */
async function downloadAndInstallBinary(osInfo: {
  type: 'ubuntu' | 'debian';
  user: string;
}): Promise<void> {
  console.log('\n🚀 Downloading D9 node binary...');

  // Check GLIBC version
  console.log('🔍 Checking GLIBC version...');
  const glibcResult = await executeCommand('ldd', ['--version']);
  if (!glibcResult.success) {
    throw new Error('Failed to check GLIBC version');
  }

  const versionMatch = glibcResult.output.match(/([0-9]+\.[0-9]+)$/m);
  if (!versionMatch) {
    throw new Error('Could not parse GLIBC version');
  }

  const glibcVersion = versionMatch[1];
  const [major, minor] = glibcVersion.split('.').map(Number);

  console.log(`Current GLIBC version: ${glibcVersion}`);
  console.log('Required GLIBC version: 2.38 or higher');

  if (major < 2 || (major === 2 && minor < 38)) {
    console.log('\n⚠️  GLIBC version is incompatible');
    console.log('🔧 Attempting to upgrade GLIBC...');
    await upgradeGlibc(osInfo);
    console.log('✅ GLIBC successfully upgraded');
  } else {
    console.log('✅ GLIBC is compatible');
  }

  // Download binary
  const downloader = new WgetBinaryDownloader();

  // Fetch release info
  console.log('\n🌐 Fetching latest release...');
  const releaseResult = await executeCommand('curl', [
    '-s',
    'https://api.github.com/repos/D-Nine-Chain/d9-node/releases/latest',
  ]);

  if (!releaseResult.success) {
    throw new Error('Failed to fetch release information');
  }

  const release = JSON.parse(releaseResult.output);
  if (release.message && release.message.includes('rate limit')) {
    throw new Error('GitHub API rate limit exceeded');
  }

  const tarballAsset = release.assets?.find((asset: any) => asset.name.endsWith('.tar.gz'));
  const hashAsset = release.assets?.find((asset: any) => asset.name.endsWith('.sha256'));

  if (!tarballAsset || !hashAsset) {
    throw new Error('Could not find download URLs');
  }

  // Download files
  await downloader.download(tarballAsset.browser_download_url, '/tmp/d9-node.tar.gz');
  await downloader.download(hashAsset.browser_download_url, '/tmp/d9-node.tar.gz.sha256');

  // Fix checksum format
  const checksumContent = await Deno.readTextFile('/tmp/d9-node.tar.gz.sha256');
  const checksumHash = checksumContent.trim().split(/\s+/)[0];
  await Deno.writeTextFile('/tmp/d9-node.tar.gz.sha256', `${checksumHash}  d9-node.tar.gz\n`);

  // Verify
  const expectedHashResult = await executeCommand('cat', ['/tmp/d9-node.tar.gz.sha256']);
  const expectedHash = expectedHashResult.output.trim().split(/\s+/)[0];

  const verified = await downloader.verify('/tmp/d9-node.tar.gz', expectedHash);
  if (!verified) {
    throw new Error('File integrity verification failed');
  }

  // Extract and install
  console.log('\n📦 Extracting binary...');
  await executeCommand('tar', ['-xzf', '/tmp/d9-node.tar.gz', '-C', '/tmp']);
  console.log('✅ Binary extracted');

  console.log('🔧 Installing binary...');
  await executeCommand('sudo', ['mv', '/tmp/d9-node', PATHS.BINARY]);
  await executeCommand('sudo', ['chown', 'root:root', PATHS.BINARY]);
  await executeCommand('sudo', ['chmod', '755', PATHS.BINARY]);

  // Download chain spec
  console.log('\n📥 Downloading chain specification...');
  await downloader.download(
    'https://raw.githubusercontent.com/D-Nine-Chain/d9-node/main/new-main-spec.json',
    '/tmp/new-main-spec.json'
  );
  await executeCommand('sudo', ['mv', '/tmp/new-main-spec.json', PATHS.CHAIN_SPEC]);
  await executeCommand('sudo', ['chown', 'root:root', PATHS.CHAIN_SPEC]);
  await executeCommand('sudo', ['chmod', '644', PATHS.CHAIN_SPEC]);

  console.log('✅ D9 node binary installed successfully');

  // Cleanup
  await executeCommand('rm', ['-f', '/tmp/d9-node.tar.gz', '/tmp/d9-node.tar.gz.sha256']);
}

/**
 * Upgrade GLIBC
 */
async function upgradeGlibc(osInfo: { type: 'ubuntu' | 'debian'; user: string }): Promise<void> {
  await executeCommand('sudo', ['cp', '/etc/apt/sources.list', '/etc/apt/sources.list.d9backup']);

  const repoFile = osInfo.type === 'ubuntu' ? 'noble.list' : 'testing.list';
  const repoPath = `/etc/apt/sources.list.d/${repoFile}`;
  const prefPath = '/etc/apt/preferences.d/libc6';

  try {
    if (osInfo.type === 'ubuntu') {
      const nobleRepoContent = 'deb http://archive.ubuntu.com/ubuntu noble main\n';
      await Deno.writeTextFile('/tmp/noble.list', nobleRepoContent);
      await executeCommand('sudo', ['mv', '/tmp/noble.list', repoPath]);
    } else {
      const testingRepoContent = 'deb http://deb.debian.org/debian testing main\n';
      await Deno.writeTextFile('/tmp/testing.list', testingRepoContent);
      await executeCommand('sudo', ['mv', '/tmp/testing.list', repoPath]);

      const pinContent = `Package: *
Pin: release a=stable
Pin-Priority: 700

Package: libc6 libc6-dev libc6-i386 libc-bin libc-dev-bin libc-l10n locales
Pin: release a=testing
Pin-Priority: 900
`;
      await Deno.writeTextFile('/tmp/preferences', pinContent);
      await executeCommand('sudo', ['mv', '/tmp/preferences', prefPath]);
    }

    await executeCommand('sudo', ['apt', 'update', '-qq']);

    const packages =
      osInfo.type === 'ubuntu'
        ? ['libc6', 'libc6-dev', 'libc-bin', 'libc-dev-bin']
        : ['libc6', 'libc6-dev', 'libc6-i386', 'libc-bin', 'libc-dev-bin', 'libc-l10n', 'locales'];

    await executeCommand('sudo', [
      'apt',
      'install',
      '-y',
      '-qq',
      ...(osInfo.type === 'debian' ? ['-t', 'testing'] : []),
      ...packages,
    ]);

    // Cleanup
    await executeCommand('sudo', ['rm', '-f', repoPath]);
    if (osInfo.type === 'debian') {
      await executeCommand('sudo', ['rm', '-f', prefPath]);
    }
    await executeCommand('sudo', ['apt', 'update', '-qq']);
  } catch (error) {
    await executeCommand('sudo', ['rm', '-f', repoPath]);
    if (osInfo.type === 'debian') {
      await executeCommand('sudo', ['rm', '-f', prefPath]);
    }
    await executeCommand('sudo', ['apt', 'update', '-qq']);
    throw error;
  }
}

/**
 * Create node setup service with injected dependencies
 */
function createNodeSetupService(): NodeSetupService {
  return new NodeSetupService({
    packageManager: new AptPackageManager(),
    binaryDownloader: new WgetBinaryDownloader(),
    keyGenerator: new PolkadotKeyGenerator(),
  });
}
