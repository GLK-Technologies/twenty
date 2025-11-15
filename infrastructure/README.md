# Twenty CRM - AWS CDK Infrastructure

Cost-optimized AWS infrastructure for deploying Twenty CRM using serverless technologies.

## Quick Start

```bash
# From the repository root
./scripts/deploy.sh
```

That's it! The script handles everything automatically.

## What Gets Deployed

- **VPC**: Single AZ with public/private subnets
- **Aurora Serverless v2**: PostgreSQL 16 (0.5-1 ACU)
- **ElastiCache**: Redis (t4g.micro)
- **ECS Fargate Spot**: Server and worker containers
- **Application Load Balancer**: HTTP/HTTPS routing
- **S3**: File storage
- **Secrets Manager**: Secure credential storage

## Configuration

Edit `bin/app.ts` to customize:

```typescript
const config = {
  auroraMinCapacity: 0.5,    // Database min capacity
  auroraMaxCapacity: 1,      // Database max capacity
  serverCpu: 512,            // Server CPU (1024 = 1 vCPU)
  serverMemory: 1024,        // Server memory (MB)
  workerCpu: 256,            // Worker CPU
  workerMemory: 512,         // Worker memory (MB)
  useFargateSpot: true,      // Use Spot for 70% savings
};
```

## Manual Commands

All commands use the `glk` AWS profile:

```bash
# Install dependencies
npm install

# Bootstrap AWS account (first time only)
npx cdk bootstrap --profile glk

# Show what will be deployed
npx cdk diff --profile glk

# Deploy all stacks
npx cdk deploy --all --profile glk

# Destroy all resources
npx cdk destroy --all --profile glk
```

## Stack Structure

```
lib/
├── twenty-stack.ts      # Main orchestrator
├── network-stack.ts     # VPC, security groups
├── database-stack.ts    # Aurora, ElastiCache
├── storage-stack.ts     # S3 bucket
└── compute-stack.ts     # ECS, Fargate, ALB
```

## Cost Estimate

**Monthly Cost** (2-person team, low usage):
- Aurora Serverless v2: ~$43-86
- Fargate Spot: ~$15-20
- ElastiCache: ~$12
- ALB: ~$16
- S3: ~$1-5
- **Total: ~$88-142/month**

## Scaling Up

For more users, update `config` in `bin/app.ts`:

```typescript
{
  auroraMinCapacity: 1,      // Increase min capacity
  auroraMaxCapacity: 4,      // Increase max capacity
  serverCpu: 1024,           // More CPU
  serverMemory: 2048,        // More memory
  useFargateSpot: false,     // On-demand for stability
}
```

Then redeploy:
```bash
npx cdk deploy --all
```

## Monitoring

View logs:
```bash
# Server logs
aws logs tail /ecs/twenty-server --follow --profile glk

# Worker logs
aws logs tail /ecs/twenty-worker --follow --profile glk
```

## Documentation

See [DEPLOYMENT.md](../DEPLOYMENT.md) for complete guide including:
- Prerequisites
- Post-deployment setup
- Custom domain configuration
- Troubleshooting
- Backup and restore

## Requirements

- Node.js 20+
- AWS CLI configured with `glk` profile credentials
- AWS account with admin access

**Configure AWS profile**:
```bash
aws configure --profile glk
```

## Support

- Twenty Docs: https://docs.twenty.com
- GitHub: https://github.com/twentyhq/twenty
- Discord: https://discord.gg/cx5n4Jzs57
