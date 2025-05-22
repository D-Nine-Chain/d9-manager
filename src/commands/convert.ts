import { Select, Confirm } from '@cliffy/prompt';
import { NodeType, Messages } from '../types.ts';
import { checkDiskSpace, createProgressBar, systemctl, executeCommand } from '../utils/system.ts';

export async function convertNode(messages: Messages): Promise<void> {
  console.log('\n' + messages.convertNode);
  
  // Check current node configuration
  const currentConfig = await getCurrentNodeConfiguration();
  console.log(`\n📊 Current configuration: ${currentConfig.type}`);
  console.log(`Validator mode: ${currentConfig.isValidator ? '✅' : '❌'}`);
  console.log(`Archive mode: ${currentConfig.isArchive ? '✅' : '❌'}`);

  // Select new configuration
  const newNodeType = await Select.prompt<NodeType>({
    message: 'Convert to which node type?',
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

  // Check if conversion is needed
  if (currentConfig.type === newNodeType) {
    console.log('ℹ️  Node is already configured as ' + newNodeType);
    return;
  }

  // Check disk space requirements
  const requiredSpace = newNodeType === NodeType.ARCHIVER ? 120 : 60;
  const hasSpace = await checkDiskSpace(requiredSpace);
  
  if (!hasSpace) {
    console.log(`❌ ${messages.errors.diskSpace}`);
    console.log(`Required: ${requiredSpace}GB`);
    return;
  }

  // Show conversion details
  const selectedType = messages.nodeTypes[newNodeType as keyof typeof messages.nodeTypes];
  console.log(`\n📋 Converting to: ${selectedType.name}`);
  console.log(`${selectedType.description}`);
  console.log(`${selectedType.requirements}\n`);

  const confirm = await Confirm.prompt('Proceed with conversion?');
  if (!confirm) {
    return;
  }

  try {
    await performConversion(newNodeType as NodeType, messages);
    
    // If converting to validator, ask about candidacy
    if (newNodeType === NodeType.VALIDATOR) {
      const submitCandidacy = await Confirm.prompt('Would you like to submit validator candidacy now?');
      if (submitCandidacy) {
        const { submitCandidacy: submitCandidacyCommand } = await import('./candidacy.ts');
        await submitCandidacyCommand(messages);
      }
    }
    
    console.log(`✅ ${messages.progress.complete}`);
    console.log('\n📊 Node has been converted successfully!');
    console.log('🔍 Check status: journalctl -u d9-node.service -f');
    
  } catch (error) {
    console.log(`❌ Conversion failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

interface NodeConfiguration {
  type: NodeType;
  isValidator: boolean;
  isArchive: boolean;
}

async function getCurrentNodeConfiguration(): Promise<NodeConfiguration> {
  try {
    const serviceContent = await Deno.readTextFile('/etc/systemd/system/d9-node.service');
    
    const isValidator = serviceContent.includes('--validator');
    const isArchive = serviceContent.includes('--pruning archive');
    
    let type: NodeType;
    if (isValidator) {
      type = NodeType.VALIDATOR;
    } else if (isArchive) {
      type = NodeType.ARCHIVER;
    } else {
      type = NodeType.FULL;
    }
    
    return { type, isValidator, isArchive };
  } catch {
    // Default if service file doesn't exist
    return { type: NodeType.FULL, isValidator: false, isArchive: false };
  }
}

async function performConversion(nodeType: NodeType, messages: Messages): Promise<void> {
  await createProgressBar(1000, 'Stopping node...');
  
  // Stop the service
  const stopped = await systemctl('stop', 'd9-node.service');
  if (!stopped) {
    throw new Error('Failed to stop node service');
  }

  await createProgressBar(2000, messages.progress.configuring);

  // Read current service configuration
  let serviceContent: string;
  try {
    serviceContent = await Deno.readTextFile('/etc/systemd/system/d9-node.service');
  } catch {
    throw new Error('Service file not found. Please run setup first.');
  }

  // Extract node name from current config
  const nameMatch = serviceContent.match(/--name\s+"([^"]+)"/);
  const nodeName = nameMatch ? nameMatch[1] : 'D9-Node';

  // Create new service configuration
  let newServiceContent = `[Unit]
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

  // Add type-specific flags
  switch (nodeType) {
    case NodeType.VALIDATOR:
      newServiceContent += ' \\\n  --validator';
      break;
    case NodeType.ARCHIVER:
      newServiceContent += ' \\\n  --pruning archive';
      break;
    default: // FULL
      newServiceContent += ' \\\n  --pruning 1000';
  }

  newServiceContent += `

Restart=on-failure

[Install]
WantedBy=multi-user.target
`;

  // Write new service file
  await Deno.writeTextFile('/tmp/d9-node.service', newServiceContent);
  const moveResult = await executeCommand('sudo', ['mv', '/tmp/d9-node.service', '/etc/systemd/system/d9-node.service']);
  
  if (!moveResult.success) {
    throw new Error('Failed to update service configuration');
  }

  // Reload systemd
  const reloadResult = await executeCommand('sudo', ['systemctl', 'daemon-reload']);
  if (!reloadResult.success) {
    throw new Error('Failed to reload systemd');
  }

  await createProgressBar(1000, 'Starting node...');

  // Start the service
  const started = await systemctl('start', 'd9-node.service');
  if (!started) {
    throw new Error('Failed to start node service');
  }

  // Verify service is running
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  const statusResult = await executeCommand('sudo', ['systemctl', 'is-active', 'd9-node.service']);
  if (!statusResult.success || !statusResult.output.includes('active')) {
    console.log('⚠️  Service may not be running properly. Check logs:');
    console.log('journalctl -u d9-node.service -n 20');
  }
}