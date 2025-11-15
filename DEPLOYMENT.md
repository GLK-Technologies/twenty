# Twenty CRM - AWS Deployment Guide

This guide provides complete instructions for deploying Twenty CRM to AWS using the cost-optimized infrastructure for small teams (2-10 employees).

## Architecture Overview

The deployment uses:
- **ECS Fargate Spot**: Serverless containers (70% cost savings)
- **Aurora Serverless v2**: PostgreSQL 16 database (0.5-1 ACU)
- **ElastiCache**: Redis cache (t4g.micro)
- **S3**: File storage
- **Application Load Balancer**: HTTP/HTTPS traffic routing
- **Single AZ**: Cost-optimized for small teams

**Estimated Monthly Cost**: $88-142 USD

## Prerequisites

### Required Software
- **Node.js** 20+ ([Download](https://nodejs.org/))
- **AWS CLI** ([Installation Guide](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html))
- **AWS Account** with admin access

### AWS Credentials Setup

1. Configure AWS CLI with the `glk` profile:
   ```bash
   aws configure --profile glk
   ```

2. Enter your credentials:
   - AWS Access Key ID
   - AWS Secret Access Key
   - Default region (e.g., `us-east-1`)
   - Output format: `json`

3. Verify configuration:
   ```bash
   aws sts get-caller-identity --profile glk
   ```

**Note**: The deployment scripts are configured to use the `glk` AWS profile by default.

## Deployment

### Quick Start (Recommended)

Deploy with a single command:

```bash
./scripts/deploy.sh
```

This script will:
1. ✓ Check prerequisites
2. ✓ Install CDK dependencies
3. ✓ Bootstrap AWS account (if needed)
4. ✓ Deploy all infrastructure (~10-15 minutes)
5. ✓ Output your application URL

### Manual Deployment

If you prefer step-by-step control:

```bash
# Navigate to infrastructure directory
cd infrastructure

# Install dependencies
npm install

# Bootstrap CDK (first time only)
npx cdk bootstrap

# Preview changes
npx cdk diff

# Deploy
npx cdk deploy --all
```

## Post-Deployment

### 1. Access Your Application

After deployment completes, you'll receive an Application URL like:
```
http://Twent-LoadB-XXXXXXXXX.us-east-1.elb.amazonaws.com
```

**Wait 2-3 minutes** for services to fully start, then visit the URL.

### 2. Create Your Account

1. Click **"Continue with Email"**
2. Enter your email and password
3. Complete account setup

### 3. Configure Integration (Optional)

Access **Settings → Admin Panel → Configuration Variables** to set up:

#### Google Integration (Gmail + Calendar)
- `AUTH_GOOGLE_CLIENT_ID`: Your Google OAuth client ID
- `AUTH_GOOGLE_CLIENT_SECRET`: Your Google OAuth secret
- `AUTH_GOOGLE_CALLBACK_URL`: `https://your-domain/auth/google/redirect`
- `MESSAGING_PROVIDER_GMAIL_ENABLED`: `true`
- `CALENDAR_PROVIDER_GOOGLE_ENABLED`: `true`

See [Google OAuth Setup](https://docs.twenty.com/developers/self-hosting/setup#google-integration-setup)

#### Microsoft 365 Integration
- `AUTH_MICROSOFT_CLIENT_ID`: Your Microsoft app client ID
- `AUTH_MICROSOFT_CLIENT_SECRET`: Your Microsoft app secret
- `AUTH_MICROSOFT_ENABLED`: `true`
- `MESSAGING_PROVIDER_MICROSOFT_ENABLED`: `true`
- `CALENDAR_PROVIDER_MICROSOFT_ENABLED`: `true`

See [Microsoft Setup](https://docs.twenty.com/developers/self-hosting/setup#microsoft-365-integration-setup)

#### Email (SMTP)
- `EMAIL_DRIVER`: `smtp`
- `EMAIL_SMTP_HOST`: Your SMTP server
- `EMAIL_SMTP_PORT`: `587` or `465`
- `EMAIL_SMTP_USER`: Your SMTP username
- `EMAIL_SMTP_PASSWORD`: Your SMTP password
- `EMAIL_FROM_ADDRESS`: Sender email address

### 4. Register Background Jobs (If Using Integrations)

If you enabled Google or Microsoft integrations, register background jobs:

```bash
./scripts/post-deploy.sh
```

This registers:
- Email message sync
- Calendar event sync
- Workflow automation
- Stale connection cleanup

**Note**: Only run once after deployment.

## Custom Domain Setup (Optional)

To use your own domain instead of the ALB URL:

### 1. Create SSL Certificate

```bash
# Request certificate in ACM
aws acm request-certificate \
  --profile glk \
  --domain-name crm.yourdomain.com \
  --validation-method DNS \
  --region us-east-1
```

### 2. Add DNS Validation Records

Follow AWS Console instructions to add DNS validation records to your domain.

### 3. Update CDK Configuration

Edit `infrastructure/bin/app.ts`:

```typescript
const config = {
  domainName: 'crm.yourdomain.com',
  hostedZoneId: 'Z1234567890ABC', // Your Route53 hosted zone ID
  // ... rest of config
};
```

### 4. Redeploy

```bash
npx cdk deploy --all
```

### 5. Update DNS

Point `crm.yourdomain.com` CNAME to your ALB DNS name.

## Configuration

### Environment Variables

All infrastructure variables are managed in `infrastructure/bin/app.ts`:

```typescript
const config = {
  // Database
  auroraMinCapacity: 0.5,    // Minimum ACU
  auroraMaxCapacity: 1,      // Maximum ACU

  // Compute
  serverCpu: 512,            // 0.5 vCPU
  serverMemory: 1024,        // 1 GB RAM
  workerCpu: 256,            // 0.25 vCPU
  workerMemory: 512,         // 512 MB RAM

  // Cost optimization
  useFargateSpot: true,      // 70% savings
};
```

### Scaling Up

To handle more users, increase capacity:

```typescript
const config = {
  auroraMinCapacity: 1,      // 1 ACU min
  auroraMaxCapacity: 4,      // 4 ACU max
  serverCpu: 1024,           // 1 vCPU
  serverMemory: 2048,        // 2 GB RAM
  useFargateSpot: false,     // Use on-demand for stability
};
```

Then redeploy:
```bash
npx cdk deploy --all
```

## Monitoring

### View Logs

```bash
# Server logs
aws logs tail /ecs/twenty-server --follow --profile glk --region us-east-1

# Worker logs
aws logs tail /ecs/twenty-worker --follow --profile glk --region us-east-1
```

### Check Service Health

```bash
# List ECS services
aws ecs list-services --cluster twenty-cluster --profile glk

# Describe service
aws ecs describe-services \
  --profile glk \
  --cluster twenty-cluster \
  --services TwentyStack-Compute-ServerService
```

### Database Metrics

View Aurora metrics in AWS Console:
- CloudWatch → Databases → twenty-cluster
- Key metrics: CPU, DatabaseConnections, ServerlessDatabaseCapacity

## Backup & Restore

### Database Backups

Automatic backups are enabled (7-day retention).

Create manual snapshot:
```bash
aws rds create-db-cluster-snapshot \
  --profile glk \
  --db-cluster-identifier twenty-cluster \
  --db-cluster-snapshot-identifier twenty-backup-$(date +%Y%m%d)
```

### Restore from Snapshot

```bash
aws rds restore-db-cluster-from-snapshot \
  --profile glk \
  --db-cluster-identifier twenty-cluster-restored \
  --snapshot-identifier twenty-backup-20250114
```

## Troubleshooting

### Services Not Starting

Check ECS task failures:
```bash
aws ecs describe-tasks \
  --profile glk \
  --cluster twenty-cluster \
  --tasks $(aws ecs list-tasks --profile glk --cluster twenty-cluster --query 'taskArns[0]' --output text)
```

Common issues:
- **Database not ready**: Wait 2-3 minutes after deployment
- **Secrets access denied**: Check IAM roles in CloudFormation
- **Health check failing**: Check security group rules

### Cannot Access Application

1. Verify ALB is healthy:
   ```bash
   aws elbv2 describe-target-health \
     --profile glk \
     --target-group-arn $(aws elbv2 describe-target-groups \
       --profile glk \
       --query 'TargetGroups[0].TargetGroupArn' --output text)
   ```

2. Check security groups allow HTTP (port 80)

3. Verify ECS tasks are running:
   ```bash
   aws ecs list-tasks --profile glk --cluster twenty-cluster
   ```

### Database Connection Errors

1. Check database secret:
   ```bash
   aws secretsmanager get-secret-value \
     --profile glk \
     --secret-id twenty/database/connection-url
   ```

2. Verify Aurora cluster is available:
   ```bash
   aws rds describe-db-clusters \
     --profile glk \
     --db-cluster-identifier twenty-cluster
   ```

## Updating

To update to a newer Twenty version:

```bash
# Pull latest changes
git pull origin main

# Redeploy (uses latest Docker image)
./scripts/deploy.sh
```

The deployment will use `twentycrm/twenty:latest` Docker image.

## Cleanup

To remove all resources and avoid charges:

```bash
cd infrastructure
npx cdk destroy --all
```

**Warning**: This will delete:
- Database (with final snapshot)
- All S3 files
- All configuration

Backups (snapshots) are retained for recovery.

## Cost Optimization Tips

1. **Use Fargate Spot**: Already enabled (70% savings)
2. **Right-size Aurora**: Start with 0.5 ACU, increase only if needed
3. **Monitor S3 usage**: Enable lifecycle policies for old files
4. **Single AZ**: Already configured for 2-person team
5. **Review CloudWatch logs**: Reduce retention if needed (currently 7 days)

## Security Best Practices

1. **Enable MFA** on AWS account
2. **Rotate secrets** periodically via Secrets Manager
3. **Enable AWS WAF** if publicly accessible
4. **Restrict security groups** to known IP ranges
5. **Enable CloudTrail** for audit logging
6. **Use HTTPS**: Set up ACM certificate and custom domain

## Monitoring and Observability

The deployment includes a comprehensive CloudWatch dashboard and alarms for proactive monitoring.

### CloudWatch Dashboard

After deployment, access your monitoring dashboard:

```
https://console.aws.amazon.com/cloudwatch/home?region=us-east-1#dashboards:name=Twenty-CRM-Production
```

**Dashboard includes:**

**Aurora Database Metrics:**
- ACU Utilization (% of max capacity used)
- CPU Utilization and Database Connections
- Read/Write Latency
- Serverless Database Capacity (actual ACU usage)

**ECS Service Metrics:**
- Server service CPU and Memory utilization
- Worker service CPU and Memory utilization

**Application Load Balancer:**
- Request count and response times
- HTTP status codes (2xx, 4xx, 5xx)
- Healthy/Unhealthy target counts

**Redis Cache:**
- CPU and memory usage
- Connection count and evictions

### CloudWatch Alarms

If you configured `alertEmail` in `infrastructure/bin/app.ts`, you'll receive email notifications for:

1. **Aurora CPU > 90%** - Consider scaling up ACU capacity
2. **Aurora ACU Utilization > 80%** - Increase `auroraMaxCapacity`
3. **Server CPU > 85%** - Increase `serverCpu` in config
4. **Worker Memory > 85%** - Increase `workerMemory` in config
5. **No Healthy Hosts** - Service may be down
6. **High 5xx Errors (>10 in 5 min)** - Check application logs
7. **Response Time p99 > 2s** - Investigate performance
8. **Redis Memory > 80%** - Consider larger instance

**Email Subscription:**

After first deployment, confirm the SNS email subscription sent to the configured email address.

### Viewing Logs

**ECS Container Logs:**
```bash
# Server logs
aws logs tail /ecs/twenty-server --follow --profile glk

# Worker logs
aws logs tail /ecs/twenty-worker --follow --profile glk
```

**Aurora Database Logs:**

Enabled automatically with 7-day retention:
- PostgreSQL error logs
- Slow query logs

### Metrics to Monitor

**Capacity Planning:**
- **ACU Utilization**: If consistently > 70%, increase `auroraMaxCapacity`
- **ECS CPU/Memory**: If > 80% regularly, scale up task resources
- **Redis Memory**: If > 75%, upgrade to larger cache instance

**Performance:**
- **Response Time**: Target p99 < 1s for good UX
- **Database Latency**: Should be < 10ms for most queries
- **5xx Errors**: Should be near zero

**Cost Optimization:**
- **ACU Usage**: If consistently < 30%, decrease `auroraMaxCapacity`
- **Request Count**: Monitor to understand traffic patterns

## Support

- **Twenty Documentation**: https://docs.twenty.com
- **GitHub Issues**: https://github.com/twentyhq/twenty/issues
- **Community Discord**: https://discord.gg/cx5n4Jzs57

## Architecture Diagram

```
┌─────────────────────────────────────────────────────┐
│                    Internet                          │
└────────────────────┬────────────────────────────────┘
                     │
                     ▼
              ┌─────────────┐
              │     ALB     │ (Public)
              │  Port 80    │
              └──────┬──────┘
                     │
         ┌───────────┴───────────┐
         ▼                       ▼
  ┌─────────────┐         ┌─────────────┐
  │ ECS Server  │         │ ECS Worker  │
  │ (Fargate)   │         │ (Fargate)   │
  └──────┬──────┘         └──────┬──────┘
         │                       │
         └───────────┬───────────┘
                     │
         ┌───────────┼───────────┐
         ▼           ▼           ▼
  ┌──────────┐ ┌──────────┐ ┌──────┐
  │  Aurora  │ │  Redis   │ │  S3  │
  │   v2     │ │ (ElastiCache) │ Bucket │
  └──────────┘ └──────────┘ └──────┘
```

## License

This infrastructure code follows the same license as Twenty CRM.
