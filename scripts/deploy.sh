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
echo -e "${BLUE}║   Twenty CRM AWS Deployment Script    ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""

# Check prerequisites
echo -e "${YELLOW}Checking prerequisites...${NC}"

if ! command -v node &> /dev/null; then
    echo -e "${RED}Error: Node.js is not installed${NC}"
    exit 1
fi

if ! command -v npm &> /dev/null; then
    echo -e "${RED}Error: npm is not installed${NC}"
    exit 1
fi

if ! command -v aws &> /dev/null; then
    echo -e "${RED}Error: AWS CLI is not installed${NC}"
    exit 1
fi

# Check AWS credentials for the glk profile
if ! aws sts get-caller-identity --profile $AWS_PROFILE &> /dev/null; then
    echo -e "${RED}Error: AWS profile '$AWS_PROFILE' not configured${NC}"
    echo "Please run: aws configure --profile $AWS_PROFILE"
    exit 1
fi

echo -e "${GREEN}✓ All prerequisites met${NC}"
echo ""

# Get AWS account and region
AWS_ACCOUNT=$(aws sts get-caller-identity --profile $AWS_PROFILE --query Account --output text)
AWS_REGION=$(aws configure get region --profile $AWS_PROFILE || echo "us-east-1")

echo -e "${BLUE}Deployment Configuration:${NC}"
echo "  AWS Profile: $AWS_PROFILE"
echo "  AWS Account: $AWS_ACCOUNT"
echo "  AWS Region:  $AWS_REGION"
echo ""

# Navigate to infrastructure directory
cd "$(dirname "$0")/../infrastructure" || exit 1

# Install dependencies
echo -e "${YELLOW}Installing CDK dependencies...${NC}"
npm install
echo -e "${GREEN}✓ Dependencies installed${NC}"
echo ""

# Bootstrap CDK (if not already done)
echo -e "${YELLOW}Bootstrapping CDK (if needed)...${NC}"
npx cdk bootstrap aws://$AWS_ACCOUNT/$AWS_REGION --profile $AWS_PROFILE
echo -e "${GREEN}✓ CDK bootstrap complete${NC}"
echo ""

# Show what will be deployed
echo -e "${YELLOW}Generating deployment plan...${NC}"
npx cdk synth --profile $AWS_PROFILE
echo ""

# Deploy the stack
echo -e "${YELLOW}Deploying Twenty CRM to AWS...${NC}"
echo -e "${YELLOW}This will take approximately 10-15 minutes...${NC}"
echo ""

npx cdk deploy --all --require-approval never --profile $AWS_PROFILE

echo ""
echo -e "${GREEN}╔════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║     Deployment Complete! 🎉            ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════╝${NC}"
echo ""

# Get the application URL from stack outputs
APP_URL=$(aws cloudformation describe-stacks \
    --profile $AWS_PROFILE \
    --stack-name TwentyStack \
    --query 'Stacks[0].Outputs[?OutputKey==`ApplicationURL`].OutputValue' \
    --output text 2>/dev/null || echo "")

if [ -n "$APP_URL" ]; then
    echo -e "${BLUE}Application URL:${NC} $APP_URL"
    echo ""
    echo -e "${YELLOW}Next Steps:${NC}"
    echo "  1. Wait 2-3 minutes for services to fully start"
    echo "  2. Visit $APP_URL"
    echo "  3. Click 'Continue with Email' and create your account"
    echo "  4. Configure integrations via Settings > Admin Panel"
    echo ""
    echo -e "${YELLOW}Optional:${NC}"
    echo "  - Register background jobs: ./scripts/post-deploy.sh"
    echo "  - See DEPLOYMENT.md for detailed configuration options"
fi

echo ""
echo -e "${GREEN}Happy CRM-ing!${NC}"
