import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export type StorageStackOutputs = {
  bucket: s3.IBucket;
  bucketName: string;
};

export class StorageStack extends Construct {
  public readonly outputs: StorageStackOutputs;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    // Create S3 bucket for file storage
    const bucket = new s3.Bucket(this, 'TwentyStorageBucket', {
      bucketName: `twenty-storage-${cdk.Aws.ACCOUNT_ID}-${cdk.Aws.REGION}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: false, // Disable versioning for cost savings
      lifecycleRules: [
        {
          // Transition to Infrequent Access after 90 days
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(90),
            },
          ],
        },
        {
          // Delete incomplete multipart uploads after 7 days
          abortIncompleteMultipartUploadAfter: cdk.Duration.days(7),
        },
      ],
      cors: [
        {
          allowedMethods: [
            s3.HttpMethods.GET,
            s3.HttpMethods.PUT,
            s3.HttpMethods.POST,
            s3.HttpMethods.DELETE,
          ],
          allowedOrigins: ['*'], // Will be restricted to actual domain in production
          allowedHeaders: ['*'],
          exposedHeaders: ['ETag'],
          maxAge: 3600,
        },
      ],
      removalPolicy: cdk.RemovalPolicy.RETAIN, // Retain bucket on stack deletion
      autoDeleteObjects: false, // Don't auto-delete for safety
    });

    // Output bucket information
    new cdk.CfnOutput(this, 'StorageBucketName', {
      value: bucket.bucketName,
      description: 'S3 bucket for Twenty file storage',
      exportName: 'TwentyStorageBucketName',
    });

    new cdk.CfnOutput(this, 'StorageBucketArn', {
      value: bucket.bucketArn,
      description: 'S3 bucket ARN',
      exportName: 'TwentyStorageBucketArn',
    });

    // Add tags
    cdk.Tags.of(bucket).add('Component', 'Storage');

    this.outputs = {
      bucket,
      bucketName: bucket.bucketName,
    };
  }
}
