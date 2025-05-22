import { Select, Confirm } from '@cliffy/prompt';
import { NodeType, Messages } from '../types.ts';
import { checkDiskSpace, executeCommand, createProgressBar, systemctl } from '../utils/system.ts';

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
  
  console.log(`✅ ${messages.progress.complete}`);
}

async function installD9Node(messages: Messages): Promise<void> {
  await createProgressBar(3000, messages.progress.installing);
  
  // Download and install D9 node (similar to your bash script logic)
  const commands: [string, string[]][] = [
    // Check system requirements
    ['uname', ['-m']],
    // Update system
    ['sudo', ['apt', 'update', '-qq']],
    ['sudo', ['apt', 'install', '-y', '-qq', 'curl', 'jq', 'wget']],
  ];

  for (const [cmd, args] of commands) {
    const result = await executeCommand(cmd, args);
    if (!result.success) {
      throw new Error(`Failed to execute: ${cmd} ${args.join(' ')}`);
    }
  }

  // Download latest release
  const releaseResult = await executeCommand('curl', [
    '-s', 
    'https://api.github.com/repos/D-Nine-Chain/d9_node/releases/latest'
  ]);
  
  if (!releaseResult.success) {
    throw new Error('Failed to fetch latest release info');
  }

  // Parse and download
  const releaseData = JSON.parse(releaseResult.output);
  const tarballAsset = releaseData.assets.find((asset: any) => asset.name.endsWith('.tar.gz'));
  const hashAsset = releaseData.assets.find((asset: any) => asset.name.endsWith('.sha256'));

  if (!tarballAsset || !hashAsset) {
    throw new Error('Release assets not found');
  }

  // Download files
  await executeCommand('wget', ['-O', '/tmp/d9-node.tar.gz', tarballAsset.browser_download_url]);
  await executeCommand('wget', ['-O', '/tmp/d9-node.tar.gz.sha256', hashAsset.browser_download_url]);

  // Verify integrity
  const hashCheck = await executeCommand('cd', ['/tmp', '&&', 'sha256sum', '-c', 'd9-node.tar.gz.sha256']);
  if (!hashCheck.success) {
    throw new Error('File integrity verification failed');
  }

  // Extract and install
  await executeCommand('tar', ['-xzf', '/tmp/d9-node.tar.gz', '-C', '/tmp']);
  await executeCommand('sudo', ['mv', '/tmp/d9-node', '/usr/local/bin/']);
  await executeCommand('sudo', ['chmod', '+x', '/usr/local/bin/d9-node']);

  // Download chain spec
  await executeCommand('wget', [
    '-O', '/tmp/new-main-spec.json',
    'https://raw.githubusercontent.com/D-Nine-Chain/d9_node/main/new-main-spec.json'
  ]);
  await executeCommand('sudo', ['mv', '/tmp/new-main-spec.json', '/usr/local/bin/']);

  // Create data directory
  await executeCommand('sudo', ['mkdir', '-p', '/home/ubuntu/node-data']);
  await executeCommand('sudo', ['chown', '-R', 'ubuntu:ubuntu', '/home/ubuntu/node-data']);

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
  
  await executeCommand('sudo', ['systemctl', 'start', 'd9-node.service']);
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
  await systemctl('stop', 'd9-node.service');

  // Generate seed phrase
  const seedResult = await executeCommand('/usr/local/bin/d9-node', [
    'key', 'generate', '--scheme', 'Sr25519', '--words', '12'
  ]);

  if (!seedResult.success) {
    throw new Error('Failed to generate seed phrase');
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