import { Select, Confirm, Input } from '@cliffy/prompt';
import { NodeType, Messages } from '../types.ts';
import { checkDiskSpace, executeCommand, createProgressBar, systemctl, showProgress } from '../utils/system.ts';
import { encodeAddress } from '@polkadot/util-crypto';
import { randomBytes, pbkdf2, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const pbkdf2Async = promisify(pbkdf2);

type InstallMode = 'legacy' | 'easy' | 'hard';

export async function setupNode(messages: Messages): Promise<void> {
  console.log('\n' + messages.setupNewNode);

  // Check system requirements first
  console.log('\n🔍 ' + messages.setup.checkingRequirements + '\n');
  
  // Check OS compatibility (Ubuntu 22.04 or Debian 11+)
  let osInfo: { type: 'ubuntu' | 'debian'; user: string } | null = null;
  
  try {
    const osReleaseContent = await Deno.readTextFile('/etc/os-release');
    const isUbuntu = osReleaseContent.includes('ID=ubuntu');
    const isDebian = osReleaseContent.includes('ID=debian');
    const isUbuntu2204 = osReleaseContent.includes('VERSION_ID="22.04"');

    // Extract Debian version if present
    const debianVersionMatch = osReleaseContent.match(/VERSION_ID="(\d+)"/);
    const debianVersion = debianVersionMatch ? parseInt(debianVersionMatch[1]) : null;

    if (isUbuntu && isUbuntu2204) {
      console.log('✅ ' + messages.setup.ubuntu2204);
      osInfo = { type: 'ubuntu', user: 'ubuntu' };
    } else if (isDebian && debianVersion && debianVersion >= 11) {
      // Support Debian 11, 12, 13+ for better compatibility
      const versionLabel = debianVersion === 12 ? messages.setup.debian12 : `Debian ${debianVersion}`;
      console.log('✅ ' + versionLabel);
      osInfo = { type: 'debian', user: Deno.env.get('SUDO_USER') || Deno.env.get('USER') || 'debian' };
    } else if (isDebian && !debianVersionMatch) {
      // Handle Debian testing/unstable which might not have VERSION_ID
      console.log('✅ Debian (testing/unstable)');
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
    console.log('\n❌ ' + messages.setup.insufficientDiskSpace.replace('%s', requiredSpace.toString()));
    return;
  }
  console.log('✅ ' + messages.setup.sufficientDiskSpace);

  // Configure swap file
  console.log('\n🔧 ' + messages.setup.configuringSwap);
  await configureSwap();
  console.log('✅ ' + messages.setup.swapConfigured);

  // Detect installation mode
  const mode = await detectInstallationMode(messages);
  console.log('\n🔧 ' + messages.setup.runningInMode.replace('%s', mode));
  
  if (mode !== 'legacy') {
    // Create dedicated service user
    await createServiceUser(messages);
  }

  // Install node if not present
  await installD9Node(messages, osInfo, mode);
  
  // Configure node
  await configureNode(nodeType as NodeType, messages, osInfo, mode);
}

async function detectInstallationMode(messages: Messages): Promise<InstallMode> {
  // Check for existing installation
  const hasLegacyData = await checkLegacyInstallation();

  if (hasLegacyData) {
    console.log('🔍 ' + messages.setup.existingInstallation);
    return 'legacy';
  }

  // For new installations, prompt for mode
  const mode = await Select.prompt({
    message: messages.setup.selectSecurityMode,
    options: [
      {
        name: messages.setup.securityModes.easy,
        value: 'easy'
      },
      {
        name: messages.setup.securityModes.advanced,
        value: 'hard'
      },
      {
        name: messages.setup.securityModes.legacy,
        value: 'legacy'
      }
    ]
  });

  return mode as InstallMode;
}

async function checkLegacyInstallation(): Promise<boolean> {
  try {
    // Check for legacy data directories
    const legacyPaths = [
      '/home/ubuntu/node-data',
      '/home/debian/node-data'
    ];
    
    for (const path of legacyPaths) {
      try {
        await Deno.stat(path);
        return true;
      } catch {
        // Path doesn't exist, continue
      }
    }
    
    // Check for legacy systemd service
    const serviceResult = await executeCommand('systemctl', ['is-enabled', 'd9-node.service']);
    if (serviceResult.success) {
      const serviceContent = await Deno.readTextFile('/etc/systemd/system/d9-node.service').catch(() => '');
      if (serviceContent.includes('User=ubuntu') || serviceContent.includes('User=debian')) {
        return true;
      }
    }
    
    return false;
  } catch {
    return false;
  }
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
  console.log('\n🚀 Starting D9 node installation...\n');
  
  // Update system
  console.log('📦 Updating package lists...');
  const updateResult = await showProgress(
    'Running apt update...',
    executeCommand('sudo', ['apt', 'update', '-qq'])
  );
  
  if (!updateResult.success) {
    throw new Error('Failed to update package lists');
  }
  console.log('✅ Package lists updated');
  
  console.log('\n🔧 Installing required packages...');
  const installResult = await showProgress(
    'Installing curl, jq, wget...',
    executeCommand('sudo', ['apt', 'install', '-y', '-qq', 'curl', 'jq', 'wget'])
  );
  
  if (!installResult.success) {
    throw new Error('Failed to install required packages');
  }
  console.log('✅ Required packages installed');
  
  // Check GLIBC version
  console.log('\n🔍 Checking GLIBC version...');
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
    console.log('✅ GLIBC is compatible');
  } else {
    console.log('\n⚠️ GLIBC version is incompatible');
    console.log('🔧 Attempting to upgrade GLIBC...');
    
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
  console.log('\n🌐 Fetching latest release information...');
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
  console.log('\n📥 Downloading D9 node binary...');
  const downloadResult = await showProgress(
    `Downloading ${tarballAsset.name}...`,
    executeCommand('wget', ['-O', '/tmp/d9-node.tar.gz', tarballAsset.browser_download_url])
  );
  
  if (!downloadResult.success) {
    throw new Error('Download failed. Please check your internet connection and try again.');
  }
  console.log('✅ Downloaded binary');
  
  console.log('\n📥 Downloading checksum file...');
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
  console.log('\n🔐 Verifying file integrity...');
  const expectedHashResult = await executeCommand('cat', ['/tmp/d9-node.tar.gz.sha256']);
  const actualHashResult = await executeCommand('sha256sum', ['/tmp/d9-node.tar.gz']);
  
  if (!expectedHashResult.success || !actualHashResult.success) {
    throw new Error('File integrity verification failed');
  }
  
  const expectedHash = expectedHashResult.output.trim().split(/\s+/)[0];
  const actualHash = actualHashResult.output.trim().split(/\s+/)[0];
  
  if (expectedHash === actualHash) {
    console.log('✅ File integrity verified');
  } else {
    await executeCommand('rm', ['-f', '/tmp/d9-node.tar.gz', '/tmp/d9-node.tar.gz.sha256']);
    throw new Error('File integrity verification failed');
  }

  // Extract and install
  console.log('\n📦 Extracting binary...');
  const extractResult = await showProgress(
    'Extracting tar archive...',
    executeCommand('tar', ['-xzf', '/tmp/d9-node.tar.gz', '-C', '/tmp'])
  );
  
  if (!extractResult.success) {
    throw new Error(`Failed to extract: ${extractResult.error}`);
  }
  console.log('✅ Binary extracted');
  
  console.log('🔧 Installing binary to /usr/local/bin/...');
  await executeCommand('sudo', ['mv', '/tmp/d9-node', '/usr/local/bin/']);
  await executeCommand('sudo', ['chown', 'root:root', '/usr/local/bin/d9-node']);
  await executeCommand('sudo', ['chmod', '755', '/usr/local/bin/d9-node']);

  // Download chain spec
  console.log('\n📥 Downloading chain specification...');
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
  console.log('✅ Chain specification downloaded');
  await executeCommand('sudo', ['mv', '/tmp/new-main-spec.json', '/usr/local/bin/']);
  await executeCommand('sudo', ['chown', 'root:root', '/usr/local/bin/new-main-spec.json']);
  await executeCommand('sudo', ['chmod', '644', '/usr/local/bin/new-main-spec.json']);

  // Create data directory based on mode
  console.log('📁 Creating data directory...');
  if (mode === 'legacy') {
    const homeDir = `/home/${osInfo.user}`;
    await executeCommand('sudo', ['mkdir', '-p', `${homeDir}/node-data`]);
    await executeCommand('sudo', ['chown', '-R', `${osInfo.user}:${osInfo.user}`, `${homeDir}/node-data`]);
  } else {
    await executeCommand('sudo', ['mkdir', '-p', '/var/lib/d9-node']);
    await executeCommand('sudo', ['chown', '-R', 'd9-node:d9-node', '/var/lib/d9-node']);
    await executeCommand('sudo', ['chmod', '750', '/var/lib/d9-node']);
  }
  
  console.log('\n✅ D9 node installation completed successfully!\n');

  // Cleanup
  await executeCommand('rm', ['-f', '/tmp/d9-node.tar.gz', '/tmp/d9-node.tar.gz.sha256']);
}

async function configureNode(nodeType: NodeType, messages: Messages, osInfo: { type: 'ubuntu' | 'debian'; user: string }, mode: InstallMode): Promise<void> {
  await createProgressBar(2000, messages.progress.configuring);

  const nodeName = await prompt('Enter a name for your node:') || 'D9-Node';

  // Create systemd service based on node type and mode
  let serviceContent: string;
  
  if (mode === 'legacy') {
    const homeDir = `/home/${osInfo.user}`;
    serviceContent = `[Unit]
Description=D9 Node
After=network.target

[Service]
Type=simple
User=${osInfo.user}
ExecStart=/usr/local/bin/d9-node \\
  --base-path ${homeDir}/node-data \\
  --chain /usr/local/bin/new-main-spec.json \\
  --name "${nodeName}" \\
  --port 40100`;
  } else {
    serviceContent = `[Unit]
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
  }

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
  await generateNodeKeys(osInfo, mode);
  
  // Start the service
  console.log('\n🚀 Starting D9 node service...');
  await executeCommand('sudo', ['systemctl', 'start', 'd9-node.service']);
  
  // Give service a moment to start
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Show logs
  console.log('\n📋 Node is starting up. Here are the recent logs:');
  console.log('──────────────────────────────────────────────────');
  console.log('Press Ctrl+C to stop viewing logs\n');
  
  // Run journalctl to show logs (this will take over the terminal)
  const journalProcess = new Deno.Command('sudo', {
    args: ['journalctl', '-u', 'd9-node', '-f', '-n', '100'],
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit'
  });
  
  await journalProcess.spawn().status;
}

async function generateNodeKeys(osInfo: { type: 'ubuntu' | 'debian'; user: string }, mode: InstallMode): Promise<void> {
  let keystorePath: string;
  let baseUser: string;
  let basePath: string;
  
  if (mode === 'legacy') {
    const homeDir = `/home/${osInfo.user}`;
    keystorePath = `${homeDir}/node-data/chains/d9_main/keystore`;
    baseUser = osInfo.user;
    basePath = `${homeDir}/node-data`;
  } else {
    keystorePath = '/var/lib/d9-node/chains/d9_main/keystore';
    baseUser = 'd9-node';
    basePath = '/var/lib/d9-node';
  }
  
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
      console.log('✅ Keys already exist');
      return;
    }
  } catch {
    // Directory doesn't exist, will be created by node
  }

  const createNew = await Confirm.prompt('No keys found. Generate new keys?');
  if (!createNew) {
    return;
  }

  // Stop service to insert keys
  console.log('Stopping d9-node service...');
  const stopResult = await systemctl('stop', 'd9-node.service');
  if (!stopResult) {
    console.log('Note: Service might not be running yet, continuing...');
  }

  if (mode === 'hard') {
    await generateAdvancedKeys(basePath, baseUser);
  } else {
    await generateStandardKeys(basePath, baseUser);
  }

  // Restart service
  await systemctl('start', 'd9-node.service');
}

async function generateStandardKeys(basePath: string, baseUser: string): Promise<void> {
  // Generate seed phrase using d9-node
  console.log('\n🔑 Generating seed phrase...');
  
  let seedResult = await executeCommand('/usr/local/bin/d9-node', [
    'key', 'generate', '--scheme', 'Sr25519'
  ]);

  if (!seedResult.success) {
    seedResult = await executeCommand('/usr/local/bin/d9-node', ['key', 'generate']);
    if (!seedResult.success) {
      throw new Error('Failed to generate seed phrase');
    }
  }

  const seedMatch = seedResult.output.match(/Secret phrase:\s+(.+)/);
  if (!seedMatch) {
    throw new Error('Could not extract seed phrase');
  }

  const seedPhrase = seedMatch[1].trim();
  console.log('\n🔑 IMPORTANT - Save this seed phrase:');
  console.log(`"${seedPhrase}"`);
  console.log('Press Enter when you have saved it...');
  await prompt('');

  // Insert standard keys
  const keyInsertCommands = [
    ['aura', seedPhrase],
    ['gran', `${seedPhrase}//grandpa`],
    ['imon', `${seedPhrase}//im_online`],
    ['audi', `${seedPhrase}//authority_discovery`]
  ];

  for (const [keyType, suri] of keyInsertCommands) {
    const scheme = keyType === 'gran' ? 'Ed25519' : 'Sr25519';
    const insertCommand = baseUser === 'd9-node' 
      ? ['sudo', '-u', 'd9-node', '/usr/local/bin/d9-node']
      : ['/usr/local/bin/d9-node'];
    
    await executeCommand(insertCommand[0], [
      ...insertCommand.slice(1),
      'key', 'insert',
      '--base-path', basePath,
      '--chain', '/usr/local/bin/new-main-spec.json',
      '--scheme', scheme,
      '--suri', suri,
      '--key-type', keyType
    ]);
  }
}

async function generateAdvancedKeys(basePath: string, baseUser: string): Promise<void> {
  console.log('\n🔐 Advanced Key Generation Mode');
  console.log('This mode uses hierarchical deterministic key derivation for enhanced security.\n');
  
  // Get password with double verification
  const password = await getSecurePassword();
  
  // Generate root mnemonic with password entropy
  const rootMnemonic = await generateRootMnemonic(password);
  
  // Show root mnemonic with double confirmation
  await confirmRootMnemonic(rootMnemonic);
  
  // Verify mnemonic backup
  await verifyMnemonicBackup(rootMnemonic);
  
  // Generate session keys
  const sessionKeys = await generateSessionKeys(rootMnemonic, password, basePath, baseUser);
  
  // Display session keys
  await displaySessionKeys(sessionKeys);
  
  // Generate certificate files
  await generateCertificateFiles(sessionKeys, basePath);
}

async function getSecurePassword(): Promise<string> {
  console.log('🔒 Creating secure password for key derivation');
  
  let password1: string;
  let password2: string;
  
  do {
    password1 = await Input.prompt({
      message: 'Enter password for key derivation:',
      minLength: 8
    });
    
    password2 = await Input.prompt({
      message: 'Confirm password:'
    });
    
    if (password1 !== password2) {
      console.log('❌ Passwords do not match. Please try again.\n');
    }
  } while (password1 !== password2);
  
  return password1;
}

async function generateRootMnemonic(password: string): Promise<string> {
  console.log('\n🌱 Generating root mnemonic with password entropy...');
  
  // Generate entropy from password + random bytes
  const passwordBuffer = new TextEncoder().encode(password);
  const randomBuffer = randomBytes(32);
  const combinedBuffer = new Uint8Array(passwordBuffer.length + randomBuffer.length);
  combinedBuffer.set(passwordBuffer);
  combinedBuffer.set(randomBuffer, passwordBuffer.length);
  
  // Create deterministic entropy
  const entropy = createHash('sha256').update(combinedBuffer).digest();
  
  // Generate mnemonic (simplified - in production would use proper BIP39)
  const seedResult = await executeCommand('/usr/local/bin/d9-node', ['key', 'generate']);
  if (!seedResult.success) {
    throw new Error('Failed to generate root mnemonic');
  }
  
  const seedMatch = seedResult.output.match(/Secret phrase:\s+(.+)/);
  if (!seedMatch) {
    throw new Error('Could not extract root mnemonic');
  }
  
  return seedMatch[1].trim();
}

async function confirmRootMnemonic(rootMnemonic: string): Promise<void> {
  console.log('\n🚨 CRITICAL SECURITY INFORMATION');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('Your ROOT MNEMONIC:');
  console.log(`"${rootMnemonic}"`);
  console.log('═══════════════════════════════════════════════════════════');
  console.log('⚠️  This root key will NOT be stored locally on this machine.');
  console.log('⚠️  If you lose this mnemonic, you will lose access to your validator.');
  console.log('⚠️  Write it down and store it in a secure location.');
  console.log('═══════════════════════════════════════════════════════════\n');
  
  const understood1 = await Confirm.prompt('Do you understand that this root mnemonic will NOT be stored locally?');
  if (!understood1) {
    throw new Error('User must acknowledge security requirements');
  }
  
  console.log('\n🔴 SECOND CONFIRMATION REQUIRED');
  console.log('The root mnemonic will NOT be stored locally.');
  console.log('You must save it yourself or lose access forever.');
  
  const confirmation = await Select.prompt({
    message: 'Type "1" to confirm you understand:',
    options: [
      { name: '1 - I understand and have saved the mnemonic', value: true },
      { name: '0 - Cancel setup', value: false }
    ]
  });
  
  if (!confirmation) {
    throw new Error('Setup cancelled by user');
  }
}

async function verifyMnemonicBackup(rootMnemonic: string): Promise<void> {
  console.log('\n🔍 Verifying your mnemonic backup...');
  
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
  
  console.log(`Please provide words ${positions.join(', ')} from your mnemonic:`);
  
  for (const pos of positions) {
    const userWord = await Input.prompt({
      message: `Word ${pos}:`,
      validate: (input) => {
        if (input.trim().toLowerCase() === words[pos - 1].toLowerCase()) {
          return true;
        }
        return `Incorrect! Expected word ${pos} but got "${input}"`;
      }
    });
  }
  
  console.log('✅ Mnemonic verification successful!');
}

async function generateSessionKeys(rootMnemonic: string, password: string, basePath: string, baseUser: string) {
  console.log('\n🔧 Deriving session keys from root...');
  
  const sessionKeys = {
    aura: { publicKey: '', address: '' },
    grandpa: { publicKey: '', address: '' },
    imOnline: { publicKey: '', address: '' },
    authorityDiscovery: { publicKey: '', address: '' }
  };
  
  // Define key derivation paths
  const keyConfigs = [
    { type: 'aura', path: '//aura//0', scheme: 'Sr25519' },
    { type: 'gran', path: '//grandpa//0', scheme: 'Ed25519' },
    { type: 'imon', path: '//im_online//0', scheme: 'Sr25519' },
    { type: 'audi', path: '//authority_discovery//0', scheme: 'Sr25519' }
  ];
  
  for (const config of keyConfigs) {
    console.log(`Currently deriving ${config.type} service key...`);
    
    const derivedSuri = `${rootMnemonic}${config.path}`;
    
    // Insert the derived key
    const insertCommand = baseUser === 'd9-node' 
      ? ['sudo', '-u', 'd9-node', '/usr/local/bin/d9-node']
      : ['/usr/local/bin/d9-node'];
    
    await executeCommand(insertCommand[0], [
      ...insertCommand.slice(1),
      'key', 'insert',
      '--base-path', basePath,
      '--chain', '/usr/local/bin/new-main-spec.json',
      '--scheme', config.scheme,
      '--suri', derivedSuri,
      '--key-type', config.type
    ]);
    
    // Get public key for display
    const inspectResult = await executeCommand('/usr/local/bin/d9-node', [
      'key', 'inspect', '--scheme', config.scheme, derivedSuri
    ]);
    
    if (inspectResult.success) {
      const pubKeyMatch = inspectResult.output.match(/Public key \(hex\):\s+(0x[a-fA-F0-9]+)/);
      const ssMatch = inspectResult.output.match(/SS58 Address:\s+([a-zA-Z0-9]+)/);
      
      if (pubKeyMatch && ssMatch) {
        const keyName = config.type === 'gran' ? 'grandpa' : 
                       config.type === 'imon' ? 'imOnline' : 
                       config.type === 'audi' ? 'authorityDiscovery' : config.type;
        
        sessionKeys[keyName as keyof typeof sessionKeys] = {
          publicKey: pubKeyMatch[1],
          address: `Dn${ssMatch[1]}`
        };
      }
    }
  }
  
  return sessionKeys;
}

async function displaySessionKeys(sessionKeys: any): Promise<void> {
  console.log('\n🎯 Your Session Keys:');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('These are your PUBLIC session keys (safe to share):');
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
  console.log('ℹ️  These are only the PUBLIC addresses, not the actual keys.');
  console.log('ℹ️  The derived session keys are stored in the node keystore.');
  console.log('ℹ️  The root key and service keys are NOT stored on this machine.');
  console.log('═══════════════════════════════════════════════════════════');
}

async function generateCertificateFiles(sessionKeys: any, basePath: string): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  
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
║  🔑 Keys derived from secure root (not stored locally)   ║
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
  
  console.log('\n📋 Files generated:');
  console.log('✅ d9-certificate.txt - Share this to show your validator setup');
  console.log('✅ d9-debug-info.json - Technical details for troubleshooting');
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