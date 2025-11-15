import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import { Construct } from 'constructs';

export type MonitoringStackProps = {
  databaseCluster: rds.IDatabaseCluster;
  databaseClusterIdentifier: string;
  redisClusterId: string;
  ecsClusterName: string;
  serverServiceName: string;
  workerServiceName: string;
  loadBalancer: elbv2.IApplicationLoadBalancer;
  targetGroupFullName: string;
  alertEmail?: string;
};

export class MonitoringStack extends Construct {
  public readonly dashboard: cloudwatch.Dashboard;
  public readonly alarmTopic?: sns.Topic;

  constructor(scope: Construct, id: string, props: MonitoringStackProps) {
    super(scope, id);

    const {
      databaseClusterIdentifier,
      redisClusterId,
      ecsClusterName,
      serverServiceName,
      workerServiceName,
      loadBalancer,
      targetGroupFullName,
      alertEmail,
    } = props;

    // Create SNS topic for alarms if email provided
    if (alertEmail) {
      this.alarmTopic = new sns.Topic(this, 'AlarmTopic', {
        topicName: 'twenty-crm-alerts',
        displayName: 'Twenty CRM Monitoring Alerts',
      });

      this.alarmTopic.addSubscription(
        new subscriptions.EmailSubscription(alertEmail),
      );
    }

    // Create CloudWatch Dashboard
    this.dashboard = new cloudwatch.Dashboard(this, 'Dashboard', {
      dashboardName: 'Twenty-CRM-Production',
      periodOverride: cloudwatch.PeriodOverride.AUTO,
      defaultInterval: cdk.Duration.hours(3),
    });

    // === HEADER ROW ===
    this.dashboard.addWidgets(
      new cloudwatch.TextWidget({
        markdown: `# Twenty CRM - Production Monitoring Dashboard

**Environment:** Production
**Region:** ${cdk.Stack.of(this).region}
**Last Updated:** Auto-refresh enabled

## Quick Links
- [ECS Services](https://${cdk.Stack.of(this).region}.console.aws.amazon.com/ecs/v2/clusters/${ecsClusterName}/services)
- [RDS Database](https://${cdk.Stack.of(this).region}.console.aws.amazon.com/rds/home?region=${cdk.Stack.of(this).region}#database:id=${databaseClusterIdentifier})
- [Application Logs](https://${cdk.Stack.of(this).region}.console.aws.amazon.com/cloudwatch/home?region=${cdk.Stack.of(this).region}#logsV2:log-groups)

## Alert Status
${alertEmail ? `📧 Alerts configured: ${alertEmail}` : '⚠️ No alert email configured'}`,
        width: 24,
        height: 4,
      }),
    );

    // === AURORA DATABASE ROW ===

    // Aurora ACU Utilization
    const auroraAcuMetric = new cloudwatch.Metric({
      namespace: 'AWS/RDS',
      metricName: 'ACUUtilization',
      dimensionsMap: {
        DBClusterIdentifier: databaseClusterIdentifier,
      },
      statistic: 'Average',
      period: cdk.Duration.minutes(5),
    });

    // Aurora CPU Utilization
    const auroraCpuMetric = new cloudwatch.Metric({
      namespace: 'AWS/RDS',
      metricName: 'CPUUtilization',
      dimensionsMap: {
        DBClusterIdentifier: databaseClusterIdentifier,
      },
      statistic: 'Average',
      period: cdk.Duration.minutes(5),
    });

    // Database Connections
    const dbConnectionsMetric = new cloudwatch.Metric({
      namespace: 'AWS/RDS',
      metricName: 'DatabaseConnections',
      dimensionsMap: {
        DBClusterIdentifier: databaseClusterIdentifier,
      },
      statistic: 'Average',
      period: cdk.Duration.minutes(5),
    });

    // Serverless Database Capacity (ACU)
    const dbCapacityMetric = new cloudwatch.Metric({
      namespace: 'AWS/RDS',
      metricName: 'ServerlessDatabaseCapacity',
      dimensionsMap: {
        DBClusterIdentifier: databaseClusterIdentifier,
      },
      statistic: 'Average',
      period: cdk.Duration.minutes(5),
    });

    // Read/Write Latency
    const readLatencyMetric = new cloudwatch.Metric({
      namespace: 'AWS/RDS',
      metricName: 'ReadLatency',
      dimensionsMap: {
        DBClusterIdentifier: databaseClusterIdentifier,
      },
      statistic: 'Average',
      period: cdk.Duration.minutes(5),
      unit: cloudwatch.Unit.MILLISECONDS,
    });

    const writeLatencyMetric = new cloudwatch.Metric({
      namespace: 'AWS/RDS',
      metricName: 'WriteLatency',
      dimensionsMap: {
        DBClusterIdentifier: databaseClusterIdentifier,
      },
      statistic: 'Average',
      period: cdk.Duration.minutes(5),
      unit: cloudwatch.Unit.MILLISECONDS,
    });

    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Aurora ACU Utilization (%)',
        left: [auroraAcuMetric],
        width: 12,
        height: 6,
        leftYAxis: {
          min: 0,
          max: 100,
        },
      }),
      new cloudwatch.GraphWidget({
        title: 'Aurora CPU & Connections',
        left: [auroraCpuMetric],
        right: [dbConnectionsMetric],
        width: 12,
        height: 6,
        leftYAxis: {
          label: 'CPU %',
          min: 0,
          max: 100,
        },
        rightYAxis: {
          label: 'Connections',
        },
      }),
      new cloudwatch.GraphWidget({
        title: 'Database Read/Write Latency (ms)',
        left: [readLatencyMetric, writeLatencyMetric],
        width: 12,
        height: 6,
        leftYAxis: {
          label: 'Milliseconds',
        },
      }),
      new cloudwatch.GraphWidget({
        title: 'Serverless Database Capacity (ACU)',
        left: [dbCapacityMetric],
        width: 12,
        height: 6,
        leftYAxis: {
          label: 'ACU',
          min: 0,
        },
      }),
    );

    // === ECS SERVICES ROW ===

    // Server CPU/Memory
    const serverCpuMetric = new cloudwatch.Metric({
      namespace: 'AWS/ECS',
      metricName: 'CPUUtilization',
      dimensionsMap: {
        ServiceName: serverServiceName,
        ClusterName: ecsClusterName,
      },
      statistic: 'Average',
      period: cdk.Duration.minutes(5),
    });

    const serverMemoryMetric = new cloudwatch.Metric({
      namespace: 'AWS/ECS',
      metricName: 'MemoryUtilization',
      dimensionsMap: {
        ServiceName: serverServiceName,
        ClusterName: ecsClusterName,
      },
      statistic: 'Average',
      period: cdk.Duration.minutes(5),
    });

    // Worker CPU/Memory
    const workerCpuMetric = new cloudwatch.Metric({
      namespace: 'AWS/ECS',
      metricName: 'CPUUtilization',
      dimensionsMap: {
        ServiceName: workerServiceName,
        ClusterName: ecsClusterName,
      },
      statistic: 'Average',
      period: cdk.Duration.minutes(5),
    });

    const workerMemoryMetric = new cloudwatch.Metric({
      namespace: 'AWS/ECS',
      metricName: 'MemoryUtilization',
      dimensionsMap: {
        ServiceName: workerServiceName,
        ClusterName: ecsClusterName,
      },
      statistic: 'Average',
      period: cdk.Duration.minutes(5),
    });

    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Server Service - CPU & Memory (%)',
        left: [serverCpuMetric, serverMemoryMetric],
        width: 12,
        height: 6,
        leftYAxis: {
          min: 0,
          max: 100,
        },
      }),
      new cloudwatch.GraphWidget({
        title: 'Worker Service - CPU & Memory (%)',
        left: [workerCpuMetric, workerMemoryMetric],
        width: 12,
        height: 6,
        leftYAxis: {
          min: 0,
          max: 100,
        },
      }),
    );

    // === APPLICATION LOAD BALANCER ROW ===

    const albNameParts = loadBalancer.loadBalancerArn.split(':loadbalancer/');
    const loadBalancerFullName = albNameParts[1];

    // Request Count
    const requestCountMetric = new cloudwatch.Metric({
      namespace: 'AWS/ApplicationELB',
      metricName: 'RequestCount',
      dimensionsMap: {
        LoadBalancer: loadBalancerFullName,
      },
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
    });

    // Target Response Time
    const responseTimeMetric = new cloudwatch.Metric({
      namespace: 'AWS/ApplicationELB',
      metricName: 'TargetResponseTime',
      dimensionsMap: {
        LoadBalancer: loadBalancerFullName,
      },
      statistic: 'Average',
      period: cdk.Duration.minutes(5),
      unit: cloudwatch.Unit.SECONDS,
    });

    // Healthy Host Count
    const healthyHostMetric = new cloudwatch.Metric({
      namespace: 'AWS/ApplicationELB',
      metricName: 'HealthyHostCount',
      dimensionsMap: {
        TargetGroup: targetGroupFullName,
        LoadBalancer: loadBalancerFullName,
      },
      statistic: 'Average',
      period: cdk.Duration.minutes(1),
    });

    const unhealthyHostMetric = new cloudwatch.Metric({
      namespace: 'AWS/ApplicationELB',
      metricName: 'UnHealthyHostCount',
      dimensionsMap: {
        TargetGroup: targetGroupFullName,
        LoadBalancer: loadBalancerFullName,
      },
      statistic: 'Average',
      period: cdk.Duration.minutes(1),
    });

    // HTTP Status Codes
    const http2xxMetric = new cloudwatch.Metric({
      namespace: 'AWS/ApplicationELB',
      metricName: 'HTTPCode_Target_2XX_Count',
      dimensionsMap: {
        LoadBalancer: loadBalancerFullName,
      },
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
    });

    const http4xxMetric = new cloudwatch.Metric({
      namespace: 'AWS/ApplicationELB',
      metricName: 'HTTPCode_Target_4XX_Count',
      dimensionsMap: {
        LoadBalancer: loadBalancerFullName,
      },
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
    });

    const http5xxMetric = new cloudwatch.Metric({
      namespace: 'AWS/ApplicationELB',
      metricName: 'HTTPCode_Target_5XX_Count',
      dimensionsMap: {
        LoadBalancer: loadBalancerFullName,
      },
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
    });

    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'ALB Request Count & Response Time',
        left: [requestCountMetric],
        right: [responseTimeMetric],
        width: 12,
        height: 6,
        leftYAxis: {
          label: 'Requests',
        },
        rightYAxis: {
          label: 'Seconds',
        },
      }),
      new cloudwatch.GraphWidget({
        title: 'HTTP Status Codes',
        left: [http2xxMetric, http4xxMetric, http5xxMetric],
        width: 6,
        height: 6,
        leftYAxis: {
          label: 'Count',
        },
      }),
      new cloudwatch.GraphWidget({
        title: 'Target Health',
        left: [healthyHostMetric, unhealthyHostMetric],
        width: 6,
        height: 6,
        leftYAxis: {
          label: 'Hosts',
          min: 0,
        },
      }),
    );

    // === REDIS CACHE ROW ===

    // Redis CPU
    const redisCpuMetric = new cloudwatch.Metric({
      namespace: 'AWS/ElastiCache',
      metricName: 'CPUUtilization',
      dimensionsMap: {
        CacheClusterId: redisClusterId,
      },
      statistic: 'Average',
      period: cdk.Duration.minutes(5),
    });

    // Redis Memory
    const redisMemoryMetric = new cloudwatch.Metric({
      namespace: 'AWS/ElastiCache',
      metricName: 'DatabaseMemoryUsagePercentage',
      dimensionsMap: {
        CacheClusterId: redisClusterId,
      },
      statistic: 'Average',
      period: cdk.Duration.minutes(5),
    });

    // Redis Connections
    const redisConnectionsMetric = new cloudwatch.Metric({
      namespace: 'AWS/ElastiCache',
      metricName: 'CurrConnections',
      dimensionsMap: {
        CacheClusterId: redisClusterId,
      },
      statistic: 'Average',
      period: cdk.Duration.minutes(5),
    });

    // Redis Evictions
    const redisEvictionsMetric = new cloudwatch.Metric({
      namespace: 'AWS/ElastiCache',
      metricName: 'Evictions',
      dimensionsMap: {
        CacheClusterId: redisClusterId,
      },
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
    });

    this.dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Redis CPU & Memory (%)',
        left: [redisCpuMetric, redisMemoryMetric],
        width: 12,
        height: 6,
        leftYAxis: {
          min: 0,
          max: 100,
        },
      }),
      new cloudwatch.GraphWidget({
        title: 'Redis Connections & Evictions',
        left: [redisConnectionsMetric],
        right: [redisEvictionsMetric],
        width: 12,
        height: 6,
        leftYAxis: {
          label: 'Connections',
        },
        rightYAxis: {
          label: 'Evictions',
        },
      }),
    );

    // === CREATE ALARMS ===

    if (this.alarmTopic) {
      const alarmAction = new actions.SnsAction(this.alarmTopic);

      // 1. Aurora CPU High
      const auroraCpuAlarm = new cloudwatch.Alarm(this, 'AuroraCpuHighAlarm', {
        metric: auroraCpuMetric,
        threshold: 90,
        evaluationPeriods: 2,
        datapointsToAlarm: 2,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        alarmDescription: 'Aurora CPU exceeds 90% - consider scaling up ACU capacity',
        alarmName: 'Twenty-Aurora-CPU-High',
        actionsEnabled: true,
      });
      auroraCpuAlarm.addAlarmAction(alarmAction);

      // 2. Aurora ACU Near Max
      const auroraAcuAlarm = new cloudwatch.Alarm(this, 'AuroraAcuHighAlarm', {
        metric: auroraAcuMetric,
        threshold: 80,
        evaluationPeriods: 3,
        datapointsToAlarm: 3,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        alarmDescription: 'Aurora ACU utilization exceeds 80% - increase auroraMaxCapacity',
        alarmName: 'Twenty-Aurora-ACU-High',
        actionsEnabled: true,
      });
      auroraAcuAlarm.addAlarmAction(alarmAction);

      // 3. Server CPU High
      const serverCpuAlarm = new cloudwatch.Alarm(this, 'ServerCpuHighAlarm', {
        metric: serverCpuMetric,
        threshold: 85,
        evaluationPeriods: 2,
        datapointsToAlarm: 2,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        alarmDescription: 'Server CPU exceeds 85% - consider increasing serverCpu',
        alarmName: 'Twenty-Server-CPU-High',
        actionsEnabled: true,
      });
      serverCpuAlarm.addAlarmAction(alarmAction);

      // 4. Worker Memory High
      const workerMemoryAlarm = new cloudwatch.Alarm(this, 'WorkerMemoryHighAlarm', {
        metric: workerMemoryMetric,
        threshold: 85,
        evaluationPeriods: 2,
        datapointsToAlarm: 2,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        alarmDescription: 'Worker memory exceeds 85% - consider increasing workerMemory',
        alarmName: 'Twenty-Worker-Memory-High',
        actionsEnabled: true,
      });
      workerMemoryAlarm.addAlarmAction(alarmAction);

      // 5. Unhealthy Hosts
      const unhealthyHostAlarm = new cloudwatch.Alarm(this, 'UnhealthyHostAlarm', {
        metric: healthyHostMetric,
        threshold: 1,
        evaluationPeriods: 2,
        datapointsToAlarm: 2,
        comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
        alarmDescription: 'No healthy hosts available - service may be down',
        alarmName: 'Twenty-Unhealthy-Hosts',
        actionsEnabled: true,
      });
      unhealthyHostAlarm.addAlarmAction(alarmAction);

      // 6. High 5xx Errors
      const http5xxAlarm = new cloudwatch.Alarm(this, 'Http5xxHighAlarm', {
        metric: http5xxMetric,
        threshold: 10,
        evaluationPeriods: 1,
        datapointsToAlarm: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        alarmDescription: 'More than 10 5xx errors in 5 minutes - check application logs',
        alarmName: 'Twenty-HTTP-5xx-High',
        actionsEnabled: true,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
      http5xxAlarm.addAlarmAction(alarmAction);

      // 7. High Response Time
      const responseTimeAlarm = new cloudwatch.Alarm(this, 'ResponseTimeHighAlarm', {
        metric: responseTimeMetric.with({
          statistic: 'p99',
        }),
        threshold: 2,
        evaluationPeriods: 2,
        datapointsToAlarm: 2,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        alarmDescription: 'P99 response time exceeds 2 seconds - investigate performance',
        alarmName: 'Twenty-Response-Time-High',
        actionsEnabled: true,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
      responseTimeAlarm.addAlarmAction(alarmAction);

      // 8. Redis Memory High
      const redisMemoryAlarm = new cloudwatch.Alarm(this, 'RedisMemoryHighAlarm', {
        metric: redisMemoryMetric,
        threshold: 80,
        evaluationPeriods: 2,
        datapointsToAlarm: 2,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        alarmDescription: 'Redis memory exceeds 80% - consider larger instance',
        alarmName: 'Twenty-Redis-Memory-High',
        actionsEnabled: true,
      });
      redisMemoryAlarm.addAlarmAction(alarmAction);
    }

    // Output dashboard URL
    new cdk.CfnOutput(this, 'DashboardURL', {
      value: `https://${cdk.Stack.of(this).region}.console.aws.amazon.com/cloudwatch/home?region=${cdk.Stack.of(this).region}#dashboards:name=Twenty-CRM-Production`,
      description: 'CloudWatch Dashboard URL',
      exportName: 'TwentyDashboardURL',
    });

    if (this.alarmTopic) {
      new cdk.CfnOutput(this, 'AlarmTopicArn', {
        value: this.alarmTopic.topicArn,
        description: 'SNS Topic ARN for alarms',
        exportName: 'TwentyAlarmTopicArn',
      });
    }
  }
}
