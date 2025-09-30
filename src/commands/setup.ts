import { Select, Confirm, Input } from '@cliffy/prompt';
import { NodeType, Messages } from '../types.ts';
import { checkDiskSpace, executeCommand, createProgressBar, systemctl, showProgress } from '../utils/system.ts';
import { Keyring } from '@polkadot/keyring';
import { cryptoWaitReady, mnemonicGenerate, mnemonicValidate, randomAsHex } from '@polkadot/util-crypto';
import { u8aToHex } from '@polkadot/util';
import { randomBytes, pbkdf2, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const pbkdf2Async = promisify(pbkdf2);

type InstallMode = 'hard';

export async function setupNode(messages: Messages): Promise<void> {
      console.log('\n' + messages.setupNewNode);

      // Check system requirements first
      console.log('\n🔍 ' + messages.setup.checkingRequirements + '\n');

      // Check OS compatibility (Ubuntu 22.04 or Debian 12)
      let osInfo: { type: 'ubuntu' | 'debian'; user: string } | null = null;

      try {
            const osReleaseContent = await Deno.readTextFile('/etc/os-release');
            const isUbuntu = osReleaseContent.includes('ID=ubuntu');
            const isDebian = osReleaseContent.includes('ID=debian');
            const isUbuntu2204 = osReleaseContent.includes('VERSION_ID="22.04"');
            const isDebian12 = osReleaseContent.includes('VERSION_ID="12"');

            if (isUbuntu && isUbuntu2204) {
                  console.log('✅ Ubuntu 22.04');
                  osInfo = { type: 'ubuntu', user: 'ubuntu' };
            } else if (isDebian && isDebian12) {
                  console.log('✅ Debian 12');
                  osInfo = { type: 'debian', user: Deno.env.get('SUDO_USER') || Deno.env.get('USER') || 'debian' };
            } else {
                  console.log('❌ ' + messages.setup.osIncompatible);
                  return;
            }
      } catch {
            console.log('❌ ' + messages.setup.osIncompatible);
            return;
      }

      // Check architecture
      const archResult = await executeCommand('uname', ['-m']);
      if (!archResult.success || archResult.output.trim() !== 'x86_64') {
            console.log('❌ ' + messages.setup.archIncompatible);
            console.log('Please use: curl -sSf https://raw.githubusercontent.com/D-Nine-Chain/d9-node/main/scripts/build-node.sh | bash');
            return;
      }
      console.log('✅ ' + messages.setup.archCompatible);

      // Node type selection
      const nodeType = await Select.prompt<NodeType>({
            message: messages.setup.selectNodeType,
            options: [
                  {
                        name: `${messages.nodeTypes.full.name} - ${messages.nodeTypes.full.requirements}`,
                        value: NodeType.FULL
                  },
                  {
                        name: `${messages.nodeTypes.validator.name} - ${messages.nodeTypes.validator.requirements}`,
                        value: NodeType.VALIDATOR
                  },
                  {
                        name: `${messages.nodeTypes.archiver.name} - ${messages.nodeTypes.archiver.requirements}`,
                        value: NodeType.ARCHIVER
                  }
            ]
      });

      // Show detailed description
      const selectedType = messages.nodeTypes[nodeType as keyof typeof messages.nodeTypes];
      console.log(`\n📋 ${selectedType.name}`);
      console.log(`${selectedType.description}`);
      console.log(`${selectedType.requirements}\n`);

      const proceed = await Confirm.prompt(messages.setup.continueWithNodeType);
      if (!proceed) {
            return;
      }

      // Check disk space requirements
      const requiredSpace = nodeType === NodeType.ARCHIVER ? 120 : 60;
      console.log('\n💾 ' + messages.setup.currentDiskUsage);
      await executeCommand('df', ['-h', '/']);
      console.log(`\n${messages.setup.requiredSpace} ${requiredSpace}GB`);

      const hasSpace = await checkDiskSpace(requiredSpace);
      if (!hasSpace) {
            console.log(`\n❌ ` + messages.setup.insufficientDiskSpace.replace('%s', requiredSpace.toString()));
            return;
      }
      console.log('✅ ' + messages.setup.sufficientDiskSpace);

      // Configure swap file
      console.log('\n🔧 ' + messages.setup.configuringSwap);
      await configureSwap();
      console.log('✅ ' + messages.setup.swapConfigured);

      // Always use hard mode for new installations
      const mode: InstallMode = 'hard';
      console.log('\n🔐 ' + messages.setup.advancedKeyGeneration);

      // Create dedicated service user
      await createServiceUser(messages);

      // Install node if not present
      await installD9Node(messages, osInfo, mode);

      // Configure node
      await configureNode(nodeType as NodeType, messages, osInfo);
}


async function createServiceUser(messages: Messages): Promise<void> {
      console.log('👤 ' + messages.setup.creatingServiceUser);

      // Check if user already exists
      const userCheckResult = await executeCommand('id', ['d9-node']);
      if (userCheckResult.success) {
            console.log('✅ ' + messages.setup.serviceUserExists);
            return;
      }

      // Create system user
      await executeCommand('sudo', ['useradd', '--system', '--no-create-home', '--shell', '/bin/false', 'd9-node']);
      console.log('✅ ' + messages.setup.serviceUserCreated);
}

async function configureSwap(): Promise<void> {
      // Turn off any existing swap
      await executeCommand('sudo', ['swapoff', '-a']);

      // Remove existing swapfile if present
      try {
            await Deno.stat('/swapfile');
            await executeCommand('sudo', ['rm', '/swapfile']);
      } catch {
            // Swapfile doesn't exist, that's fine
      }

      // Create new swapfile
      await executeCommand('sudo', ['fallocate', '-l', '1G', '/swapfile']);
      await executeCommand('sudo', ['chmod', '600', '/swapfile']);
      await executeCommand('sudo', ['mkswap', '/swapfile']);
      await executeCommand('sudo', ['swapon', '/swapfile']);

      // Update fstab
      const fstabContent = await Deno.readTextFile('/etc/fstab');
      const fstabWithoutSwap = fstabContent.split('\n').filter(line => !line.includes('/swapfile')).join('\n');
      await Deno.writeTextFile('/tmp/fstab.tmp', fstabWithoutSwap + '\n/swapfile none swap sw 0 0\n');
      await executeCommand('sudo', ['mv', '/tmp/fstab.tmp', '/etc/fstab']);
}

async function installD9Node(messages: Messages, osInfo: { type: 'ubuntu' | 'debian'; user: string }, mode: InstallMode): Promise<void> {
      console.log('\n🚀 ' + messages.setup.startingInstallation + '\n');

      // Update system
      console.log('📦 ' + messages.setup.updatingPackages);
      const updateResult = await showProgress(
            'Running apt update...',
            executeCommand('sudo', ['apt', 'update', '-qq'])
      );

      if (!updateResult.success) {
            throw new Error('Failed to update package lists');
      }
      console.log('✅ ' + messages.setup.packagesUpdated);

      console.log('\n🔧 ' + messages.setup.installingPackages);
      const installResult = await showProgress(
            'Installing curl, jq, wget...',
            executeCommand('sudo', ['apt', 'install', '-y', '-qq', 'curl', 'jq', 'wget'])
      );

      if (!installResult.success) {
            throw new Error('Failed to install required packages');
      }
      console.log('✅ ' + messages.setup.packagesInstalled);

      // Check GLIBC version
      console.log('\n🔍 ' + messages.setup.checkingGlibc);
      const glibcResult = await executeCommand('ldd', ['--version']);
      if (!glibcResult.success) {
            let checkError = 'Failed to check GLIBC version';
            if (glibcResult.error) {
                  checkError += `\n\nError: ${glibcResult.error}`;
            }
            checkError += '\n\nThis might mean ldd is not installed or accessible.';
            throw new Error(checkError);
      }

      // Extract GLIBC version - match the pattern from the bash script
      const versionMatch = glibcResult.output.match(/([0-9]+\.[0-9]+)$/m);
      if (!versionMatch) {
            let parseError = 'Could not parse GLIBC version from ldd output';
            parseError += `\n\nReceived output: ${glibcResult.output.substring(0, 200)}`;
            parseError += '\n\nExpected format: ldd (GNU libc) X.XX';
            throw new Error(parseError);
      }

      const glibcVersion = versionMatch[1];
      const [major, minor] = glibcVersion.split('.').map(Number);

      console.log(`Current GLIBC version: ${glibcVersion}`);
      console.log('Required GLIBC version: 2.38 or higher');

      // Check if GLIBC needs upgrade
      if (major > 2 || (major === 2 && minor >= 38)) {
            console.log('✅ ' + messages.setup.glibcCompatible);
      } else {
            console.log('\n⚠️ ' + messages.setup.glibcIncompatible);
            console.log('🔧 ' + messages.setup.upgradingGlibc);

            // Backup sources.list
            await executeCommand('sudo', ['cp', '/etc/apt/sources.list', '/etc/apt/sources.list.backup']);

            // Add appropriate repository based on OS
            if (osInfo.type === 'ubuntu') {
                  console.log('Adding Ubuntu 24.04 repository for newer glibc...');
                  const nobleRepoContent = 'deb http://archive.ubuntu.com/ubuntu noble main\n';
                  await Deno.writeTextFile('/tmp/noble.list', nobleRepoContent);
                  await executeCommand('sudo', ['mv', '/tmp/noble.list', '/etc/apt/sources.list.d/noble.list']);
            } else {
                  // For Debian 12, try testing/sid repositories for newer glibc
                  console.log('Adding Debian testing repository for newer glibc...');
                  const testingRepoContent = 'deb http://deb.debian.org/debian testing main\n';
                  await Deno.writeTextFile('/tmp/testing.list', testingRepoContent);
                  await executeCommand('sudo', ['mv', '/tmp/testing.list', '/etc/apt/sources.list.d/testing.list']);

                  // Set up pinning to prevent full system upgrade
                  const pinContent = `Package: *
Pin: release a=stable
Pin-Priority: 700

Package: libc6
Pin: release a=testing
Pin-Priority: 900
`;
                  await Deno.writeTextFile('/tmp/preferences', pinContent);
                  await executeCommand('sudo', ['mv', '/tmp/preferences', '/etc/apt/preferences.d/libc6']);
            }

            // Update package list
            console.log('Updating package lists...');
            await executeCommand('sudo', ['apt', 'update', '-qq']);

            // Install newer glibc
            console.log('Installing newer glibc...');
            const glibcInstallResult = await executeCommand('sudo', ['apt', 'install', '-y', '-qq', 'libc6']);
            if (!glibcInstallResult.success) {
                  // Restore original sources and fail
                  if (osInfo.type === 'ubuntu') {
                        await executeCommand('sudo', ['rm', '/etc/apt/sources.list.d/noble.list']);
                  } else {
                        await executeCommand('sudo', ['rm', '/etc/apt/sources.list.d/testing.list']);
                        await executeCommand('sudo', ['rm', '-f', '/etc/apt/preferences.d/libc6']);
                  }
                  await executeCommand('sudo', ['apt', 'update', '-qq']);

                  let errorDetails = 'Failed to upgrade GLIBC';
                  if (glibcInstallResult.error) {
                        errorDetails += `\n\nError details: ${glibcInstallResult.error}`;
                  }
                  if (glibcInstallResult.output) {
                        errorDetails += `\n\nCommand output: ${glibcInstallResult.output}`;
                  }
                  errorDetails += '\n\nThis usually happens because:';
                  errorDetails += '\n- Package conflicts with existing system libraries';
                  errorDetails += '\n- Missing dependencies or broken packages';
                  errorDetails += '\n- Network issues preventing package download';
                  errorDetails += '\n\nPlease use the build from source script instead:';
                  errorDetails += '\ncurl -sSf https://raw.githubusercontent.com/D-Nine-Chain/d9-node/main/scripts/build-node.sh | bash';

                  throw new Error(errorDetails);
            }

            // Verify upgraded version
            const newGlibcResult = await executeCommand('ldd', ['--version']);
            const newVersionMatch = newGlibcResult.output.match(/([0-9]+\.[0-9]+)$/m);
            if (!newVersionMatch) {
                  let verifyError = 'Could not verify new GLIBC version after upgrade';
                  verifyError += `\n\nReceived output: ${newGlibcResult.output.substring(0, 200)}`;
                  verifyError += '\n\nThis might indicate the upgrade was incomplete.';
                  throw new Error(verifyError);
            }

            const newGlibcVersion = newVersionMatch[1];
            const [newMajor, newMinor] = newGlibcVersion.split('.').map(Number);

            console.log(`New GLIBC version: ${newGlibcVersion}`);

            if (newMajor > 2 || (newMajor === 2 && newMinor >= 38)) {
                  console.log('✅ GLIBC successfully upgraded to a compatible version');
            } else {
                  // Restore and fail
                  if (osInfo.type === 'ubuntu') {
                        await executeCommand('sudo', ['rm', '/etc/apt/sources.list.d/noble.list']);
                  } else {
                        await executeCommand('sudo', ['rm', '/etc/apt/sources.list.d/testing.list']);
                        await executeCommand('sudo', ['rm', '-f', '/etc/apt/preferences.d/libc6']);
                  }
                  await executeCommand('sudo', ['apt', 'update', '-qq']);
                  let upgradeError = `GLIBC upgrade failed - version ${newGlibcVersion} is still below required 2.38`;
                  upgradeError += '\n\nThis can happen when:';
                  upgradeError += '\n- The system cannot upgrade GLIBC due to dependencies';
                  upgradeError += '\n- Ubuntu 22.04 base system limitations';
                  upgradeError += '\n\nPlease use the build from source script instead:';
                  upgradeError += '\ncurl -sSf https://raw.githubusercontent.com/D-Nine-Chain/d9-node/main/scripts/build-node.sh | bash';
                  throw new Error(upgradeError);
            }
      }

      // Download latest release
      console.log('\n🌐 ' + messages.setup.fetchingRelease);
      const releaseResult = await showProgress(
            'Contacting GitHub API...',
            executeCommand('curl', [
                  '-s',
                  'https://api.github.com/repos/D-Nine-Chain/d9-node/releases/latest'
            ])
      );

      if (!releaseResult.success) {
            throw new Error('Download failed. Please check your internet connection and try again.');
      }

      // Parse and download
      let releaseData;
      try {
            releaseData = JSON.parse(releaseResult.output);
      } catch (e) {
            console.error('Failed to parse release data:', releaseResult.output);
            throw new Error('Download failed. Please check your internet connection and try again.');
      }

      // Check for rate limit
      if (releaseData.message && releaseData.message.includes('rate limit')) {
            console.error('\n❌ GitHub API rate limit exceeded');
            console.log('\nYou can either:');
            console.log('1. Wait a few minutes and try again');
            console.log('2. Download manually from: https://github.com/D-Nine-Chain/d9-node/releases');
            throw new Error('GitHub API rate limit exceeded');
      }

      if (!releaseData.assets || !Array.isArray(releaseData.assets)) {
            console.error('Could not find download URLs');
            throw new Error('Download failed. Please check your internet connection and try again.');
      }

      const tarballAsset = releaseData.assets.find((asset: any) => asset.name.endsWith('.tar.gz'));
      const hashAsset = releaseData.assets.find((asset: any) => asset.name.endsWith('.sha256'));

      if (!tarballAsset || !hashAsset) {
            console.error('Could not find download URLs');
            throw new Error('Download failed. Please check your internet connection and try again.');
      }

      console.log('Download URL:', tarballAsset.browser_download_url);
      console.log('Hash URL:', hashAsset.browser_download_url);

      // Download files
      console.log('\n📥 ' + messages.setup.downloadingBinary);
      const downloadResult = await showProgress(
            `Downloading ${tarballAsset.name}...`,
            executeCommand('wget', ['-O', '/tmp/d9-node.tar.gz', tarballAsset.browser_download_url])
      );

      if (!downloadResult.success) {
            throw new Error('Download failed. Please check your internet connection and try again.');
      }
      console.log('✅ Downloaded binary');

      console.log('\n📥 ' + messages.setup.downloadingChecksum);
      const hashResult = await showProgress(
            'Downloading SHA256 hash...',
            executeCommand('wget', ['-O', '/tmp/d9-node.tar.gz.sha256', hashAsset.browser_download_url])
      );

      if (!hashResult.success) {
            throw new Error('Download failed. Please check your internet connection and try again.');
      }
      console.log('✅ Downloaded checksum');

      // Fix the checksum file format (remove filename part if it includes full path)
      console.log('🔧 Preparing checksum file...');
      const checksumContent = await Deno.readTextFile('/tmp/d9-node.tar.gz.sha256');
      const checksumHash = checksumContent.trim().split(/\s+/)[0];
      await Deno.writeTextFile('/tmp/d9-node.tar.gz.sha256', `${checksumHash}  d9-node.tar.gz\n`);

      // Verify integrity
      console.log('\n🔐 ' + messages.setup.verifyingIntegrity);
      const expectedHashResult = await executeCommand('cat', ['/tmp/d9-node.tar.gz.sha256']);
      const actualHashResult = await executeCommand('sha256sum', ['/tmp/d9-node.tar.gz']);

      if (!expectedHashResult.success || !actualHashResult.success) {
            throw new Error('File integrity verification failed');
      }

      const expectedHash = expectedHashResult.output.trim().split(/\s+/)[0];
      const actualHash = actualHashResult.output.trim().split(/\s+/)[0];

      if (expectedHash === actualHash) {
            console.log('✅ ' + messages.setup.integrityVerified);
      } else {
            await executeCommand('rm', ['-f', '/tmp/d9-node.tar.gz', '/tmp/d9-node.tar.gz.sha256']);
            throw new Error('File integrity verification failed');
      }

      // Extract and install
      console.log('\n📦 ' + messages.setup.extractingBinary);
      const extractResult = await showProgress(
            'Extracting tar archive...',
            executeCommand('tar', ['-xzf', '/tmp/d9-node.tar.gz', '-C', '/tmp'])
      );

      if (!extractResult.success) {
            throw new Error(`Failed to extract: ${extractResult.error}`);
      }
      console.log('✅ ' + messages.setup.binaryExtracted);

      console.log('🔧 ' + messages.setup.installingBinary);
      await executeCommand('sudo', ['mv', '/tmp/d9-node', '/usr/local/bin/']);
      await executeCommand('sudo', ['chown', 'root:root', '/usr/local/bin/d9-node']);
      await executeCommand('sudo', ['chmod', '755', '/usr/local/bin/d9-node']);

      // Download chain spec
      console.log('\n📥 ' + messages.setup.downloadingChainSpec);
      const specResult = await showProgress(
            'Downloading chain spec...',
            executeCommand('wget', [
                  '-O', '/tmp/new-main-spec.json',
                  'https://raw.githubusercontent.com/D-Nine-Chain/d9-node/main/new-main-spec.json'
            ])
      );

      if (!specResult.success) {
            throw new Error(`Failed to download chain spec: ${specResult.error}`);
      }
      console.log('✅ ' + messages.setup.chainSpecDownloaded);
      await executeCommand('sudo', ['mv', '/tmp/new-main-spec.json', '/usr/local/bin/']);
      await executeCommand('sudo', ['chown', 'root:root', '/usr/local/bin/new-main-spec.json']);
      await executeCommand('sudo', ['chmod', '644', '/usr/local/bin/new-main-spec.json']);

      // Create data directory
      console.log('📁 ' + messages.setup.creatingDataDir);
      await executeCommand('sudo', ['mkdir', '-p', '/var/lib/d9-node']);
      await executeCommand('sudo', ['chown', '-R', 'd9-node:d9-node', '/var/lib/d9-node']);
      await executeCommand('sudo', ['chmod', '750', '/var/lib/d9-node']);

      console.log('\n✅ ' + messages.setup.installationComplete + '\n');

      // Cleanup
      await executeCommand('rm', ['-f', '/tmp/d9-node.tar.gz', '/tmp/d9-node.tar.gz.sha256']);
}

async function configureNode(nodeType: NodeType, messages: Messages, osInfo: { type: 'ubuntu' | 'debian'; user: string }): Promise<void> {
      await createProgressBar(2000, messages.progress.configuring);

      const nodeName = await prompt(messages.setup.enterNodeName) || 'D9-Node';

      // Create systemd service based on node type
      let serviceContent = `[Unit]
Description=D9 Node
After=network.target

[Service]
Type=simple
User=d9-node
Group=d9-node
WorkingDirectory=/var/lib/d9-node
ExecStart=/usr/local/bin/d9-node \\
  --base-path /var/lib/d9-node \\
  --chain /usr/local/bin/new-main-spec.json \\
  --name "${nodeName}" \\
  --port 40100`;

      // Add specific flags based on node type
      switch (nodeType) {
            case NodeType.VALIDATOR:
                  serviceContent += ' \\\n  --validator';
                  break;
            case NodeType.ARCHIVER:
                  serviceContent += ' \\\n  --pruning archive';
                  break;
            default: // FULL
                  serviceContent += ' \\\n  --pruning 1000';
      }

      serviceContent += `

Restart=on-failure

[Install]
WantedBy=multi-user.target
`;

      // Write service file
      await Deno.writeTextFile('/tmp/d9-node.service', serviceContent);
      await executeCommand('sudo', ['mv', '/tmp/d9-node.service', '/etc/systemd/system/']);

      // Enable and start service
      await executeCommand('sudo', ['systemctl', 'daemon-reload']);
      await executeCommand('sudo', ['systemctl', 'enable', 'd9-node.service']);

      // Generate keys if needed
      await generateNodeKeys(osInfo, messages);

      // Start the service
      console.log('\n🚀 ' + messages.setup.startingNodeService);
      await executeCommand('sudo', ['systemctl', 'start', 'd9-node.service']);

      // Give service a moment to start
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Show logs
      console.log('\n📋 ' + messages.setup.nodeStartingUp);
      console.log('──────────────────────────────────────────────────');
      console.log(messages.setup.pressCtrlC + '\n');

      // Run journalctl to show logs (this will take over the terminal)
      const journalProcess = new Deno.Command('sudo', {
            args: ['journalctl', '-u', 'd9-node', '-f', '-n', '100'],
            stdin: 'inherit',
            stdout: 'inherit',
            stderr: 'inherit'
      });

      await journalProcess.spawn().status;
}

async function generateNodeKeys(osInfo: { type: 'ubuntu' | 'debian'; user: string }, messages: Messages): Promise<void> {
      const keystorePath = '/var/lib/d9-node/chains/d9_main/keystore';
      const baseUser = 'd9-node';
      const dataBasePath = '/var/lib/d9-node';

      // Check if keys already exist
      try {
            const files = [];
            for await (const dirEntry of Deno.readDir(keystorePath)) {
                  if (dirEntry.isFile && (
                        dirEntry.name.startsWith('61757261') || // aura
                        dirEntry.name.startsWith('6772616e') || // grandpa
                        dirEntry.name.startsWith('696d6f6e') || // im_online
                        dirEntry.name.startsWith('61756469')    // audi (authority discovery)
                  )) {
                        files.push(dirEntry.name);
                  }
            }

            if (files.length >= 4) {
                  console.log('✅ ' + messages.setup.keysAlreadyExist);
                  return;
            }
      } catch {
            // Directory doesn't exist, will be created by node
      }

      const createNew = await Confirm.prompt(messages.setup.generateNewKeys);
      if (!createNew) {
            return;
      }

      // Stop service to insert keys
      console.log(messages.setup.stoppingService);
      const stopResult = await systemctl('stop', 'd9-node.service');
      if (!stopResult) {
            console.log(messages.setup.serviceNotRunning);
      }

      // Always use advanced key generation
      await generateAdvancedKeys(dataBasePath, baseUser, messages);

      // Restart service
      await systemctl('start', 'd9-node.service');
}


async function generateAdvancedKeys(dataBasePath: string, baseUser: string, messages: Messages): Promise<void> {
      console.log('\n🔐 ' + messages.setup.advancedKeyGeneration);
      console.log(messages.setup.advancedKeyGenDescription + '\n');

      // Get password with double verification
      const password = await getSecurePassword(messages);

      // Generate root mnemonic with password entropy
      const rootMnemonic = await generateRootMnemonic(password, messages);

      // Show root mnemonic with double confirmation
      await confirmRootMnemonic(rootMnemonic, messages);

      // Verify mnemonic backup
      await verifyMnemonicBackup(rootMnemonic, messages);

      // Generate session keys
      const sessionKeys = await generateSessionKeys(rootMnemonic, password, dataBasePath, baseUser, messages);

      // Display session keys
      displaySessionKeys(sessionKeys, messages);

      // Generate certificate files
      await generateCertificateFiles(sessionKeys, dataBasePath, messages);
}

async function getSecurePassword(messages: Messages): Promise<string> {
      console.log('🔒 ' + messages.setup.creatingSecurePassword);

      let password1: string;
      let password2: string;

      do {
            password1 = await Input.prompt({
                  message: messages.setup.enterPasswordPrompt,
                  minLength: 8
            });

            password2 = await Input.prompt({
                  message: messages.setup.confirmPasswordPrompt
            });

            if (password1 !== password2) {
                  console.log('❌ ' + messages.setup.passwordsDoNotMatch + '\n');
            }
      } while (password1 !== password2);

      return password1;
}

async function generateRootMnemonic(password: string, messages: Messages): Promise<string> {
      console.log('\n🌱 ' + messages.setup.generatingRootMnemonic);

      // Ensure crypto is ready
      await cryptoWaitReady();

      // Generate a new mnemonic using Polkadot.js
      const mnemonic = mnemonicGenerate(24); // 24 words for maximum security

      // Validate the mnemonic
      if (!mnemonicValidate(mnemonic)) {
            throw new Error('Generated mnemonic is invalid');
      }

      // Note: The password will be used when deriving keys from the mnemonic
      // The mnemonic itself is generated randomly for security
      // Password is used as additional entropy when deriving child keys

      return mnemonic;
}

async function confirmRootMnemonic(rootMnemonic: string, messages: Messages): Promise<void> {
      console.log('\n🚨 ' + messages.setup.criticalSecurityInfo);
      console.log('═══════════════════════════════════════════════════════════');
      console.log(messages.setup.rootMnemonicLabel);
      console.log(`"${rootMnemonic}"`);
      console.log('═══════════════════════════════════════════════════════════');
      console.log('⚠️  ' + messages.setup.rootMnemonicWarning1);
      console.log('⚠️  ' + messages.setup.rootMnemonicWarning2);
      console.log('⚠️  ' + messages.setup.rootMnemonicWarning3);
      console.log('═══════════════════════════════════════════════════════════\n');

      const understood1 = await Confirm.prompt(messages.setup.understandNotStored);
      if (!understood1) {
            throw new Error(messages.setup.mustAcknowledge);
      }

      console.log('\n🔴 ' + messages.setup.secondConfirmation);
      console.log(messages.setup.rootNotStoredWarning);
      console.log(messages.setup.mustSaveYourself);

      const confirmation = await Select.prompt({
            message: messages.setup.confirmUnderstand,
            options: [
                  { name: messages.setup.iUnderstandOption, value: true },
                  { name: messages.setup.cancelOption, value: false }
            ]
      });

      if (!confirmation) {
            throw new Error(messages.setup.setupCancelled);
      }
}

async function verifyMnemonicBackup(rootMnemonic: string, messages: Messages): Promise<void> {
      console.log('\n🔍 ' + messages.setup.verifyingBackup);

      const words = rootMnemonic.split(' ');
      const totalWords = words.length;

      // Generate 3 random word positions
      const positions: number[] = [];
      while (positions.length < 3) {
            const pos = Math.floor(Math.random() * totalWords) + 1;
            if (!positions.includes(pos)) {
                  positions.push(pos);
            }
      }
      positions.sort((a, b) => a - b);

      console.log(messages.setup.provideWords.replace('%s', positions.join(', ')));

      for (const pos of positions) {
            await Input.prompt({
                  message: messages.setup.wordPrompt.replace('%s', pos.toString()),
                  validate: (input) => {
                        if (input.trim().toLowerCase() === words[pos - 1].toLowerCase()) {
                              return true;
                        }
                        return messages.setup.incorrectWord.replace('%s', pos.toString()).replace('%s', input);
                  }
            });
      }

      console.log('✅ ' + messages.setup.mnemonicVerified);
}

async function generateSessionKeys(rootMnemonic: string, password: string, basePath: string, baseUser: string, messages: Messages) {
      console.log('\n🔐 ' + messages.setup.derivingSessionKeys);
      console.log(messages.setup.generatingDeterministic);
      console.log(messages.setup.onlyDerivedStored + '\n');

      // Ensure crypto is ready
      await cryptoWaitReady();

      const sessionKeys = {
            aura: { publicKey: '', address: '' },
            grandpa: { publicKey: '', address: '' },
            imOnline: { publicKey: '', address: '' },
            authorityDiscovery: { publicKey: '', address: '' }
      };

      // Define key derivation paths
      const keyConfigs = [
            { type: 'aura', path: '//aura//0', scheme: 'sr25519' as const, keyType: '61757261' },
            { type: 'gran', path: '//grandpa//0', scheme: 'ed25519' as const, keyType: '6772616e' },
            { type: 'imon', path: '//im_online//0', scheme: 'sr25519' as const, keyType: '696d6f6e' },
            { type: 'audi', path: '//authority_discovery//0', scheme: 'sr25519' as const, keyType: '61756469' }
      ];

      // Create keystore directory if it doesn't exist
      const keystorePath = `${basePath}/chains/d9_main/keystore`;
      try {
            await Deno.mkdir(keystorePath, { recursive: true });
            if (baseUser === 'd9-node') {
                  await executeCommand('sudo', ['chown', '-R', 'd9-node:d9-node', keystorePath]);
            }
      } catch (_e) {
            // Directory might already exist
      }

      for (const config of keyConfigs) {
            console.log(messages.setup.derivingKeyFrom.replace('%s', config.type).replace('%s', config.path));

            // Create keyring for the specific crypto type
            const keyring = new Keyring({ type: config.scheme, ss58Format: 9 });

            // Derive the key from root mnemonic with numbered path and password
            // The password is used as additional entropy in the derivation
            const derivedPair = keyring.createFromUri(`${rootMnemonic}${config.path}///${password}`);

            // Extract the derived key's secret (not the root mnemonic!)
            // Create a hex representation of the derived seed that will be stored
            const derivedSecret = derivedPair.toJson().encoded;

            // Create keystore filename (keyType + publicKey without 0x prefix)
            const publicKeyHex = u8aToHex(derivedPair.publicKey).substring(2);
            const filename = `${config.keyType}${publicKeyHex}`;

            // Write only the derived secret to keystore file
            const keyFilePath = `${keystorePath}/${filename}`;
            await Deno.writeTextFile(keyFilePath, `"${derivedSecret}"`);

            // Set permissions if using dedicated user
            if (baseUser === 'd9-node') {
                  await executeCommand('sudo', ['chown', 'd9-node:d9-node', keyFilePath]);
                  await executeCommand('sudo', ['chmod', '600', keyFilePath]);
            }

            // Store session key info for display
            const keyName = config.type === 'gran' ? 'grandpa' :
                  config.type === 'imon' ? 'imOnline' :
                        config.type === 'audi' ? 'authorityDiscovery' : config.type;

            sessionKeys[keyName as keyof typeof sessionKeys] = {
                  publicKey: u8aToHex(derivedPair.publicKey),
                  address: derivedPair.address
            };
      }

      return sessionKeys;
}

function displaySessionKeys(sessionKeys: any, messages: Messages): void {
      console.log('\n🎯 ' + messages.setup.yourSessionKeys);
      console.log('═══════════════════════════════════════════════════════════');
      console.log(messages.setup.sessionKeysDescription);
      console.log('');
      console.log('SessionKeys {');
      console.log(`  aura: {`);
      console.log(`    publicKey: "${sessionKeys.aura.publicKey}",`);
      console.log(`    address: "${sessionKeys.aura.address}"`);
      console.log(`  },`);
      console.log(`  grandpa: {`);
      console.log(`    publicKey: "${sessionKeys.grandpa.publicKey}",`);
      console.log(`    address: "${sessionKeys.grandpa.address}"`);
      console.log(`  },`);
      console.log(`  imOnline: {`);
      console.log(`    publicKey: "${sessionKeys.imOnline.publicKey}",`);
      console.log(`    address: "${sessionKeys.imOnline.address}"`);
      console.log(`  },`);
      console.log(`  authorityDiscovery: {`);
      console.log(`    publicKey: "${sessionKeys.authorityDiscovery.publicKey}",`);
      console.log(`    address: "${sessionKeys.authorityDiscovery.address}"`);
      console.log(`  }`);
      console.log('}');
      console.log('');
      console.log('ℹ️  ' + messages.setup.publicKeysOnly);
      console.log('ℹ️  ' + messages.setup.onlyDerivedHex);
      console.log('ℹ️  ' + messages.setup.rootNeverStored);
      console.log('═══════════════════════════════════════════════════════════');
}

async function generateCertificateFiles(sessionKeys: any, basePath: string, messages: Messages): Promise<void> {

      // Generate user certificate
      const certificate = `
╔══════════════════════════════════════════════════════════╗
║                D9 NODE VALIDATOR CERTIFICATE              ║
║                                                           ║
║  Created: ${new Date().toLocaleString()}                           ║
║                                                           ║
║  Session Keys:                                            ║
║  Aura:      ${sessionKeys.aura.address}                          ║
║  Grandpa:   ${sessionKeys.grandpa.address}                       ║
║  ImOnline:  ${sessionKeys.imOnline.address}                      ║
║  AuthDisc:  ${sessionKeys.authorityDiscovery.address}            ║
║                                                           ║
║  🔒 Secured with advanced HD key derivation              ║
║  🔑 Only derived key hex stored (root mnemonic offline)  ║
║  📊 Running in secure dedicated user mode                ║
║                                                           ║
║  Share this certificate to prove your validator setup!   ║
╚══════════════════════════════════════════════════════════╝
`;

      // Generate debug info
      const debugInfo = {
            timestamp: new Date().toISOString(),
            version: 'd9-manager-v2.0.0',
            mode: 'hard',
            os: await getSystemInfo(),
            sessionKeys,
            config: {
                  basePath,
                  keyDerivation: 'HD (root//service//0)',
                  security: 'password-derived root, dedicated user, root-owned binary'
            }
      };

      await Deno.writeTextFile('./d9-certificate.txt', certificate);
      await Deno.writeTextFile('./d9-debug-info.json', JSON.stringify(debugInfo, null, 2));

      console.log('\n📋 ' + messages.setup.filesGenerated);
      console.log('✅ ' + messages.setup.certificateFile);
      console.log('✅ ' + messages.setup.debugFile);
}

async function getSystemInfo() {
      const osRelease = await Deno.readTextFile('/etc/os-release').catch(() => 'unknown');
      const arch = await executeCommand('uname', ['-m']);
      const cpu = await executeCommand('cat', ['/proc/cpuinfo']).catch(() => ({ output: 'unknown' }));

      return {
            os: osRelease.match(/PRETTY_NAME="(.+)"/)?.[1] || 'unknown',
            architecture: arch.success ? arch.output.trim() : 'unknown',
            processor: cpu.output.match(/model name\s*:\s*(.+)/)?.[1] || 'unknown'
      };
}

function prompt(message: string): Promise<string> {
      return new Promise((resolve) => {
            const input = globalThis.prompt(message);
            resolve(input || '');
      });
}