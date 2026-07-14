import * as path from "node:path";
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ce from "aws-cdk-lib/aws-ce";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as scheduler from "aws-cdk-lib/aws-scheduler";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as sqs from "aws-cdk-lib/aws-sqs";

export interface FinOpsFeedbackStackProps extends cdk.StackProps {
  slackWebhookSecretName: string;
  scheduleExpression: string;
  scheduleTimezone: string;
  bedrockModelId: string;
  bedrockRegion: string;
  reportLookbackDays: number;
  costMetric: string;
  scheduleEnabled: boolean;
  createAnomalyMonitor: boolean;
  investigationEnabled: boolean;
  investigationMinChangeUsd: number;
  investigationMinChangePercent: number;
  investigationMaxTargets: number;
  investigationMaxToolCalls: number;
  investigationMaxTurns: number;
}

export class FinOpsFeedbackStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: FinOpsFeedbackStackProps) {
    super(scope, id, props);

    const slackWebhookSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      "SlackWebhookSecret",
      props.slackWebhookSecretName,
    );

    const deadLetterQueue = new sqs.Queue(this, "ScheduleDeadLetterQueue", {
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      retentionPeriod: cdk.Duration.days(14),
    });

    const logGroup = new logs.LogGroup(this, "CostFeedbackLogGroup", {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    const investigationLogGroup = new logs.LogGroup(this, "InvestigationLogGroup", {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    let anomalyMonitor: ce.CfnAnomalyMonitor | undefined;
    if (props.createAnomalyMonitor) {
      anomalyMonitor = new ce.CfnAnomalyMonitor(this, "ServiceCostAnomalyMonitor", {
        monitorName: `${this.stackName}-service-cost-monitor`,
        monitorType: "DIMENSIONAL",
        monitorDimension: "SERVICE",
      });
    }

    const reportFunction = new nodejs.NodejsFunction(this, "CostFeedbackFunction", {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(__dirname, "../src/handler.ts"),
      handler: "handler",
      memorySize: 768,
      timeout: cdk.Duration.minutes(5),
      reservedConcurrentExecutions: 1,
      logGroup,
      bundling: {
        minify: true,
        sourceMap: true,
        target: "node22",
        bundleAwsSDK: true,
      },
      environment: {
        SLACK_WEBHOOK_SECRET_ARN: slackWebhookSecret.secretArn,
        BEDROCK_MODEL_ID: props.bedrockModelId,
        BEDROCK_REGION: props.bedrockRegion,
        COST_EXPLORER_REGION: "us-east-1",
        AWS_ACCOUNT_ID: this.account,
        REPORT_TIMEZONE: props.scheduleTimezone,
        REPORT_LOOKBACK_DAYS: String(props.reportLookbackDays),
        COST_METRIC: props.costMetric,
        EVIDENCE_LOOKBACK_DAYS: "14",
        ANOMALY_LOOKBACK_DAYS: "30",
        EC2_LOW_CPU_THRESHOLD: "10",
        RDS_LOW_CPU_THRESHOLD: "20",
      },
    });

    const investigationFunction = new nodejs.NodejsFunction(this, "InvestigationFunction", {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(__dirname, "../src/investigation-handler.ts"),
      handler: "handler",
      memorySize: 768,
      timeout: cdk.Duration.minutes(3),
      reservedConcurrentExecutions: 1,
      logGroup: investigationLogGroup,
      bundling: {
        minify: true,
        sourceMap: true,
        target: "node22",
        bundleAwsSDK: true,
      },
      environment: {
        BEDROCK_MODEL_ID: props.bedrockModelId,
        BEDROCK_REGION: props.bedrockRegion,
        COST_EXPLORER_REGION: "us-east-1",
        COST_METRIC: props.costMetric,
        FINOPS_INVESTIGATION_ENABLED: String(props.investigationEnabled),
        FINOPS_INVESTIGATION_MIN_CHANGE_USD: String(props.investigationMinChangeUsd),
        FINOPS_INVESTIGATION_MIN_CHANGE_PERCENT: String(props.investigationMinChangePercent),
        FINOPS_INVESTIGATION_MAX_TARGETS: String(props.investigationMaxTargets),
        FINOPS_INVESTIGATION_MAX_TOOL_CALLS: String(props.investigationMaxToolCalls),
        FINOPS_INVESTIGATION_MAX_TURNS: String(props.investigationMaxTurns),
      },
    });
    reportFunction.addEnvironment("INVESTIGATION_FUNCTION_NAME", investigationFunction.functionName);
    investigationFunction.grantInvoke(reportFunction);

    slackWebhookSecret.grantRead(reportFunction);

    reportFunction.addToRolePolicy(
      new iam.PolicyStatement({
        sid: "ReadCostExplorer",
        actions: [
          "ce:GetCostAndUsage",
          "ce:GetCostForecast",
          "ce:GetAnomalies",
          "ce:ListCostAllocationTags",
        ],
        resources: ["*"],
      }),
    );

    investigationFunction.addToRolePolicy(
      new iam.PolicyStatement({
        sid: "InvestigateCostExplorer",
        actions: ["ce:GetCostAndUsage"],
        resources: ["*"],
      }),
    );

    investigationFunction.addToRolePolicy(
      new iam.PolicyStatement({
        sid: "InvestigateCloudTrailChanges",
        actions: ["cloudtrail:LookupEvents"],
        resources: ["*"],
      }),
    );

    investigationFunction.addToRolePolicy(
      new iam.PolicyStatement({
        sid: "InvestigateResourceInventory",
        actions: [
          "ec2:DescribeInstances",
          "lambda:ListFunctions",
          "rds:DescribeDBInstances",
          "s3:ListAllMyBuckets",
        ],
        resources: ["*"],
      }),
    );

    investigationFunction.addToRolePolicy(
      new iam.PolicyStatement({
        sid: "InvestigateS3LifecycleConfiguration",
        actions: ["s3:GetLifecycleConfiguration"],
        resources: [`arn:${this.partition}:s3:::*`],
      }),
    );

    reportFunction.addToRolePolicy(
      new iam.PolicyStatement({
        sid: "ReadBudgets",
        actions: ["budgets:ViewBudget"],
        resources: [`arn:${this.partition}:budgets::${this.account}:budget/*`],
      }),
    );

    reportFunction.addToRolePolicy(
      new iam.PolicyStatement({
        sid: "ReadCostOptimizationHub",
        actions: [
          "cost-optimization-hub:GetPreferences",
          "cost-optimization-hub:GetRecommendation",
          "cost-optimization-hub:ListRecommendationSummaries",
          "cost-optimization-hub:ListRecommendations",
        ],
        resources: ["*"],
      }),
    );

    reportFunction.addToRolePolicy(
      new iam.PolicyStatement({
        sid: "ReadCloudWatchUtilization",
        actions: ["cloudwatch:ListMetrics", "cloudwatch:GetMetricData"],
        resources: ["*"],
      }),
    );

    reportFunction.addToRolePolicy(
      new iam.PolicyStatement({
        sid: "ReadComputeOptimizerRecommendations",
        actions: [
          "compute-optimizer:GetEnrollmentStatus",
          "compute-optimizer:GetEC2InstanceRecommendations",
          "compute-optimizer:GetEBSVolumeRecommendations",
          "compute-optimizer:GetLambdaFunctionRecommendations",
          "compute-optimizer:GetRDSDatabaseRecommendations",
          "compute-optimizer:GetIdleRecommendations",
        ],
        resources: ["*"],
      }),
    );

    reportFunction.addToRolePolicy(
      new iam.PolicyStatement({
        sid: "ReadComputeOptimizerDependencies",
        actions: [
          "ec2:DescribeInstances",
          "ec2:DescribeVolumes",
          "lambda:ListFunctions",
          "lambda:ListProvisionedConcurrencyConfigs",
          "rds:DescribeDBClusters",
          "rds:DescribeDBInstances",
        ],
        resources: ["*"],
      }),
    );

    reportFunction.addToRolePolicy(
      new iam.PolicyStatement({
        sid: "ReadTrustedAdvisorRecommendations",
        actions: ["trustedadvisor:ListRecommendations"],
        resources: ["*"],
      }),
    );

    const baseModelId = props.bedrockModelId.replace(
      /^(global|jp|us|eu|apac)\./,
      "",
    );
    reportFunction.addToRolePolicy(
      new iam.PolicyStatement({
        sid: "InvokeConfiguredBedrockModel",
        actions: ["bedrock:InvokeModel"],
        resources: [
          `arn:${this.partition}:bedrock:${props.bedrockRegion}:${this.account}:inference-profile/${props.bedrockModelId}`,
          `arn:${this.partition}:bedrock:*::foundation-model/${baseModelId}`,
        ],
      }),
    );
    investigationFunction.addToRolePolicy(
      new iam.PolicyStatement({
        sid: "InvokeConfiguredBedrockModel",
        actions: ["bedrock:InvokeModel"],
        resources: [
          `arn:${this.partition}:bedrock:${props.bedrockRegion}:${this.account}:inference-profile/${props.bedrockModelId}`,
          `arn:${this.partition}:bedrock:*::foundation-model/${baseModelId}`,
        ],
      }),
    );

    const schedulerRole = new iam.Role(this, "SchedulerExecutionRole", {
      assumedBy: new iam.ServicePrincipal("scheduler.amazonaws.com"),
      description: "Allows EventBridge Scheduler to invoke the FinOps feedback Lambda",
    });
    reportFunction.grantInvoke(schedulerRole);
    deadLetterQueue.grantSendMessages(schedulerRole);

    const schedule = new scheduler.CfnSchedule(this, "DailyCostFeedbackSchedule", {
      flexibleTimeWindow: { mode: "OFF" },
      scheduleExpression: props.scheduleExpression,
      scheduleExpressionTimezone: props.scheduleTimezone,
      description: "Send the daily AWS cost and optimization feedback to Slack",
      state: props.scheduleEnabled ? "ENABLED" : "DISABLED",
      target: {
        arn: reportFunction.functionArn,
        roleArn: schedulerRole.roleArn,
        input: JSON.stringify({ source: "eventbridge-scheduler", dryRun: false }),
        deadLetterConfig: { arn: deadLetterQueue.queueArn },
        retryPolicy: {
          maximumEventAgeInSeconds: 3600,
          maximumRetryAttempts: 2,
        },
      },
    });
    schedule.addDependency(schedulerRole.node.defaultChild as cdk.CfnResource);

    new cdk.CfnOutput(this, "CostFeedbackFunctionName", {
      value: reportFunction.functionName,
    });
    new cdk.CfnOutput(this, "InvestigationFunctionName", {
      value: investigationFunction.functionName,
    });
    new cdk.CfnOutput(this, "ScheduleName", {
      value: schedule.ref,
    });
    new cdk.CfnOutput(this, "DeadLetterQueueUrl", {
      value: deadLetterQueue.queueUrl,
    });
    new cdk.CfnOutput(this, "SlackWebhookSecretName", {
      value: props.slackWebhookSecretName,
    });
    if (anomalyMonitor) {
      new cdk.CfnOutput(this, "CostAnomalyMonitorArn", {
        value: anomalyMonitor.attrMonitorArn,
      });
    }
  }
}
