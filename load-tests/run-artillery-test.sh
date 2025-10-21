#!/bin/bash

# Artillery Load Testing Script for Telegram Bot
# Usage: ./run-artillery-test.sh [environment]
# Example: ./run-artillery-test.sh local

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

ENVIRONMENT=${1:-"local"}

# Load environment variables
if [ -f "../.env" ]; then
  echo -e "${BLUE}Loading environment from .env${NC}"
  export $(cat ../.env | grep -v '^#' | xargs)
fi

# Check if Artillery is installed
if ! command -v artillery &> /dev/null; then
  echo -e "${RED}Artillery is not installed${NC}"
  echo -e "${YELLOW}Install with: npm install -g artillery${NC}"
  exit 1
fi

# Create results directory
mkdir -p results
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Artillery Load Test${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "${BLUE}Environment:${NC} $ENVIRONMENT"
echo -e "${BLUE}Results:${NC} results/artillery_${ENVIRONMENT}_${TIMESTAMP}.json"
echo -e "${GREEN}========================================${NC}"
echo ""

# Run Artillery test
echo -e "${YELLOW}Starting load test...${NC}"
artillery run \
  --environment "$ENVIRONMENT" \
  --output "results/artillery_${ENVIRONMENT}_${TIMESTAMP}.json" \
  artillery-config.yml

# Generate HTML report
echo ""
echo -e "${YELLOW}Generating HTML report...${NC}"
artillery report "results/artillery_${ENVIRONMENT}_${TIMESTAMP}.json" \
  --output "results/artillery_${ENVIRONMENT}_${TIMESTAMP}.html"

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}✓ Load test completed${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${BLUE}JSON Report:${NC} results/artillery_${ENVIRONMENT}_${TIMESTAMP}.json"
echo -e "${BLUE}HTML Report:${NC} results/artillery_${ENVIRONMENT}_${TIMESTAMP}.html"
echo ""
echo -e "${YELLOW}Open HTML report in browser:${NC}"
echo -e "  open results/artillery_${ENVIRONMENT}_${TIMESTAMP}.html"
echo ""
