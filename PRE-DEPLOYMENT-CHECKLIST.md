# Pre-Deployment Checklist for Twenty CRM on AWS

Run through this checklist BEFORE deploying to avoid common issues.

## ✅ Prerequisites

### AWS Configuration
- [ ] AWS CLI installed and configured
- [ ] `glk` profile configured: `aws configure --profile glk`
- [ ] Can access AWS account: `aws sts get-caller-identity --profile glk`
- [ ] Have permissions for: ECS, RDS, ElastiCache, S3, Route53, Secrets Manager, ALB

### Domain & SSL
- [x] Domain exists: `skillfaber.com`
- [x] Hosted Zone ID: `Z0729790KQC5I26T2RLT`
- [x] SSL Certificate: `arn:aws:acm:us-east-1:690429826899:certificate/120fa7ae-9d18-4fcc-8df1-b07751c1e416`
- [x] Certificate covers `*.skillfaber.com` (verified)
- [x] Certificate status: ISSUED

### Infrastructure Code
- [x] Domain configured: `crm.skillfaber.com`
- [x] SERVER_URL set: `https://crm.skillfaber.com`
- [x] ALB session stickiness enabled
- [x] HTTPS listener configured with certificate
- [x] HTTP→HTTPS redirect configured
- [x] Route53 A record will be created automatically

## 🔍 Configuration Review

### Check Configuration Values

```bash
# Review configuration
cat infrastructure/bin/app.ts | grep -A 15 "const config"
```

**Expected values:**
- ✅ `domainName: 'crm.skillfaber.com'`
- ✅ `hostedZoneId: 'Z0729790KQC5I26T2RLT'`
- ✅ `certificateArn: 'arn:aws:acm:us-east-1:690429826899:certificate/120fa7ae-9d18-4fcc-8df1-b07751c1e416'`
- ✅ `auroraMinCapacity: 0.5` (good for 2 users)
- ✅ `auroraMaxCapacity: 1` (can increase later)
- ✅ `useFargateSpot: true` (70% cost savings)

### Cost Estimate Review

**Expected Monthly Costs** (2-person team):
- Aurora Serverless v2 (0.5-1 ACU): ~$43-86
- Fargate Spot (server + worker): ~$15-20
- ElastiCache Redis (t4g.micro): ~$12
- Application Load Balancer: ~$16
- S3 storage: ~$1-5
- **Total: ~$88-142/month**

Are these costs acceptable?
- [ ] Yes, approved
- [ ] No, need to adjust configuration

## 📋 Pre-Deployment Tests

### 1. Verify AWS Resources Don't Conflict

```bash
# Check for existing ECS clusters named 'twenty-cluster'
aws ecs list-clusters --profile glk | grep twenty-cluster

# Check for existing Route53 records for crm.skillfaber.com
aws route53 list-resource-record-sets \
  --profile glk \
  --hosted-zone-id Z0729790KQC5I26T2RLT \
  --query "ResourceRecordSets[?Name=='crm.skillfaber.com.']"
```

**Expected:**
- No existing ECS cluster named 'twenty-cluster'
- No existing A record for 'crm.skillfaber.com' (will be created)

If conflicts exist:
- [ ] Resolved or documented

### 2. Verify CDK Synthesis Works

```bash
cd infrastructure
npm install
npx cdk synth --profile glk
```

**Expected:**
- No TypeScript errors
- CloudFormation template generated successfully

Result:
- [ ] Success
- [ ] Errors (fix before deploying)

### 3. Check Service Quotas

```bash
# Check ECS service quota (need at least 2 services)
aws service-quotas get-service-quota \
  --profile glk \
  --service-code ecs \
  --quota-code L-38FD2CE6 \
  --query 'Quota.Value' || echo "Need to request quota increase"

# Check RDS cluster quota
aws service-quotas get-service-quota \
  --profile glk \
  --service-code rds \
  --quota-code L-952B80B8 \
  --query 'Quota.Value' || echo "Default should be sufficient"
```

Result:
- [ ] Sufficient quotas available

## 🚀 Deployment Preparation

### 1. Review Deployment Plan

```bash
cd infrastructure
npx cdk diff --profile glk
```

**Review what will be created:**
- [ ] VPC and networking (1 AZ, 1 NAT Gateway)
- [ ] Aurora Serverless v2 cluster
- [ ] ElastiCache Redis
- [ ] S3 bucket
- [ ] ECS cluster with 2 Fargate services
- [ ] Application Load Balancer
- [ ] Route53 A record
- [ ] Secrets Manager secrets

### 2. Estimate Deployment Time

**Expected duration: 10-15 minutes**

