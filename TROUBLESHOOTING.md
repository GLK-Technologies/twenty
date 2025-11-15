# Twenty CRM AWS Deployment - Troubleshooting Guide

This guide covers common issues specific to the AWS ECS/Fargate deployment.

## Quick Health Checks

### 1. Verify Services are Running

```bash
# Check ECS services
aws ecs describe-services \
  --profile glk \
  --cluster twenty-cluster \
  --services TwentyStack-Compute-ServerService TwentyStack-Compute-WorkerService \
  --query 'services[*].[serviceName,desiredCount,runningCount,status]' \
  --output table

# Expected: desiredCount = runningCount = 1 for both services
```

### 2. Check Application Logs

```bash
# Server logs
aws logs tail /ecs/twenty-server --follow --profile glk

# Worker logs (critical for emails and background jobs)
aws logs tail /ecs/twenty-worker --follow --profile glk
```

### 3. Verify Database Connectivity

```bash
# Get database endpoint from outputs
aws cloudformation describe-stacks \
  --profile glk \
  --stack-name TwentyStack \
  --query 'Stacks[0].Outputs[?OutputKey==`DatabaseEndpoint`].OutputValue' \
  --output text
```

## Common Issues & Solutions

### Issue 1: Cannot Access https://crm.skillfaber.com

**Symptoms:**
- Browser shows "Site can't be reached"
- Connection timeout

**Diagnosis:**
```bash
# 1. Check Route53 record
aws route53 list-resource-record-sets \
  --profile glk \
  --hosted-zone-id Z0729790KQC5I26T2RLT \
  --query "ResourceRecordSets[?Name=='crm.skillfaber.com.']"

# 2. Check ALB status
aws elbv2 describe-load-balancers \
  --profile glk \
  --query 'LoadBalancers[*].[LoadBalancerName,State.Code,DNSName]' \
  --output table

# 3. Verify DNS propagation
nslookup crm.skillfaber.com
```

**Solutions:**
1. **DNS not propagated**: Wait 5-10 minutes for Route53 changes
2. **ALB not active**: Check CloudFormation stack status
3. **Security group issue**: Verify ALB security group allows 80/443

### Issue 2: Login Fails / "Unauthorized" Errors

**Symptoms:**
- Cannot log in after creating account
- "Unauthorized" errors in browser console
- Session not persisting

**Diagnosis:**
```bash
# Check SERVER_URL in running container
TASK_ARN=$(aws ecs list-tasks \
  --profile glk \
  --cluster twenty-cluster \
  --service-name TwentyStack-Compute-ServerService \
  --query 'taskArns[0]' \
  --output text)

aws ecs describe-tasks \
  --profile glk \
  --cluster twenty-cluster \
  --tasks $TASK_ARN \
  --query 'tasks[0].overrides.containerOverrides[0].environment'
```

**Solutions:**

1. **SERVER_URL mismatch**:
   - **Expected**: `https://crm.skillfaber.com`
   - **If wrong**: Redeploy with correct configuration

2. **CORS/Headers issue**:
   - ALB automatically adds `X-Forwarded-For` and `X-Forwarded-Proto`
   - Check ALB is using HTTPS listener (port 443)

3. **Session stickiness**:
   - Already enabled in our deployment
   - Cookie: `TWENTYCRM_STICKY` (24 hour duration)

### Issue 3: No Admin Panel Access

**Symptoms:**
- Settings → Admin Panel is missing
- Cannot configure integrations

**Solution:**
Run the admin access script:

```bash
./scripts/grant-admin-access.sh your.email@skillfaber.com
```

**Manual method (if script fails):**
```bash
# Get database URL secret
DB_URL=$(aws secretsmanager get-secret-value \
  --profile glk \
  --secret-id twenty/database/connection-url \
  --query 'SecretString' \
  --output text)

# Connect to database and run SQL
psql "$DB_URL" -c "UPDATE core.\"user\" SET \"canAccessFullAdminPanel\" = TRUE WHERE email = 'your.email@skillfaber.com';"
```

### Issue 4: Emails Not Sending

**Symptoms:**
- No email notifications
- Password reset emails not received

**Diagnosis:**
```bash
# Verify worker service is running
aws ecs describe-services \
  --profile glk \
  --cluster twenty-cluster \
  --services TwentyStack-Compute-WorkerService \
  --query 'services[0].[runningCount,desiredCount]'

# Check worker logs
aws logs tail /ecs/twenty-worker --follow --profile glk
```

**Solutions:**

1. **Worker not running**:
   ```bash
   # Restart worker service
   aws ecs update-service \
     --profile glk \
     --cluster twenty-cluster \
     --service TwentyStack-Compute-WorkerService \
     --force-new-deployment
   ```

2. **SMTP not configured**:
   - Go to Settings → Admin Panel → Configuration Variables
   - Set EMAIL_DRIVER=smtp
   - Configure SMTP settings (see DEPLOYMENT.md)

3. **Gmail requires App Password**:
   - Don't use regular Gmail password
   - Create App Password at https://myaccount.google.com/apppasswords

### Issue 5: Database Connection Errors

**Symptoms:**
- "Connection refused" or "Connection timeout"
- Tasks fail to start

**Diagnosis:**
```bash
# Check Aurora cluster status
aws rds describe-db-clusters \
  --profile glk \
  --db-cluster-identifier <cluster-id> \
  --query 'DBClusters[0].[Status,Endpoint,ServerlessV2ScalingConfiguration]'

# Verify security groups
aws ec2 describe-security-groups \
  --profile glk \
  --filters "Name=tag:Component,Values=Database" \
  --query 'SecurityGroups[*].[GroupId,GroupName,IpPermissions]'
```

**Solutions:**

