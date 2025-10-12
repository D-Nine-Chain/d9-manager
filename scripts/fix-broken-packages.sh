#!/bin/bash
# D9 Manager - Package State Recovery Script
# This script fixes broken dpkg/apt state caused by partial GLIBC upgrades

set -e

echo "🔧 D9 Manager Package State Recovery"
echo "======================================"
echo ""

# Check if running as root or with sudo
if [ "$EUID" -ne 0 ]; then
    echo "❌ This script must be run with sudo"
    echo "Usage: sudo bash fix-broken-packages.sh"
    exit 1
fi

# Backup current state
echo "📦 Creating backup of current package state..."
mkdir -p /root/d9-recovery-backup
cp /etc/apt/sources.list /root/d9-recovery-backup/ 2>/dev/null || true
cp -r /etc/apt/sources.list.d /root/d9-recovery-backup/ 2>/dev/null || true
cp -r /etc/apt/preferences.d /root/d9-recovery-backup/ 2>/dev/null || true
dpkg --get-selections > /root/d9-recovery-backup/package-selections.txt
echo "✅ Backup saved to /root/d9-recovery-backup/"
echo ""

# Detect current state
echo "🔍 Detecting package state..."
LIBC6_VERSION=$(dpkg -l | grep "^ii  libc6 " | awk '{print $3}' | head -n1)
LIBC_BIN_VERSION=$(dpkg -l | grep "^ii  libc-bin " | awk '{print $3}' | head -n1)

echo "Current libc6 version: $LIBC6_VERSION"
echo "Current libc-bin version: $LIBC_BIN_VERSION"
echo ""

# Check if testing repo exists
HAS_TESTING=false
if [ -f /etc/apt/sources.list.d/testing.list ]; then
    echo "⚠️  Found testing repository configuration"
    HAS_TESTING=true
fi

# Strategy 1: Try to upgrade libc-bin to match libc6
echo "📈 Strategy 1: Attempting to upgrade libc-bin to match libc6..."
echo ""

if [ "$HAS_TESTING" = true ]; then
    echo "Updating package lists..."
    apt-get update -qq 2>&1 | grep -v "^WARNING:" || true

    echo "Installing matching libc packages from testing..."
    if apt-get install -y -t testing libc-bin libc-dev-bin libc-l10n locales 2>&1; then
        echo "✅ Successfully upgraded libc-bin and related packages"

        # Configure any pending packages
        dpkg --configure -a

        # Fix any remaining broken dependencies
        apt-get install -f -y

        echo ""
        echo "✅ Package state fixed using upgrade strategy"
        echo ""
        echo "🧹 Cleaning up testing repository..."
        rm -f /etc/apt/sources.list.d/testing.list
        rm -f /etc/apt/preferences.d/libc6
        apt-get update -qq 2>&1 | grep -v "^WARNING:" || true

        echo "✅ Recovery complete!"
        exit 0
    else
        echo "⚠️  Upgrade strategy failed, trying downgrade..."
    fi
fi

# Strategy 2: Downgrade libc6 back to stable
echo ""
echo "📉 Strategy 2: Downgrading libc6 to stable version..."
echo ""

# Remove testing repository if present
if [ -f /etc/apt/sources.list.d/testing.list ]; then
    echo "Removing testing repository..."
    rm -f /etc/apt/sources.list.d/testing.list
    rm -f /etc/apt/preferences.d/libc6
fi

# Update package lists
echo "Updating package lists..."
apt-get update -qq 2>&1 | grep -v "^WARNING:" || true

# Get the stable version
STABLE_VERSION=$(apt-cache policy libc6 | grep "Candidate:" | awk '{print $2}')
echo "Target stable version: $STABLE_VERSION"
echo ""

# Downgrade libc6 and related packages
echo "Downgrading libc packages..."
if apt-get install -y --allow-downgrades \
    libc6="$STABLE_VERSION" \
    libc6-i386="$STABLE_VERSION" \
    libc6-dev="$STABLE_VERSION" \
    libc-bin="$STABLE_VERSION" \
    libc-dev-bin="$STABLE_VERSION" \
    libc-l10n="$STABLE_VERSION" \
    locales 2>&1; then

    echo "✅ Successfully downgraded to stable libc packages"

    # Configure any pending packages
    echo "Configuring packages..."
    dpkg --configure -a

    # Fix any remaining broken dependencies
    echo "Fixing dependencies..."
    apt-get install -f -y

    echo ""
    echo "✅ Package state fixed using downgrade strategy"
    echo ""
    echo "⚠️  Note: You may need to use the build-from-source script for D9 node:"
    echo "   curl -sSf https://raw.githubusercontent.com/D-Nine-Chain/d9-node/main/scripts/build-node.sh | bash"
    exit 0
else
    echo "❌ Downgrade failed"
fi

# Strategy 3: Nuclear option - force reconfigure
echo ""
echo "🚨 Strategy 3: Force reconfiguration..."
echo ""

# Hold problematic packages temporarily
apt-mark hold locales 2>/dev/null || true

# Try to fix with dpkg
echo "Running dpkg --configure -a..."
dpkg --configure -a 2>&1 || true

# Try to fix broken packages
echo "Running apt-get install -f..."
apt-get install -f -y 2>&1 || true

# Unhold packages
apt-mark unhold locales 2>/dev/null || true

# Final verification
echo ""
echo "🔍 Verifying package state..."
if dpkg -l | grep "^iU\|^iF" > /dev/null; then
    echo "❌ Some packages are still in inconsistent state"
    echo ""
    echo "Please contact support with the following information:"
    dpkg -l | grep "^iU\|^iF"
    exit 1
fi

echo "✅ Package state appears consistent"
echo ""
echo "✅ Recovery complete!"
echo ""
echo "📝 Next steps:"
echo "   1. Try running d9-manager again"
echo "   2. If GLIBC version is still < 2.38, use build-from-source script"
echo "   3. Restore from backup if needed: /root/d9-recovery-backup/"