Breakdown:
- VPC & networking: 2-3 min
- Aurora cluster: 4-6 min (longest)
- ElastiCache: 2-3 min
- ECS services: 2-3 min
- ALB & Route53: 1-2 min

Are you ready to wait?
- [ ] Yes, I have 15 minutes available
- [ ] No, will schedule for later

### 3. Prepare for Post-Deployment

After deployment, you'll need to:
1. Wait 2-3 minutes for services to fully start
2. Visit https://crm.skillfaber.com
3. Create your first user account
4. Grant admin access: `./scripts/grant-admin-access.sh your@email.com`
5. (Optional) Register background jobs: `./scripts/post-deploy.sh`

Checklist:
- [ ] Know which email to use for first account
- [ ] Have admin access script ready
- [ ] Understand post-deployment steps

## 🎯 Known Issues & Mitigations

### Issue 1: First User Needs Admin Access
**Mitigation:** Use `./scripts/grant-admin-access.sh` after creating account

### Issue 2: DNS Propagation Delay
**Mitigation:** May take 5-10 minutes for https://crm.skillfaber.com to resolve

### Issue 3: Services Take Time to Start
**Mitigation:** Wait 2-3 minutes after deployment before accessing

### Issue 4: Email Not Working Initially
**Mitigation:** Configure SMTP in Admin Panel, then run `./scripts/post-deploy.sh`

### Issue 5: Session Issues with Multiple Tabs
**Mitigation:** Session stickiness is already enabled (cookie: TWENTYCRM_STICKY)

All mitigations understood:
- [ ] Yes, ready to handle these

## 🔒 Security Considerations

Before deploying to production:

### Immediate (Built-in)
- [x] SSL/TLS encryption (HTTPS)
- [x] Database encryption at rest
- [x] Secrets Manager for credentials
- [x] VPC isolation (private subnets)
- [x] Security groups (least privilege)

### Post-Deployment (Recommended)
- [ ] Enable MFA on AWS account
- [ ] Set up CloudWatch alarms
- [ ] Configure database backup retention
- [ ] Review IAM roles and permissions
- [ ] Enable AWS CloudTrail
- [ ] Set up AWS WAF (if needed)
- [ ] Configure budget alerts

### Application Security
- [ ] Use strong password for first user
- [ ] Enable 2FA in Twenty (if available)
- [ ] Review user permissions regularly
- [ ] Keep Twenty updated (check for updates monthly)

## 📞 Support Resources Ready

Have these ready in case of issues:

- [ ] TROUBLESHOOTING.md file reviewed
- [ ] AWS Console access ready
- [ ] CloudWatch logs bookmarked
- [ ] Discord support channel: https://discord.gg/cx5n4Jzs57
- [ ] GitHub issues: https://github.com/twentyhq/twenty/issues

## ✨ Final Checks

### Before Running `./scripts/deploy.sh`:

1. **All items above checked?**
   - [ ] Yes, everything verified

2. **Ready for 10-15 minute deployment?**
   - [ ] Yes, time is available

3. **Understand post-deployment steps?**
   - [ ] Yes, know what to do after deployment

4. **Have rollback plan?**
   - [ ] Yes: `npx cdk destroy --all --profile glk` (creates DB snapshot)

5. **Costs approved?**
   - [ ] Yes, $88-142/month is acceptable

## 🎉 Ready to Deploy!

If all boxes are checked, you're ready to deploy:

```bash
./scripts/deploy.sh
```

**During deployment:**
- Don't interrupt the process
- Watch for any error messages
- Note the Application URL in the output

**After deployment:**
1. Wait 2-3 minutes
2. Visit https://crm.skillfaber.com
3. Create account (use "Continue with Email")
4. Run: `./scripts/grant-admin-access.sh your@email.com`
5. Configure integrations in Admin Panel
6. (Optional) Run: `./scripts/post-deploy.sh`

## 📊 Post-Deployment Verification

After deployment completes, verify:

```bash
# 1. Check all services are running
aws ecs describe-services \
  --profile glk \
  --cluster twenty-cluster \
  --services TwentyStack-Compute-ServerService TwentyStack-Compute-WorkerService

# 2. Verify HTTPS works
curl -I https://crm.skillfaber.com
# Should return: HTTP/2 200

# 3. Check HTTP redirects
curl -I http://crm.skillfaber.com
# Should return: HTTP/1.1 301 Moved Permanently

# 4. Verify DNS
nslookup crm.skillfaber.com

# 5. Check SSL certificate
openssl s_client -connect crm.skillfaber.com:443 -servername crm.skillfaber.com < /dev/null
```

All checks passed:
- [ ] Yes, deployment successful!
- [ ] No, see TROUBLESHOOTING.md

---

**Good luck with your deployment! 🚀**
