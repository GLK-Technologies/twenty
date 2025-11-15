import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import { Construct } from 'constructs';

export type ComputeStackProps = {
  vpc: ec2.IVpc;
  albSecurityGroup: ec2.ISecurityGroup;
  ecsSecurityGroup: ec2.ISecurityGroup;
  databaseUrlSecret: secretsmanager.ISecret;
  redisEndpoint: string;
  storageBucket: s3.IBucket;
  serverCpu: number;
  serverMemory: number;
  workerCpu: number;
  workerMemory: number;
  useFargateSpot?: boolean;
  domainName?: string;
  hostedZoneId?: string;
  hostedZoneName?: string;
  certificateArn?: string;
};

export type ComputeStackOutputs = {
  cluster: ecs.ICluster;
  loadBalancerDns: string;
  loadBalancerArn: string;
};

export class ComputeStack extends Construct {
  public readonly outputs: ComputeStackOutputs;

  constructor(scope: Construct, id: string, props: ComputeStackProps) {
    super(scope, id);

    const {
      vpc,
      albSecurityGroup,
      ecsSecurityGroup,
      databaseUrlSecret,
      redisEndpoint,
      storageBucket,
      serverCpu,
      serverMemory,
      workerCpu,
      workerMemory,
      useFargateSpot = true,
      domainName,
      hostedZoneId,
      hostedZoneName,
      certificateArn,
    } = props;

    // Create ECS Cluster
    const cluster = new ecs.Cluster(this, 'TwentyCluster', {
      vpc,
      clusterName: 'twenty-cluster',
      containerInsights: false, // Disable to save costs
    });

    // Create Application Load Balancer
    const alb = new elbv2.ApplicationLoadBalancer(this, 'LoadBalancer', {
      vpc,
      internetFacing: true,
      securityGroup: albSecurityGroup,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
    });

    // Create APP_SECRET
    const appSecret = new secretsmanager.Secret(this, 'AppSecret', {
      secretName: 'twenty/app/secret',
      description: 'Twenty application secret',
      generateSecretString: {
        passwordLength: 32,
        excludePunctuation: true,
      },
    });

    // Create IAM role for ECS tasks
    const taskRole = new iam.Role(this, 'TaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: 'Role for Twenty ECS tasks',
    });

    // Grant S3 access to task role
    storageBucket.grantReadWrite(taskRole);

    // Grant secrets access
    databaseUrlSecret.grantRead(taskRole);
    appSecret.grantRead(taskRole);

