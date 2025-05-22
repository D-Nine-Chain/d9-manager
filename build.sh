#!/bin/bash

# Build script for D9 Manager
# This script builds the binary for distribution

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🔨 Building D9 Manager${NC}"
echo "═══════════════════════════"

# Check if Deno is installed
if ! command -v deno &> /dev/null; then
    echo -e "${RED}❌ Deno is not installed. Please install Deno first:${NC}"
    echo -e "${YELLOW}curl -fsSL https://deno.land/install.sh | sh${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Deno found: $(deno --version | head -n1)${NC}"

# Create dist directory
mkdir -p dist

echo -e "${YELLOW}📦 Compiling binary...${NC}"

# Compile the binary (using --no-check to avoid import assertion warnings)
deno compile \
  --allow-all \
  --no-check \
  --output ./dist/d9-manager \
  src/main.ts

# Make executable
chmod +x ./dist/d9-manager

echo -e "${GREEN}✅ Build complete!${NC}"
echo -e "${BLUE}📁 Binary location: ./dist/d9-manager${NC}"
echo -e "${BLUE}📏 File size: $(du -h ./dist/d9-manager | cut -f1)${NC}"

echo ""
echo -e "${YELLOW}📋 Next steps:${NC}"
echo "1. Test the binary: ./dist/d9-manager"
echo "2. Upload to GitHub releases"
echo "3. Users can download with:"
echo -e "${GREEN}   curl -L -o d9-manager https://github.com/YOUR_USERNAME/d9-manager/releases/latest/download/d9-manager${NC}"
echo -e "${GREEN}   chmod +x d9-manager${NC}"
echo -e "${GREEN}   sudo mv d9-manager /usr/local/bin/${NC}"