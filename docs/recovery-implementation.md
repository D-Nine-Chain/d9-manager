# Recovery Command Implementation Guide

This document provides the implementation specification for adding a `recovery` command to d9-manager. This command allows nodes to self-update their chain specs from GitHub releases.

## Overview

The recovery feature enables D9 node operators to:
1. Check for available chain spec updates
2. Apply new chain specs (which resets chain state)
3. View current recovery status

Chain specs are published to **`D-Nine-Chain/d9-chain-specs`** GitHub releases by network administrators using the admin CLI in `production-tools/recovery-cli`.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  production-tools/recovery-cli (Admin)                          │
│  └── d9-recovery publish                                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  D-Nine-Chain/d9-chain-specs (GitHub Releases)                  │
│  ├── mainnet-spec.json                                          │
│  └── testnet-spec.json                                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  d9-manager recovery apply --network mainnet                    │
│  (fetches from d9-chain-specs releases)                         │
└─────────────────────────────────────────────────────────────────┘
```

## Command Interface

### Check for Updates
```bash
d9-manager recovery check
```
Queries GitHub releases API to show available chain spec versions.

### Apply Recovery
```bash
# Apply latest version
d9-manager recovery apply --network mainnet --latest

# Apply specific version
d9-manager recovery apply --network mainnet --version v1.0.0

# With backup
d9-manager recovery apply --network mainnet --latest --backup
```

### Show Status
```bash
d9-manager recovery status
```
Shows current chain spec version and node state.

## Files to Create/Modify

### New Files

#### `src/commands/recovery.ts`
Main recovery command module with subcommands:
- `check` - List available releases
- `apply` - Download and apply chain spec
- `status` - Show current state

#### `src/utils/github.ts`
GitHub API utilities for fetching releases:
```typescript
interface Release {
  tag_name: string;
  name: string;
  published_at: string;
  assets: Asset[];
}

interface Asset {
  name: string;
  browser_download_url: string;
  size: number;
}

export async function getLatestRelease(owner: string, repo: string): Promise<Release>;
export async function getReleases(owner: string, repo: string): Promise<Release[]>;
export async function downloadAsset(url: string, destPath: string): Promise<void>;
```

#### `src/utils/checksum.ts`
SHA-256 verification utilities:
```typescript
export async function calculateSHA256(filePath: string): Promise<string>;
export async function verifyChecksum(filePath: string, expected: string): Promise<boolean>;
```

### Modifications

#### `src/main.ts`
Add recovery option to main menu:
```typescript
const action = await Select.prompt({
  message: "Select an option:",
  options: [
    // ... existing options ...
    { name: "🔄 Recovery/Update", value: "recovery" },
    // ...
  ],
});
```

#### `src/config/constants.ts`
Add recovery configuration:
```typescript
export const RECOVERY_CONFIG = {
  github: {
    owner: 'D-Nine-Chain',
    repo: 'd9-chain-specs',
  },
  networks: {
    mainnet: {
      specFile: '/home/ubuntu/d9_node/new-main-spec.json',
      dbPath: '/home/ubuntu/node-data/chains/d9_main/db/full',
      asset: 'mainnet-spec.json',
    },
    testnet: {
      specFile: '/home/ubuntu/d9_node/testnet-spec.json',
      dbPath: '/home/ubuntu/node-data/chains/d9_testnet/db/full',
      asset: 'testnet-spec.json',
    },
  },
  service: 'd9-node.service',
};
```

## Core Operations (Apply Command)

The `apply` subcommand performs these steps:

1. **Fetch release info** from GitHub API (`D-Nine-Chain/d9-chain-specs` releases)
2. **Download spec file** to temp location
3. **Verify checksum** (SHA-256 from `.sha256` file in release or release notes)
4. **Stop d9-node service**: `systemctl stop d9-node.service`
5. **Backup current spec** (if `--backup` flag provided)
6. **Delete database**: `rm -rf ~/node-data/chains/d9_main/db/full`
7. **Replace spec file**: Copy to appropriate location
8. **Start d9-node service**: `systemctl start d9-node.service`
9. **Verify service running**: Check systemctl status

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Network error (GitHub unreachable) |
| 3 | Checksum mismatch |
| 4 | Service stop failed |
| 5 | Service start failed |
| 10 | No updates available |

## Implementation Notes

### Runtime
Uses Deno (matches existing d9-manager). No additional package.json dependencies needed.

### Dependencies
- `https://deno.land/std/crypto/mod.ts` for SHA-256
- GitHub API via native fetch (no external dep needed)

### Mode
Unattended operation supported (no interactive prompts required, suitable for scripts/cron). Interactive mode for user-friendly operation.

### Security
- Always verify checksum before applying
- Backup option available for rollback
- Service management requires appropriate permissions (sudo)

## Testing

### Unit Tests
- GitHub API response parsing
- Checksum calculation and verification
- Config validation

### Integration Tests
- Full apply workflow on test network
- Service start/stop verification
- Rollback on failure

### Manual Testing
1. Generate chain spec with admin CLI
2. Publish to d9-chain-specs releases
3. Run `d9-manager recovery check`
4. Run `d9-manager recovery apply --network testnet --latest`
5. Verify node starts with new spec

## Related Repositories

- **d9-chain-specs**: https://github.com/D-Nine-Chain/d9-chain-specs - Hosts chain spec releases
- **production-tools/recovery-cli**: Admin CLI for generating and publishing specs

## Related Issues

- GitHub Issue #1: "Add recovery command for chain state updates"
- Project: https://github.com/orgs/D-Nine-Chain/projects/6
