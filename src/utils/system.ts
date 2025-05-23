import { SystemInfo } from '../types.ts';

export async function checkSystemRequirements(): Promise<SystemInfo> {
  const info: SystemInfo = {
    diskSpace: 0,
    architecture: '',
    hasD9Binary: false
  };

  // Check architecture
  const archProcess = new Deno.Command('uname', { args: ['-m'] });
  const archResult = await archProcess.output();
  info.architecture = new TextDecoder().decode(archResult.stdout).trim();

  // Check disk space (in GB)
  const dfProcess = new Deno.Command('df', { args: ['/', '--block-size=1G'] });
  const dfResult = await dfProcess.output();
  const dfOutput = new TextDecoder().decode(dfResult.stdout);
  const lines = dfOutput.split('\n');
  if (lines.length > 1) {
    const columns = lines[1].split(/\s+/);
    info.diskSpace = parseInt(columns[3]) || 0;
  }

  // Check for D9 binary
  const binaryPaths = [
    '/usr/local/bin/d9-node',
    '/home/ubuntu/d9_node/target/release/d9-node'
  ];

  for (const path of binaryPaths) {
    try {
      const stat = await Deno.stat(path);
      if (stat.isFile) {
        info.hasD9Binary = true;
        info.binaryPath = path;
        break;
      }
    } catch {
      // File doesn't exist, continue checking
    }
  }

  return info;
}

export async function checkDiskSpace(required: number): Promise<boolean> {
  const info = await checkSystemRequirements();
  return info.diskSpace >= required;
}

export async function executeCommand(command: string, args: string[]): Promise<{ success: boolean; output: string; error?: string }> {
  try {
    const process = new Deno.Command(command, { 
      args,
      stdout: "piped",
      stderr: "piped"
    });
    const result = await process.output();
    
    const output = new TextDecoder().decode(result.stdout);
    const errorOutput = new TextDecoder().decode(result.stderr);
    
    return {
      success: result.code === 0,
      output: output + (errorOutput ? '\n' + errorOutput : ''),
      error: result.code !== 0 ? errorOutput || 'Command failed' : undefined
    };
  } catch (error) {
    return {
      success: false,
      output: '',
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function systemctl(action: string, service: string): Promise<boolean> {
  const result = await executeCommand('sudo', ['systemctl', action, service]);
  return result.success;
}

export async function createProgressBar(duration: number, message: string): Promise<void> {
  const steps = 20;
  const stepDuration = duration / steps;
  
  console.log(message);
  
  for (let i = 0; i <= steps; i++) {
    const progress = '█'.repeat(i) + '░'.repeat(steps - i);
    const percentage = Math.round((i / steps) * 100);
    
    // Clear line and write progress
    Deno.stdout.writeSync(new TextEncoder().encode(`\r[${progress}] ${percentage}%`));
    
    if (i < steps) {
      await new Promise(resolve => setTimeout(resolve, stepDuration));
    }
  }
  
  console.log('\n');
}

export async function showProgress<T>(message: string, promise: Promise<T>): Promise<T> {
  // Simple progress indicator using dots
  const encoder = new TextEncoder();
  Deno.stdout.writeSync(encoder.encode(`${message}`));
  
  const interval = setInterval(() => {
    Deno.stdout.writeSync(encoder.encode('.'));
  }, 500);
  
  try {
    const result = await promise;
    clearInterval(interval);
    Deno.stdout.writeSync(encoder.encode(' ✓\n'));
    return result;
  } catch (error) {
    clearInterval(interval);
    Deno.stdout.writeSync(encoder.encode(' ✗\n'));
    throw error;
  }
}