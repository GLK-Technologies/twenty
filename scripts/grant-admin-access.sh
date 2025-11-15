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
echo -e "${BLUE}║   Twenty CRM - Grant Admin Access     ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""

# Check if email provided
if [ -z "$1" ]; then
    echo -e "${RED}Error: Email address required${NC}"
    echo ""
    echo "Usage: $0 <email@domain.com>"
    echo ""
    echo "Example:"
    echo "  $0 admin@skillfaber.com"
    exit 1
fi

USER_EMAIL="$1"

echo -e "${YELLOW}Granting admin panel access to: ${NC}$USER_EMAIL"
echo ""

# Get ECS cluster and task information
CLUSTER_NAME="twenty-cluster"
REGION=$(aws configure get region --profile $AWS_PROFILE || echo "us-east-1")

echo -e "${YELLOW}Finding Twenty server task...${NC}"

# Get the server task ARN
TASK_ARN=$(aws ecs list-tasks \
    --profile $AWS_PROFILE \
    --cluster $CLUSTER_NAME \
    --service-name TwentyStack-Compute-ServerService \
    --region $REGION \
    --query 'taskArns[0]' \
    --output text)

if [ "$TASK_ARN" == "None" ] || [ -z "$TASK_ARN" ]; then
    echo -e "${RED}Error: Could not find running server task${NC}"
    echo "Make sure the deployment is complete and the server is running"
    exit 1
fi

echo -e "${GREEN}✓ Found server task${NC}"
echo ""

# SQL query to grant admin access
SQL_QUERY="UPDATE core.\\\"user\\\" SET \\\"canAccessFullAdminPanel\\\" = TRUE WHERE email = '$USER_EMAIL';"

echo -e "${YELLOW}Executing SQL query...${NC}"
echo -e "${BLUE}SQL:${NC} $SQL_QUERY"
echo ""

# Get database connection details from secrets
DB_URL_SECRET=$(aws secretsmanager get-secret-value \
    --profile $AWS_PROFILE \
    --region $REGION \
    --secret-id twenty/database/connection-url \
    --query 'SecretString' \
    --output text)

# Execute the query via ECS exec
aws ecs execute-command \
    --profile $AWS_PROFILE \
    --cluster $CLUSTER_NAME \
    --task $TASK_ARN \
    --container ServerContainer \
    --region $REGION \
    --interactive \
    --command "psql \"$DB_URL_SECRET\" -c \"$SQL_QUERY\"" \
    2>&1 | grep -v "^$" || true

echo ""
echo -e "${GREEN}╔════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   Admin Access Granted! 🎉             ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════╝${NC}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "  1. Log out of Twenty if currently logged in"
echo "  2. Log back in with: $USER_EMAIL"
echo "  3. Go to Settings → Admin Panel"
echo "  4. You should now see the Configuration Variables section"
echo ""
