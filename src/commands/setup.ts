import { Select, Confirm } from '@cliffy/prompt';
import { NodeType, Messages } from '../types.ts';
import { checkDiskSpace, executeCommand, createProgressBar, systemctl, showProgress } from '../utils/system.ts';

export async function setupNode(messages: Messages): Promise<void> {
  console.log('\n' + messages.setupNewNode);
  
  // Node type selection
  const nodeType = await Select.prompt<NodeType>({
    message: 'Select node type:',
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

  const proceed = await Confirm.prompt('Continue with this node type?');
  if (!proceed) {
    return;
  }

  // Check disk space requirements
  const requiredSpace = nodeType === NodeType.ARCHIVER ? 120 : 60;
  const hasSpace = await checkDiskSpace(requiredSpace);
  
  if (!hasSpace) {
    console.log(`❌ ${messages.errors.diskSpace}`);
    console.log(`Required: ${requiredSpace}GB`);
    return;
  }

  // Install node if not present
  await installD9Node(messages);
  
  // Configure node
  await configureNode(nodeType as NodeType, messages);
}

async function installD9Node(messages: Messages): Promise<void> {
  console.log('\n🚀 Starting D9 node installation...\n');
  
  // Check system requirements
  console.log('🔍 Checking system architecture...');
  const archResult = await executeCommand('uname', ['-m']);
  if (!archResult.success) {
    throw new Error('Failed to check system architecture');
  }
  console.log(`   Architecture: ${archResult.output.trim()}`);
  
  // Update system
  console.log('\n📦 Updating package lists...');
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

  // Download latest release
  console.log('\n🌐 Fetching latest release information...');
  const releaseResult = await showProgress(
    'Contacting GitHub API...',
    executeCommand('curl', [
      '-s', 
      'https://api.github.com/repos/D-Nine-Chain/d9_node/releases/latest'
    ])
  );
  
  if (!releaseResult.success) {
    throw new Error('Failed to fetch latest release info');
  }

  // Parse and download
  let releaseData;
  try {
    releaseData = JSON.parse(releaseResult.output);
  } catch (e) {
    console.error('Failed to parse release data:', releaseResult.output);
    throw new Error('Invalid release data from GitHub');
  }
  
  // Check for rate limit
  if (releaseData.message && releaseData.message.includes('rate limit')) {
    console.error('\n❌ GitHub API rate limit exceeded');
    console.log('\nYou can either:');
    console.log('1. Wait a few minutes and try again');
    console.log('2. Download manually from: https://github.com/D-Nine-Chain/d9_node/releases');
    throw new Error('GitHub API rate limit exceeded');
  }
  
  if (!releaseData.assets || !Array.isArray(releaseData.assets)) {
    console.error('Release data structure:', JSON.stringify(releaseData, null, 2));
    throw new Error('No assets found in release data');
  }
  
  const tarballAsset = releaseData.assets.find((asset: any) => asset.name.endsWith('.tar.gz'));
  const hashAsset = releaseData.assets.find((asset: any) => asset.name.endsWith('.sha256'));

  if (!tarballAsset || !hashAsset) {
    console.error('Available assets:', releaseData.assets.map((a: any) => a.name));
    throw new Error('Required release assets not found (.tar.gz and .sha256)');
  }
  
  console.log(`✅ Found release: ${releaseData.tag_name || 'latest'}`);

  // Download files
  console.log('\n📥 Downloading D9 node binary...');
  const downloadResult = await showProgress(
    `Downloading ${tarballAsset.name}...`,
    executeCommand('wget', ['-O', '/tmp/d9-node.tar.gz', tarballAsset.browser_download_url])
  );
  
  if (!downloadResult.success) {
    throw new Error(`Failed to download binary: ${downloadResult.error}`);
  }
  console.log(`✅ Downloaded binary (${(tarballAsset.size / 1024 / 1024).toFixed(1)} MB)`);
  
  console.log('\n📥 Downloading checksum file...');
  const hashResult = await showProgress(
    'Downloading checksum...',
    executeCommand('wget', ['-O', '/tmp/d9-node.tar.gz.sha256', hashAsset.browser_download_url])
  );
  
  if (!hashResult.success) {
    throw new Error(`Failed to download checksum: ${hashResult.error}`);
  }
  console.log('✅ Downloaded checksum');

  // Fix the checksum file format (remove filename part if it includes full path)
  console.log('🔧 Preparing checksum file...');
  const checksumContent = await Deno.readTextFile('/tmp/d9-node.tar.gz.sha256');
  const checksumHash = checksumContent.trim().split(/\s+/)[0];
  await Deno.writeTextFile('/tmp/d9-node.tar.gz.sha256', `${checksumHash}  d9-node.tar.gz\n`);

  // Verify integrity
  console.log('🔐 Verifying file integrity...');
  const hashCheck = await executeCommand('sh', ['-c', 'cd /tmp && sha256sum -c d9-node.tar.gz.sha256']);
  if (!hashCheck.success) {
    console.error('Hash verification output:', hashCheck.output);
    console.error('Hash verification error:', hashCheck.error);
    throw new Error('File integrity verification failed');
  }
  console.log('✅ Integrity check passed');

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
  await executeCommand('sudo', ['chmod', '+x', '/usr/local/bin/d9-node']);

  // Download chain spec
  console.log('\n📥 Downloading chain specification...');
  const specResult = await showProgress(
    'Downloading chain spec...',
    executeCommand('wget', [
      '-O', '/tmp/new-main-spec.json',
      'https://raw.githubusercontent.com/D-Nine-Chain/d9_node/main/new-main-spec.json'
    ])
  );
  
  if (!specResult.success) {
    throw new Error(`Failed to download chain spec: ${specResult.error}`);
  }
  console.log('✅ Chain specification downloaded');
  await executeCommand('sudo', ['mv', '/tmp/new-main-spec.json', '/usr/local/bin/']);

  // Create data directory
  console.log('📁 Creating data directory...');
  await executeCommand('sudo', ['mkdir', '-p', '/home/ubuntu/node-data']);
  await executeCommand('sudo', ['chown', '-R', 'ubuntu:ubuntu', '/home/ubuntu/node-data']);
  
  console.log('\n✅ D9 node installation completed successfully!\n');

  // Cleanup
  await executeCommand('rm', ['-f', '/tmp/d9-node.tar.gz', '/tmp/d9-node.tar.gz.sha256']);
}

async function configureNode(nodeType: NodeType, messages: Messages): Promise<void> {
  await createProgressBar(2000, messages.progress.configuring);

  const nodeName = await prompt('Enter a name for your node:') || 'D9-Node';

  // Create systemd service based on node type
  let serviceContent = `[Unit]
Description=D9 Node
After=network.target

[Service]
Type=simple
User=ubuntu
ExecStart=/usr/local/bin/d9-node \\
  --base-path /home/ubuntu/node-data \\
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
  await generateNodeKeys();
  
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

async function generateNodeKeys(): Promise<void> {
  const keystorePath = '/home/ubuntu/node-data/chains/d9_main/keystore';
  
  // Check if keys already exist
  try {
    const files = [];
    for await (const dirEntry of Deno.readDir(keystorePath)) {
      if (dirEntry.isFile && (
        dirEntry.name.startsWith('61757261') || // aura
        dirEntry.name.startsWith('6772616e') || // grandpa
        dirEntry.name.startsWith('696d6f6e')    // im_online
      )) {
        files.push(dirEntry.name);
      }
    }
    
    if (files.length >= 3) {
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

  // Generate seed phrase
  console.log('\n🔑 Generating seed phrase...');
  
  // First check if d9-node binary exists and is executable
  try {
    const stat = await Deno.stat('/usr/local/bin/d9-node');
    console.log('D9 node binary found:', stat.isFile);
  } catch (e) {
    throw new Error('D9 node binary not found at /usr/local/bin/d9-node');
  }
  
  // Try to generate seed with different command formats
  let seedResult = await executeCommand('/usr/local/bin/d9-node', [
    'key', 'generate', '--scheme', 'Sr25519', '--words', '12'
  ]);

  if (!seedResult.success) {
    console.error('First attempt failed:', seedResult.error);
    console.error('Output:', seedResult.output);
    
    // Try without words parameter
    console.log('Trying without --words parameter...');
    seedResult = await executeCommand('/usr/local/bin/d9-node', [
      'key', 'generate', '--scheme', 'Sr25519'
    ]);
    
    if (!seedResult.success) {
      console.error('Second attempt failed:', seedResult.error);
      
      // Try with equals format
      console.log('Trying with equals format...');
      seedResult = await executeCommand('/usr/local/bin/d9-node', [
        'key', 'generate', '--scheme=Sr25519'
      ]);
      
      if (!seedResult.success) {
        console.error('Third attempt failed:', seedResult.error);
        
        // Try just 'key generate' without parameters
        console.log('Trying minimal command...');
        seedResult = await executeCommand('/usr/local/bin/d9-node', [
          'key', 'generate'
        ]);
        
        if (!seedResult.success) {
          console.error('All attempts failed');
          console.error('Last error:', seedResult.error);
          console.error('Last output:', seedResult.output);
          
          // Show help to debug
          console.log('\nTrying to get help output...');
          const helpResult = await executeCommand('/usr/local/bin/d9-node', ['--help']);
          console.log('Help output:', helpResult.output);
          
          throw new Error('Failed to generate seed phrase - check d9-node binary compatibility');
        }
      }
    }
  }
  
  console.log('Seed generation output:', seedResult.output);

  const seedMatch = seedResult.output.match(/Secret phrase:\s+(.+)/);
  if (!seedMatch) {
    throw new Error('Could not extract seed phrase');
  }

  const seedPhrase = seedMatch[1].trim();
  console.log('\n🔑 IMPORTANT - Save this seed phrase:');
  console.log(`"${seedPhrase}"`);
  console.log('Press Enter when you have saved it...');
  await prompt('');

  // Insert keys
  const keyInsertCommands = [
    ['aura', seedPhrase],
    ['gran', `${seedPhrase}//grandpa`],
    ['imon', `${seedPhrase}//im_online`]
  ];

  for (const [keyType, suri] of keyInsertCommands) {
    const scheme = keyType === 'gran' ? 'Ed25519' : 'Sr25519';
    await executeCommand('/usr/local/bin/d9-node', [
      'key', 'insert',
      '--base-path', '/home/ubuntu/node-data',
      '--chain', '/usr/local/bin/new-main-spec.json',
      '--scheme', scheme,
      '--suri', suri,
      '--key-type', keyType
    ]);
  }

  // Restart service
  await systemctl('start', 'd9-node.service');
}

function prompt(message: string): Promise<string> {
  return new Promise((resolve) => {
    const input = globalThis.prompt(message);
    resolve(input || '');
  });
}