    // Create execution role for ECS tasks
    const executionRole = new iam.Role(this, 'ExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AmazonECSTaskExecutionRolePolicy',
        ),
      ],
    });

    // Grant secrets access to execution role
    databaseUrlSecret.grantRead(executionRole);
    appSecret.grantRead(executionRole);

    // Create CloudWatch log groups
    const serverLogGroup = new logs.LogGroup(this, 'ServerLogGroup', {
      logGroupName: '/ecs/twenty-server',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const workerLogGroup = new logs.LogGroup(this, 'WorkerLogGroup', {
      logGroupName: '/ecs/twenty-worker',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Determine SERVER_URL based on domain configuration
    const serverUrl = domainName ? `https://${domainName}` : `http://${alb.loadBalancerDnsName}`;

    // Common environment variables
    const commonEnvironment = {
      NODE_PORT: '3000',
      SERVER_URL: serverUrl,
      REDIS_URL: redisEndpoint,
      STORAGE_TYPE: 's3',
      STORAGE_S3_REGION: cdk.Aws.REGION,
      STORAGE_S3_NAME: storageBucket.bucketName,
      IS_CONFIG_VARIABLES_IN_DB_ENABLED: 'true',
    };

    // Create Server Task Definition
    const serverTaskDefinition = new ecs.FargateTaskDefinition(
      this,
      'ServerTaskDef',
      {
        cpu: serverCpu,
        memoryLimitMiB: serverMemory,
        taskRole,
        executionRole,
      },
    );

    const serverContainer = serverTaskDefinition.addContainer('ServerContainer', {
      image: ecs.ContainerImage.fromRegistry('twentycrm/twenty:latest'),
      logging: ecs.LogDriver.awsLogs({
        streamPrefix: 'server',
        logGroup: serverLogGroup,
      }),
      environment: {
        ...commonEnvironment,
        DISABLE_CRON_JOBS_REGISTRATION: 'false', // Server handles cron jobs
      },
      secrets: {
        PG_DATABASE_URL: ecs.Secret.fromSecretsManager(databaseUrlSecret),
        APP_SECRET: ecs.Secret.fromSecretsManager(appSecret),
      },
      healthCheck: {
        command: ['CMD-SHELL', 'curl -f http://localhost:3000/healthz || exit 1'],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
        startPeriod: cdk.Duration.seconds(60),
      },
    });

    serverContainer.addPortMappings({
      containerPort: 3000,
      protocol: ecs.Protocol.TCP,
    });

    // Create Worker Task Definition
    const workerTaskDefinition = new ecs.FargateTaskDefinition(
      this,
      'WorkerTaskDef',
      {
        cpu: workerCpu,
        memoryLimitMiB: workerMemory,
        taskRole,
        executionRole,
      },
    );

    workerTaskDefinition.addContainer('WorkerContainer', {
      image: ecs.ContainerImage.fromRegistry('twentycrm/twenty:latest'),
      command: ['yarn', 'worker:prod'],
      logging: ecs.LogDriver.awsLogs({
        streamPrefix: 'worker',
        logGroup: workerLogGroup,
      }),
      environment: {
        ...commonEnvironment,
        DISABLE_DB_MIGRATIONS: 'true', // Migrations run on server
        DISABLE_CRON_JOBS_REGISTRATION: 'true', // Server handles cron jobs
      },
      secrets: {
        PG_DATABASE_URL: ecs.Secret.fromSecretsManager(databaseUrlSecret),
        APP_SECRET: ecs.Secret.fromSecretsManager(appSecret),
      },
    });

    // Determine capacity provider based on useFargateSpot
    const capacityProviderStrategies: ecs.CapacityProviderStrategy[] = useFargateSpot
      ? [
          {
            capacityProvider: 'FARGATE_SPOT',
            weight: 1,
            base: 0,
          },
        ]
      : [
          {
            capacityProvider: 'FARGATE',
            weight: 1,
            base: 1,
          },
        ];

    // Create Server Service
    const serverService = new ecs.FargateService(this, 'ServerService', {
      cluster,
      taskDefinition: serverTaskDefinition,
      desiredCount: 1,
      securityGroups: [ecsSecurityGroup],
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      capacityProviderStrategies,
      enableExecuteCommand: true, // Enable ECS Exec for debugging
      healthCheckGracePeriod: cdk.Duration.seconds(60),
    });

    // Create Worker Service
    const workerService = new ecs.FargateService(this, 'WorkerService', {
      cluster,
      taskDefinition: workerTaskDefinition,
      desiredCount: 1,
      securityGroups: [ecsSecurityGroup],
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      capacityProviderStrategies,
      enableExecuteCommand: true,
    });

    // Create Target Group
    const targetGroup = new elbv2.ApplicationTargetGroup(this, 'TargetGroup', {
      vpc,
      port: 3000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        path: '/healthz',
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
      },
      deregistrationDelay: cdk.Duration.seconds(30),
      // Enable session stickiness to prevent login issues
      stickinessCookieDuration: cdk.Duration.days(1),
      stickinessCookieName: 'TWENTYCRM_STICKY',
    });

    // Attach Server Service to Target Group
    serverService.attachToApplicationTargetGroup(targetGroup);

    // Configure HTTPS if certificate is provided
    if (certificateArn && domainName) {
      // Import the existing certificate
      const certificate = acm.Certificate.fromCertificateArn(
        this,
        'Certificate',
        certificateArn,
      );

      // Create HTTPS Listener
      alb.addListener('HttpsListener', {
        port: 443,
        protocol: elbv2.ApplicationProtocol.HTTPS,
        certificates: [certificate],
        defaultAction: elbv2.ListenerAction.forward([targetGroup]),
      });

      // Create HTTP Listener that redirects to HTTPS
      alb.addListener('HttpListener', {
        port: 80,
        protocol: elbv2.ApplicationProtocol.HTTP,
        defaultAction: elbv2.ListenerAction.redirect({
          protocol: 'HTTPS',
          port: '443',
          permanent: true,
        }),
      });

      // Create Route53 record
      if (hostedZoneId && hostedZoneName) {
        const hostedZone = route53.HostedZone.fromHostedZoneAttributes(
          this,
          'HostedZone',
          {
            hostedZoneId,
            zoneName: hostedZoneName,
          },
        );

        new route53.ARecord(this, 'AliasRecord', {
          zone: hostedZone,
          recordName: domainName,
          target: route53.RecordTarget.fromAlias(
            new route53Targets.LoadBalancerTarget(alb),
          ),
          comment: 'Twenty CRM application',
        });
      }
    } else {
      // No certificate - just HTTP
      alb.addListener('HttpListener', {
        port: 80,
        protocol: elbv2.ApplicationProtocol.HTTP,
        defaultAction: elbv2.ListenerAction.forward([targetGroup]),
      });
    }

    // Outputs
    new cdk.CfnOutput(this, 'LoadBalancerDNS', {
      value: alb.loadBalancerDnsName,
      description: 'Load Balancer DNS name',
      exportName: 'TwentyLoadBalancerDNS',
    });

    if (domainName) {
      new cdk.CfnOutput(this, 'ApplicationDomain', {
        value: `https://${domainName}`,
        description: 'Twenty application custom domain URL',
      });
    } else {
      new cdk.CfnOutput(this, 'LoadBalancerURL', {
        value: `http://${alb.loadBalancerDnsName}`,
        description: 'Twenty application URL',
      });
    }

    // Add tags
    cdk.Tags.of(cluster).add('Component', 'Compute');
    cdk.Tags.of(alb).add('Component', 'LoadBalancer');

    this.outputs = {
      cluster,
      loadBalancerDns: alb.loadBalancerDnsName,
      loadBalancerArn: alb.loadBalancerArn,
    };
  }
}
