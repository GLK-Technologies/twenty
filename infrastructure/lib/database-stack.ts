import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as elasticache from 'aws-cdk-lib/aws-elasticache';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export type DatabaseStackProps = {
  vpc: ec2.IVpc;
  rdsSecurityGroup: ec2.ISecurityGroup;
  redisSecurityGroup: ec2.ISecurityGroup;
  auroraMinCapacity: number;
  auroraMaxCapacity: number;
};

export type DatabaseStackOutputs = {
  cluster: rds.IDatabaseCluster;
  clusterIdentifier: string;
  clusterEndpoint: string;
  databaseName: string;
  secret: secretsmanager.ISecret;
  databaseUrlSecret: secretsmanager.ISecret;
  redisEndpoint: string;
  redisClusterId: string;
};

export class DatabaseStack extends Construct {
  public readonly outputs: DatabaseStackOutputs;

  constructor(scope: Construct, id: string, props: DatabaseStackProps) {
    super(scope, id);

    const { vpc, rdsSecurityGroup, redisSecurityGroup, auroraMinCapacity, auroraMaxCapacity } = props;

    // Database name
    const databaseName = 'twenty';

    // Create secret for database credentials
    const databaseSecret = new secretsmanager.Secret(this, 'DatabaseSecret', {
      secretName: 'twenty/database/credentials',
      description: 'Twenty database credentials',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          username: 'postgres',
        }),
        generateStringKey: 'password',
        excludePunctuation: true,
        includeSpace: false,
        passwordLength: 32,
      },
    });

    // Create Aurora Serverless v2 Cluster
    const cluster = new rds.DatabaseCluster(this, 'AuroraCluster', {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_16_6,
      }),
      credentials: rds.Credentials.fromSecret(databaseSecret),
      defaultDatabaseName: databaseName,
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      securityGroups: [rdsSecurityGroup],
      serverlessV2MinCapacity: auroraMinCapacity,
      serverlessV2MaxCapacity: auroraMaxCapacity,
      writer: rds.ClusterInstance.serverlessV2('Writer', {
        enablePerformanceInsights: false, // Disable to save costs
        publiclyAccessible: false,
      }),
      // No readers for cost optimization (single instance)
      backup: {
        retention: cdk.Duration.days(7),
        preferredWindow: '03:00-04:00', // 3 AM UTC
      },
      preferredMaintenanceWindow: 'sun:04:00-sun:05:00', // Sunday 4 AM UTC
      cloudwatchLogsExports: ['postgresql'], // Enable PostgreSQL logs
      cloudwatchLogsRetention: 7, // 7 days retention
      storageEncrypted: true,
      deletionProtection: false, // Set to true in production
      removalPolicy: cdk.RemovalPolicy.SNAPSHOT, // Create snapshot on deletion
    });

    // Create subnet group for ElastiCache
    const redisSubnetGroup = new elasticache.CfnSubnetGroup(
      this,
      'RedisSubnetGroup',
      {
        description: 'Subnet group for Twenty Redis',
        subnetIds: vpc.selectSubnets({
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        }).subnetIds,
        cacheSubnetGroupName: 'twenty-redis-subnet-group',
      },
    );

    // Create ElastiCache Redis (single node, no cluster mode)
    const redisCluster = new elasticache.CfnCacheCluster(this, 'RedisCluster', {
      cacheNodeType: 'cache.t4g.micro',
      engine: 'redis',
      engineVersion: '7.0',
      numCacheNodes: 1,
      cacheSubnetGroupName: redisSubnetGroup.cacheSubnetGroupName,
      vpcSecurityGroupIds: [redisSecurityGroup.securityGroupId],
      preferredMaintenanceWindow: 'sun:05:00-sun:06:00',
      snapshotRetentionLimit: 5, // Keep 5 snapshots
      snapshotWindow: '02:00-03:00', // 2 AM UTC
      autoMinorVersionUpgrade: true,
    });

    redisCluster.addDependency(redisSubnetGroup);

    // Create a secret for the full database URL
    // We construct this by combining the secret username/password with the endpoint
    const dbUsername = databaseSecret.secretValueFromJson('username').unsafeUnwrap();
    const dbPassword = databaseSecret.secretValueFromJson('password').unsafeUnwrap();
    const dbUrl = `postgres://${dbUsername}:${dbPassword}@${cluster.clusterEndpoint.hostname}:${cluster.clusterEndpoint.port}/${databaseName}`;

    const databaseUrlSecret = new secretsmanager.Secret(this, 'DatabaseUrlSecret', {
      secretName: 'twenty/database/connection-url',
      description: 'Complete database connection URL for Twenty',
      secretStringValue: cdk.SecretValue.unsafePlainText(dbUrl),
    });

    // Outputs
    const clusterEndpoint = cluster.clusterEndpoint.socketAddress;
    const redisEndpoint = `redis://${redisCluster.attrRedisEndpointAddress}:${redisCluster.attrRedisEndpointPort}`;

    // Export values for use in other stacks
    new cdk.CfnOutput(this, 'DatabaseEndpoint', {
      value: clusterEndpoint,
      description: 'Aurora cluster endpoint',
      exportName: 'TwentyDatabaseEndpoint',
    });

    new cdk.CfnOutput(this, 'DatabaseSecretArn', {
      value: databaseSecret.secretArn,
      description: 'Database credentials secret ARN',
      exportName: 'TwentyDatabaseSecretArn',
    });

    new cdk.CfnOutput(this, 'RedisEndpoint', {
      value: redisEndpoint,
      description: 'Redis endpoint',
      exportName: 'TwentyRedisEndpoint',
    });

    // Add tags
    cdk.Tags.of(cluster).add('Component', 'Database');
    cdk.Tags.of(redisCluster).add('Component', 'Cache');

    this.outputs = {
      cluster,
      clusterIdentifier: cluster.clusterIdentifier,
      clusterEndpoint,
      databaseName,
      secret: databaseSecret,
      databaseUrlSecret,
      redisEndpoint,
      redisClusterId: redisCluster.ref,
    };
  }
}
