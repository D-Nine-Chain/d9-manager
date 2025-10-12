# Quick Fix for Broken Server

## Your Current Issue

```
E: dpkg was interrupted, you must manually run 'sudo dpkg --configure -a' to correct the problem.
```

## Immediate Fix (Copy-Paste These Commands)

### On Your Local Machine:

```bash
# Upload recovery script to remote server
scp scripts/fix-broken-packages.sh admin@testnet-transfer-oracle:~/
```

### On Remote Server (SSH In):

```bash
# Connect
ssh admin@testnet-transfer-oracle

# Run recovery
sudo bash ~/fix-broken-packages.sh

# Verify it worked
sudo apt update && echo "✅ SUCCESS"
```

## If Recovery Script Isn't Available Yet

Try this manual fix on the remote server:

```bash
# Strategy 1: Upgrade libc-bin to match libc6
sudo apt-get install -y -t testing libc-bin libc-dev-bin libc-l10n locales
sudo dpkg --configure -a
sudo apt-get install -f -y

# If Strategy 1 fails, try Strategy 2: Downgrade
sudo rm -f /etc/apt/sources.list.d/testing.list
sudo rm -f /etc/apt/preferences.d/libc6
sudo apt update
sudo apt-get install -y --allow-downgrades libc6 libc-bin libc6-i386 libc6-dev
sudo dpkg --configure -a
```

## After Fix

Re-run d9-manager setup:

```bash
cd d9-manager
make build
./build/d9-manager
```

## Setup Questions You'll See

1. Language: **English**
2. Install D9 node?: **Yes**
3. Have sudo access?: **Yes**
4. Setup new node with keys?: **Yes**
5. Node type: **Validator** (or Full/Archiver)
6. Continue?: **Yes**
7. Security mode: **Advanced** (recommended) or **Easy**
8. Node name: **Your choice** (e.g., "testnet-validator-1")
9. Generate new keys?: **Yes**

### If Advanced Mode:
10. Password: **(Your secure password, min 8 chars)**
11. Confirm password: **(Same password)**
12. **SAVE THE MNEMONIC SHOWN** - Write it down!
13. Confirm you saved it: **Yes**
14. Type 1 to confirm: **1**
15. Enter 3 random words from mnemonic: **(Check your written mnemonic)**

## Need Help?

See `RECOVERY.md` for detailed explanations.
