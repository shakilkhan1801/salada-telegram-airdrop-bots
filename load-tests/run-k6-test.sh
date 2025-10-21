#!/bin/bash

# K6 Load Testing Script for Telegram Bot
# Usage: ./run-k6-test.sh [test-type] [environment]
# Example: ./run-k6-test.sh start-command local

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
TEST_TYPE=${1:-"start-command"}
ENVIRONMENT=${2:-"local"}

# Load environment variables
if [ -f "../.env" ]; then
  echo -e "${BLUE}Loading environment from .env${NC}"
  export $(cat ../.env | grep -v '^#' | xargs)
fi

# Set URLs based on environment
case $ENVIRONMENT in
  local)
    export BASE_URL="http://localhost:3001"
    export MINIAPP_URL="http://localhost:3004"
    ;;
  staging)
    export BASE_URL="${STAGING_URL:-http://staging.yourdomain.com}"
    export MINIAPP_URL="${STAGING_MINIAPP_URL:-http://staging.yourdomain.com:3004}"
    ;;
  production)
    echo -e "${RED}WARNING: Running load test against PRODUCTION${NC}"
    read -p "Are you sure? (yes/no): " confirm
    if [ "$confirm" != "yes" ]; then
      echo "Aborted"
      exit 1
    fi
    export BASE_URL="${PRODUCTION_URL}"
    export MINIAPP_URL="${PRODUCTION_MINIAPP_URL}"
    ;;
  *)
    echo -e "${RED}Invalid environment: $ENVIRONMENT${NC}"
    echo "Valid options: local, staging, production"
    exit 1
    ;;
esac

# Check if K6 is installed
if ! command -v k6 &> /dev/null; then
  echo -e "${RED}K6 is not installed${NC}"
  echo -e "${YELLOW}Install with: brew install k6 (macOS) or snap install k6 (Linux)${NC}"
  exit 1
fi

# Check if server is reachable
echo -e "${BLUE}Checking server health...${NC}"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/health" || echo "000")
if [ "$HTTP_CODE" != "200" ]; then
  echo -e "${RED}Server is not reachable (HTTP $HTTP_CODE)${NC}"
  echo "URL: $BASE_URL/health"
  exit 1
fi
echo -e "${GREEN}✓ Server is healthy${NC}"

# Select test script
case $TEST_TYPE in
  start-command)
    TEST_SCRIPT="k6-start-command.js"
    ;;
  full-flow)
    TEST_SCRIPT="k6-full-user-flow.js"
    ;;
  *)
    echo -e "${RED}Invalid test type: $TEST_TYPE${NC}"
    echo "Valid options: start-command, full-flow"
    exit 1
    ;;
esac

# Create results directory
mkdir -p results
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
RESULT_FILE="results/${TEST_TYPE}_${ENVIRONMENT}_${TIMESTAMP}.json"

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}K6 Load Test${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "${BLUE}Test Type:${NC} $TEST_TYPE"
echo -e "${BLUE}Environment:${NC} $ENVIRONMENT"
echo -e "${BLUE}Target URL:${NC} $BASE_URL"
echo -e "${BLUE}Bot Token:${NC} ${BOT_TOKEN:0:10}..."
echo -e "${BLUE}Script:${NC} $TEST_SCRIPT"
echo -e "${BLUE}Results:${NC} $RESULT_FILE"
echo -e "${GREEN}========================================${NC}"
echo ""

# Run K6 test
echo -e "${YELLOW}Starting load test...${NC}"
k6 run \
  --out json="$RESULT_FILE" \
  --summary-export="results/summary_${TIMESTAMP}.json" \
  "$TEST_SCRIPT"

EXIT_CODE=$?

# Check results
if [ $EXIT_CODE -eq 0 ]; then
  echo ""
  echo -e "${GREEN}========================================${NC}"
  echo -e "${GREEN}✓ Load test completed successfully${NC}"
  echo -e "${GREEN}========================================${NC}"
  echo ""
  echo -e "${BLUE}Results saved to:${NC} $RESULT_FILE"
  echo ""
  
  # Show quick summary
  if [ -f "results/summary_${TIMESTAMP}.json" ]; then
    echo -e "${YELLOW}Quick Summary:${NC}"
    cat "results/summary_${TIMESTAMP}.json" | jq '.metrics | {
      "Total Requests": .http_reqs.values.count,
      "Failed Requests": (.http_req_failed.values.rate * 100 | tostring + "%"),
      "Avg Response Time": (.http_req_duration.values.avg | tostring + "ms"),
      "P95 Response Time": (.http_req_duration.values["p(95)"] | tostring + "ms"),
      "P99 Response Time": (.http_req_duration.values["p(99)"] | tostring + "ms")
    }'
  fi
else
  echo ""
  echo -e "${RED}========================================${NC}"
  echo -e "${RED}✗ Load test failed (exit code: $EXIT_CODE)${NC}"
  echo -e "${RED}========================================${NC}"
  echo ""
  exit $EXIT_CODE
fi