1. **Aurora still starting**: Wait 2-3 minutes after deployment

2. **Security group issue**:
   - ECS security group should have access to RDS on port 5432
   - Check CloudFormation for proper security group configuration

3. **Database secret issue**:
   ```bash
   # Verify database URL secret exists
   aws secretsmanager get-secret-value \
     --profile glk \
     --secret-id twenty/database/connection-url
   ```

### Issue 6: Worker Background Jobs Not Running

**Symptoms:**
- Email sync not working
- Calendar sync not working
- Webhook not triggered

**Solution:**
Register background jobs (run once after deployment):

```bash
./scripts/post-deploy.sh
```

**Verify jobs are registered:**
```bash
# Check worker logs for cron job registrations
aws logs tail /ecs/twenty-worker --profile glk --since 10m | grep "cron"
```

### Issue 7: Microsoft 365 Integration Fails

**Symptoms:**
- Error: `AADSTS50020`
- "Personal Microsoft accounts not supported"

**Solutions:**

1. **Use enterprise Microsoft account** (not @outlook.com, @hotmail.com)

2. **User needs Microsoft 365 license**:
   - Verify at https://admin.microsoft.com/
   - User must have active M365 license

3. **App registration permissions**:
   - Mail.ReadWrite (or Mail.Read + Mail.Send)
   - Calendars.Read
   - User.Read
   - offline_access

### Issue 8: HTTPS Redirect Loop

**Symptoms:**
- Browser shows "Too many redirects"
- Cannot access application

**Diagnosis:**
```bash
# Test redirect behavior
curl -I http://crm.skillfaber.com
# Should show: HTTP/1.1 301 Moved Permanently
# Location: https://crm.skillfaber.com/

curl -I https://crm.skillfaber.com
# Should show: HTTP/2 200
```

**Solution:**
- This indicates ALB is misconfigured
- Check HTTPS listener is using certificate
- Verify HTTP listener has redirect action (not forward)

### Issue 9: SSL Certificate Issues

**Symptoms:**
- "Your connection is not private"
- Certificate mismatch warnings

**Diagnosis:**
```bash
# Verify certificate
aws acm describe-certificate \
  --profile glk \
  --certificate-arn arn:aws:acm:us-east-1:690429826899:certificate/120fa7ae-9d18-4fcc-8df1-b07751c1e416 \
  --query 'Certificate.[DomainName,SubjectAlternativeNames,Status]'

# Test SSL with OpenSSL
openssl s_client -connect crm.skillfaber.com:443 -servername crm.skillfaber.com
```

**Solutions:**
- Certificate should be ISSUED status
- Should cover *.skillfaber.com (includes crm.skillfaber.com)
- If issues persist, redeploy stack

## Performance Issues

### High Database CPU

**Check Aurora metrics:**
```bash
aws cloudwatch get-metric-statistics \
  --profile glk \
  --namespace AWS/RDS \
  --metric-name CPUUtilization \
  --dimensions Name=DBClusterIdentifier,Value=<cluster-id> \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Average
```

**Solution:**
Increase Aurora max capacity in `infrastructure/bin/app.ts`:
```typescript
auroraMaxCapacity: 2,  // Increase from 1 to 2 ACU
```

### Slow Response Times

**Check ECS task metrics:**
```bash
# CPU/Memory usage
aws ecs describe-services \
  --profile glk \
  --cluster twenty-cluster \
  --services TwentyStack-Compute-ServerService \
  --query 'services[0].deployments[0].[desiredCount,runningCount,taskDefinition]'
```

**Solution:**
Increase server resources in `infrastructure/bin/app.ts`:
```typescript
serverCpu: 1024,     // Increase from 512 (1 vCPU)
serverMemory: 2048,  // Increase from 1024 (2 GB)
```

## Useful Commands

### Force Service Redeploy
```bash
aws ecs update-service \
  --profile glk \
  --cluster twenty-cluster \
  --service TwentyStack-Compute-ServerService \
  --force-new-deployment
```

### Execute Command in Running Container
```bash
# Get task ARN
TASK_ARN=$(aws ecs list-tasks \
  --profile glk \
  --cluster twenty-cluster \
  --service-name TwentyStack-Compute-ServerService \
  --query 'taskArns[0]' \
  --output text)

# Execute shell
aws ecs execute-command \
  --profile glk \
  --cluster twenty-cluster \
  --task $TASK_ARN \
  --container ServerContainer \
  --interactive \
  --command "/bin/sh"
```

### View All Stack Outputs
```bash
aws cloudformation describe-stacks \
  --profile glk \
  --stack-name TwentyStack \
  --query 'Stacks[0].Outputs'
```

### Delete and Recreate Stack
```bash
# WARNING: This deletes all data (database snapshot is created)
cd infrastructure
npx cdk destroy --all --profile glk

# Wait for deletion to complete, then redeploy
npx cdk deploy --all --profile glk
```

## Getting Help

1. **Check logs first**: Most issues show up in CloudWatch logs
2. **Verify configuration**: Ensure SERVER_URL matches actual domain
3. **Community support**: Discord - https://discord.gg/cx5n4Jzs57
4. **GitHub issues**: https://github.com/twentyhq/twenty/issues
5. **AWS support**: For infrastructure-specific issues

## Preventive Maintenance

### Weekly Checks
- Monitor Aurora capacity usage
- Check ECS task health
- Review CloudWatch logs for errors
- Verify backup snapshots exist

### Monthly Tasks
- Review and rotate secrets if needed
- Update to latest Twenty Docker image
- Check for AWS service quota limits
- Review CloudWatch costs

### Before Updates
1. Create manual database snapshot
2. Test in non-production environment
3. Have rollback plan ready
4. Schedule during low-usage period
