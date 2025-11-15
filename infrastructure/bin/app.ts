#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { TwentyStack } from '../lib/twenty-stack';

const app = new cdk.App();

// Get configuration from CDK context or environment variables
const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT || process.env.AWS_ACCOUNT_ID,
  region: process.env.CDK_DEFAULT_REGION || process.env.AWS_REGION || 'us-east-1',
};

// Stack configuration
const config = {
  // Domain configuration
  domainName: 'crm.skillfaber.com',
  hostedZoneId: 'Z0729790KQC5I26T2RLT',
  hostedZoneName: 'skillfaber.com',
  certificateArn: 'arn:aws:acm:us-east-1:690429826899:certificate/120fa7ae-9d18-4fcc-8df1-b07751c1e416',

  // Database configuration
  auroraMinCapacity: 0.5,
  auroraMaxCapacity: 1,

  // Compute configuration
  serverCpu: 512,      // 0.5 vCPU
  serverMemory: 1024,  // 1 GB
  workerCpu: 256,      // 0.25 vCPU
  workerMemory: 1024,  // 1 GB (worker needs more memory for background jobs)

  // Use Fargate Spot for cost savings (70% cheaper)
  useFargateSpot: true,

  // Email for CloudWatch alerts
  alertEmail: 'jhorlin@skillfaber.com',
};

new TwentyStack(app, 'TwentyStack', {
  env,
  config,
  description: 'Twenty CRM - Cost-optimized deployment for small teams',
  tags: {
    Project: 'Twenty',
    Environment: 'production',
    ManagedBy: 'CDK',
  },
});

app.synth();
