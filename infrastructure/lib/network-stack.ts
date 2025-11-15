import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

export type NetworkStackProps = {
  maxAzs?: number;
  natGateways?: number;
};

export type NetworkStackOutputs = {
  vpc: ec2.IVpc;
  albSecurityGroup: ec2.ISecurityGroup;
  ecsSecurityGroup: ec2.ISecurityGroup;
  rdsSecurityGroup: ec2.ISecurityGroup;
  redisSecurityGroup: ec2.ISecurityGroup;
};

export class NetworkStack extends Construct {
  public readonly outputs: NetworkStackOutputs;

  constructor(scope: Construct, id: string, props?: NetworkStackProps) {
    super(scope, id);

    // Create VPC with single AZ for cost optimization
    const vpc = new ec2.Vpc(this, 'TwentyVpc', {
      maxAzs: props?.maxAzs || 1, // Single AZ for cost savings
      natGateways: props?.natGateways || 1, // Single NAT Gateway
      subnetConfiguration: [
        {
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
      ],
      enableDnsHostnames: true,
      enableDnsSupport: true,
    });

    // Add VPC Flow Logs for security monitoring
    vpc.addFlowLog('FlowLog', {
      destination: ec2.FlowLogDestination.toCloudWatchLogs(),
    });

    // Security Group for Application Load Balancer
    const albSecurityGroup = new ec2.SecurityGroup(this, 'AlbSecurityGroup', {
      vpc,
      description: 'Security group for Twenty ALB',
      allowAllOutbound: true,
    });

    // Allow HTTP and HTTPS from anywhere
    albSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      'Allow HTTP from anywhere',
    );
    albSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      'Allow HTTPS from anywhere',
    );

    // Security Group for ECS Tasks (Server & Worker)
    const ecsSecurityGroup = new ec2.SecurityGroup(this, 'EcsSecurityGroup', {
      vpc,
      description: 'Security group for Twenty ECS tasks',
      allowAllOutbound: true,
    });

    // Allow traffic from ALB to ECS on port 3000
    ecsSecurityGroup.addIngressRule(
      albSecurityGroup,
      ec2.Port.tcp(3000),
      'Allow traffic from ALB',
    );

    // Security Group for RDS (Aurora)
    const rdsSecurityGroup = new ec2.SecurityGroup(this, 'RdsSecurityGroup', {
      vpc,
      description: 'Security group for Twenty Aurora database',
      allowAllOutbound: false,
    });

    // Allow PostgreSQL from ECS
    rdsSecurityGroup.addIngressRule(
      ecsSecurityGroup,
      ec2.Port.tcp(5432),
      'Allow PostgreSQL from ECS tasks',
    );

    // Security Group for ElastiCache Redis
    const redisSecurityGroup = new ec2.SecurityGroup(
      this,
      'RedisSecurityGroup',
      {
        vpc,
        description: 'Security group for Twenty Redis',
        allowAllOutbound: false,
      },
    );

    // Allow Redis from ECS
    redisSecurityGroup.addIngressRule(
      ecsSecurityGroup,
      ec2.Port.tcp(6379),
      'Allow Redis from ECS tasks',
    );

    // Output tags for better organization
    cdk.Tags.of(vpc).add('Component', 'Network');
    cdk.Tags.of(albSecurityGroup).add('Component', 'LoadBalancer');
    cdk.Tags.of(ecsSecurityGroup).add('Component', 'Compute');
    cdk.Tags.of(rdsSecurityGroup).add('Component', 'Database');
    cdk.Tags.of(redisSecurityGroup).add('Component', 'Cache');

    this.outputs = {
      vpc,
      albSecurityGroup,
      ecsSecurityGroup,
      rdsSecurityGroup,
      redisSecurityGroup,
    };
  }
}
