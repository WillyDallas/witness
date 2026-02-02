#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Witness Protocol Clean Deploy ===${NC}"

# Check we're in the right directory
if [ ! -f ".env" ]; then
    echo -e "${RED}Error: .env not found. Run from project root.${NC}"
    exit 1
fi

# Load environment variables
export $(grep -v '^#' .env | grep -v '^$' | xargs)

# Step 1: Deploy contract
echo -e "\n${YELLOW}[1/4] Deploying WitnessRegistry to Base Sepolia...${NC}"
cd contracts
forge script script/DeployWitnessRegistry.s.sol:DeployWitnessRegistry \
    --rpc-url base-sepolia --broadcast -v

# Extract new address and block from broadcast logs
BROADCAST_FILE="broadcast/DeployWitnessRegistry.s.sol/84532/run-latest.json"
if [ ! -f "$BROADCAST_FILE" ]; then
    echo -e "${RED}Error: Broadcast file not found${NC}"
    exit 1
fi

NEW_ADDRESS=$(jq -r '.transactions[0].contractAddress' "$BROADCAST_FILE")
BLOCK_HEX=$(jq -r '.receipts[0].blockNumber' "$BROADCAST_FILE")
NEW_BLOCK=$((BLOCK_HEX))

echo -e "${GREEN}Contract deployed: ${NEW_ADDRESS}${NC}"
echo -e "${GREEN}Deploy block: ${NEW_BLOCK}${NC}"

cd ..

# Step 2: Update .env
echo -e "\n${YELLOW}[2/4] Updating .env with new contract address...${NC}"
OLD_ADDRESS=$(grep "^VITE_WITNESS_REGISTRY_ADDRESS=" .env | cut -d'=' -f2)

# Update the address and block
sed -i.bak "s|^VITE_WITNESS_REGISTRY_ADDRESS=.*|VITE_WITNESS_REGISTRY_ADDRESS=${NEW_ADDRESS}|" .env
sed -i.bak "s|^VITE_WITNESS_REGISTRY_DEPLOY_BLOCK=.*|VITE_WITNESS_REGISTRY_DEPLOY_BLOCK=${NEW_BLOCK}|" .env
sed -i.bak "s|^DEPRECATED_VITE_WITNESS_REGISTRY_ADDRESS=.*|DEPRECATED_VITE_WITNESS_REGISTRY_ADDRESS=${OLD_ADDRESS}|" .env
rm -f .env.bak

echo -e "${GREEN}.env updated${NC}"

# Step 3: Build PWA
echo -e "\n${YELLOW}[3/4] Building PWA...${NC}"
cd witness-pwa
npm run build
cd ..

# Step 4: Deploy to server
echo -e "\n${YELLOW}[4/4] Deploying to server...${NC}"
rsync -avz witness-pwa/dist/ root@46.62.231.168:/var/www/witness/

echo -e "\n${GREEN}=== Deploy Complete ===${NC}"
echo -e "Contract: ${NEW_ADDRESS}"
echo -e "Block: ${NEW_BLOCK}"
echo -e "URL: https://witness.squirrlylabs.xyz"

# Optional: Start verification in background
echo -e "\n${YELLOW}Starting contract verification (background)...${NC}"
cd contracts
forge verify-contract "$NEW_ADDRESS" src/WitnessRegistry.sol:WitnessRegistry \
    --chain base-sepolia \
    --constructor-args $(cast abi-encode "constructor(address)" 0x8A1fd199516489B0Fb7153EB5f075cDAC83c693D) \
    --watch &
cd ..

echo -e "${GREEN}Done! Verification running in background.${NC}"
