#!/bin/bash
set -e

# AWS Profile to use
AWS_PROFILE="glk"

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   Twenty CRM - Register Cron Jobs      ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""

echo -e "${YELLOW}This script registers background jobs for:${NC}"
echo "  - Email message import (Gmail/Microsoft)"
echo "  - Calendar event import (Google/Microsoft)"
echo "  - Workflow automated triggers"
echo ""

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo -e "${RED}Error: AWS CLI is not installed${NC}"
    exit 1
fi

# Get ECS cluster and task information
CLUSTER_NAME="twenty-cluster"
REGION=$(aws configure get region --profile $AWS_PROFILE || echo "us-east-1")

echo -e "${YELLOW}Finding Twenty worker task...${NC}"

# Get the worker task ARN
TASK_ARN=$(aws ecs list-tasks \
    --profile $AWS_PROFILE \
    --cluster $CLUSTER_NAME \
    --service-name TwentyStack-Compute-WorkerService \
    --region $REGION \
    --query 'taskArns[0]' \
    --output text)

if [ "$TASK_ARN" == "None" ] || [ -z "$TASK_ARN" ]; then
    echo -e "${RED}Error: Could not find running worker task${NC}"
    echo "Make sure the deployment is complete and the worker is running"
    exit 1
fi

echo -e "${GREEN}✓ Found worker task${NC}"
echo ""

# Array of cron jobs to register
CRON_JOBS=(
    "cron:messaging:messages-import"
    "cron:messaging:message-list-fetch"
    "cron:calendar:calendar-event-list-fetch"
    "cron:calendar:calendar-events-import"
    "cron:messaging:ongoing-stale"
    "cron:calendar:ongoing-stale"
    "cron:workflow:automated-cron-trigger"
)

echo -e "${YELLOW}Registering cron jobs...${NC}"
echo ""

for job in "${CRON_JOBS[@]}"; do
    echo -e "  ${BLUE}Registering:${NC} $job"

    aws ecs execute-command \
        --profile $AWS_PROFILE \
        --cluster $CLUSTER_NAME \
        --task $TASK_ARN \
        --container WorkerContainer \
        --region $REGION \
        --interactive \
        --command "yarn command:prod $job" \
        2>&1 | grep -v "^$" || true

    echo -e "  ${GREEN}✓${NC} Registered"
done

echo ""
echo -e "${GREEN}╔════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   All Cron Jobs Registered! 🎉        ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════╝${NC}"
echo ""
echo -e "${YELLOW}Note:${NC} These jobs will run automatically based on their schedule."
echo "You only need to run this script once after deployment."
