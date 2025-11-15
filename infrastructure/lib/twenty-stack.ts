import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as appreg from '@aws-cdk/aws-servicecatalogappregistry-alpha';
import { NetworkStack } from './network-stack';
import { DatabaseStack } from './database-stack';
import { StorageStack } from './storage-stack';
import { ComputeStack } from './compute-stack';
import { MonitoringStack } from './monitoring-stack';

export type TwentyStackConfig = {
  domainName?: string;
  hostedZoneId?: string;
  hostedZoneName?: string;
  certificateArn?: string;
  auroraMinCapacity: number;
  auroraMaxCapacity: number;
  serverCpu: number;
  serverMemory: number;
  workerCpu: number;
  workerMemory: number;
  useFargateSpot: boolean;
  alertEmail?: string;
};

export type TwentyStackProps = cdk.StackProps & {
  config: TwentyStackConfig;
};

export class TwentyStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: TwentyStackProps) {
    super(scope, id, props);

    const { config } = props;

    // 1. Network Infrastructure
    const network = new NetworkStack(this, 'Network', {
      maxAzs: 2, // 2 AZs required for Aurora (creates subnets in multiple AZs)
      natGateways: 1, // Single NAT Gateway for cost optimization
    });

    // 2. Database Infrastructure
    const database = new DatabaseStack(this, 'Database', {
      vpc: network.outputs.vpc,
      rdsSecurityGroup: network.outputs.rdsSecurityGroup,
      redisSecurityGroup: network.outputs.redisSecurityGroup,
      auroraMinCapacity: config.auroraMinCapacity,
      auroraMaxCapacity: config.auroraMaxCapacity,
    });

    // 3. Storage Infrastructure
    const storage = new StorageStack(this, 'Storage');

    // 4. Compute Infrastructure
    const compute = new ComputeStack(this, 'Compute', {
      vpc: network.outputs.vpc,
      albSecurityGroup: network.outputs.albSecurityGroup,
      ecsSecurityGroup: network.outputs.ecsSecurityGroup,
      databaseUrlSecret: database.outputs.databaseUrlSecret,
      redisEndpoint: database.outputs.redisEndpoint,
      storageBucket: storage.outputs.bucket,
      serverCpu: config.serverCpu,
      serverMemory: config.serverMemory,
      workerCpu: config.workerCpu,
      workerMemory: config.workerMemory,
      useFargateSpot: config.useFargateSpot,
      domainName: config.domainName,
      hostedZoneId: config.hostedZoneId,
      hostedZoneName: config.hostedZoneName,
      certificateArn: config.certificateArn,
    });

    // 5. Monitoring Infrastructure
    const monitoring = new MonitoringStack(this, 'Monitoring', {
      databaseCluster: database.outputs.cluster,
      databaseClusterIdentifier: database.outputs.clusterIdentifier,
      redisClusterId: database.outputs.redisClusterId,
      ecsClusterName: compute.outputs.cluster.clusterName,
      serverServiceName: compute.outputs.serverService.serviceName,
      workerServiceName: compute.outputs.workerService.serviceName,
      loadBalancer: compute.outputs.loadBalancer,
      targetGroupFullName: compute.outputs.targetGroupFullName,
      alertEmail: config.alertEmail,
    });

    // 6. Application Registry (myApplications)
    // Create AppRegistry Application for centralized resource tracking
    const application = new appreg.Application(this, 'TwentyCRMApplication', {
      applicationName: 'Twenty-CRM',
      description: 'Twenty CRM - Cost-optimized deployment for small teams',
    });

    // Associate this stack with the application
    // This automatically tags all resources for cost tracking and governance
    application.associateStack(this);

    // Create attribute group for project metadata
    const projectAttributes = new appreg.AttributeGroup(this, 'ProjectAttributes', {
      attributeGroupName: 'Twenty-CRM-ProjectInfo',
      description: 'Project and business metadata for Twenty CRM',
      attributes: {
        version: '1.0.0',
        environment: 'production',
        owner: config.alertEmail || 'admin',
        team: 'Engineering',
        project: 'Twenty CRM',
        costCenter: 'Operations',
      },
    });

    // Create attribute group for technical metadata
    const technicalAttributes = new appreg.AttributeGroup(this, 'TechnicalAttributes', {
      attributeGroupName: 'Twenty-CRM-TechnicalInfo',
      description: 'Technical architecture metadata for Twenty CRM',
      attributes: {
        architecture: 'serverless',
        components: {
          compute: 'ECS Fargate',
          database: 'Aurora Serverless v2',
          cache: 'ElastiCache Redis',
          storage: 'S3',
          loadBalancer: 'Application Load Balancer',
          monitoring: 'CloudWatch',
        },
        region: cdk.Aws.REGION,
        managedBy: 'AWS CDK',
        repository: 'https://github.com/GLK-Technologies/twenty',
      },
    });

    // Associate attribute groups with the application
    application.associateAttributeGroup(projectAttributes);
    application.associateAttributeGroup(technicalAttributes);

    // Stack Outputs
    const appUrl = config.domainName
      ? `https://${config.domainName}`
      : `http://${compute.outputs.loadBalancerDns}`;

    new cdk.CfnOutput(this, 'ApplicationURL', {
      value: appUrl,
      description: 'Twenty CRM Application URL',
      exportName: 'TwentyApplicationURL',
    });

    new cdk.CfnOutput(this, 'DeploymentInstructions', {
      value: [
        'Deployment complete! Next steps:',
        '1. Wait 2-3 minutes for services to start',
        `2. Visit ${appUrl}`,
        '3. Create your account (use "Continue with Email")',
        '4. Configure integrations via Settings > Admin Panel',
        '5. (Optional) Register background jobs - see DEPLOYMENT.md',
      ].join('\n'),
      description: 'Post-deployment instructions',
    });

    // Add stack-level tags
    cdk.Tags.of(this).add('Application', 'Twenty');
    cdk.Tags.of(this).add('ManagedBy', 'CDK');
  }
}
