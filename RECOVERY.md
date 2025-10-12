# D9 Manager - Package State Recovery Guide

This guide helps you recover from broken package states caused by interrupted GLIBC upgrades.

## Quick Recovery for Broken Remote Server

If you're seeing this error:
```
E: dpkg was interrupted, you must manually run 'sudo dpkg --configure -a' to correct the problem.
```

### Step 1: Upload and Run Recovery Script

On your **local machine**, upload the recovery script to your remote server:

```bash
# From your local d9-manager directory
scp scripts/fix-broken-packages.sh admin@testnet-transfer-oracle:~/
```

Then **on the remote server**:

```bash
# Connect to server
ssh admin@testnet-transfer-oracle

# Run recovery script
sudo bash ~/fix-broken-packages.sh
```

The script will:
1. Backup your current package state
2. Attempt to upgrade all libc packages together
3. If that fails, downgrade to stable versions
4. Fix any remaining broken dependencies

### Step 2: Verify Recovery

After the script completes, verify the package state:

```bash
# Check for broken packages
dpkg -l | grep "^iU\|^iF"

# Should return nothing if successful

# Test apt
sudo apt update
sudo apt install -y curl jq wget
```

### Step 3: Re-run D9 Manager Setup

Once recovery is complete, you can re-run d9-manager:

```bash
# If you have the binary
d9-manager

# Or build and run from source
cd d9-manager
make build
./build/d9-manager
```

## What Was Fixed

The improved d9-manager now includes:

### 1. Pre-flight Package Checks
Before starting installation, d9-manager checks for:
- Broken package states
- Running apt/dpkg processes
- Inconsistent package versions

### 2. Atomic GLIBC Upgrades
When upgrading GLIBC, all related packages are upgraded together:
- `libc6`, `libc6-dev`, `libc-bin`, `libc-dev-bin`
- `libc-l10n`, `locales` (on Debian)

This prevents partial upgrades that break the system.

### 3. Automatic Rollback
If the upgrade fails, testing repositories are automatically removed and the system is restored to its previous state.

### 4. Automatic Cleanup
After successful GLIBC upgrade, testing repositories are removed to prevent future conflicts.

## Manual Recovery (If Script Fails)

If the automated recovery script fails, try these steps manually:

### Option 1: Upgrade libc-bin to Match libc6

```bash
# Check versions
dpkg -l | grep libc

# If testing repo exists, use it
sudo apt-get install -y -t testing libc-bin libc-dev-bin libc-l10n locales

# Fix remaining issues
sudo dpkg --configure -a
sudo apt-get install -f -y
```

### Option 2: Downgrade libc6 to Stable

```bash
# Remove testing repositories
sudo rm -f /etc/apt/sources.list.d/testing.list
sudo rm -f /etc/apt/preferences.d/libc6
sudo apt update

# Get stable version
STABLE_VERSION=$(apt-cache policy libc6 | grep "Candidate:" | awk '{print $2}')

# Downgrade all libc packages
sudo apt-get install -y --allow-downgrades \
    libc6="$STABLE_VERSION" \
    libc6-i386="$STABLE_VERSION" \
    libc6-dev="$STABLE_VERSION" \
    libc-bin="$STABLE_VERSION" \
    libc-dev-bin="$STABLE_VERSION" \
    libc-l10n="$STABLE_VERSION" \
    locales

# Fix remaining issues
sudo dpkg --configure -a
sudo apt-get install -f -y
```

### Option 3: Nuclear Option (Last Resort)

```bash
# Hold problematic packages temporarily
sudo apt-mark hold locales

# Force reconfigure
sudo dpkg --configure -a || true
sudo apt-get install -f -y || true

# Unhold
sudo apt-mark unhold locales

# Try again
sudo dpkg --configure -a
sudo apt-get install -f -y
```

## Prevention

The new version of d9-manager prevents these issues by:

1. **Checking system health** before any apt operations
2. **Installing packages atomically** (all-or-nothing)
3. **Rolling back on failure** automatically
4. **Cleaning up** test repositories after success

## Setup Flow Answers

When running d9-manager setup, you'll be asked:

1. **Language**: English / 中文
2. **Node Type**: Full / Validator / Archiver
3. **Continue?**: Yes
4. **Security Mode**:
   - **Easy**: Single seed phrase (simpler, less secure)
   - **Advanced**: HD key derivation with password (recommended)
   - **Legacy**: For existing installations
5. **Node Name**: e.g., "My-D9-Validator"
6. **Generate keys?**: Yes

If you choose **Advanced Mode**:
7. **Password**: (min 8 characters)
8. **Confirm password**
9. **Save root mnemonic**: You must write this down
10. **Confirm understanding**: Type "1"
11. **Verify backup**: Enter 3 random words from mnemonic

## Support

If you continue to have issues:

1. Save the output of:
   ```bash
   dpkg -l | grep libc > package-state.txt
   cat /etc/apt/sources.list.d/* > sources.txt
   ```

2. Create a GitHub issue with:
   - Error messages
   - `package-state.txt` and `sources.txt`
   - Your OS version (`cat /etc/os-release`)

## Build From Source Alternative

If package-based installation continues to fail, use the build-from-source method:

```bash
curl -sSf https://raw.githubusercontent.com/D-Nine-Chain/d9-node/main/scripts/build-node.sh | bash
```

This compiles d9-node locally, bypassing GLIBC version issues.
