import * as path from "node:path";
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as cr from "aws-cdk-lib/custom-resources";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subscriptions from "aws-cdk-lib/aws-sns-subscriptions";

export interface FinOpsBudgetAlertStackProps extends cdk.StackProps {
  slackWebhookSecretName: string;
  budgetName: string;
  budgetAlertThresholds: number[];
  budgetForecastAlertThreshold: number;
}

export class FinOpsBudgetAlertStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: FinOpsBudgetAlertStackProps) {
    super(scope, id, props);

    const slackWebhookSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      "SlackWebhookSecret",
      props.slackWebhookSecretName,
    );
    const logGroup = new logs.LogGroup(this, "BudgetAlertLogGroup", {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    const alertFunction = new nodejs.NodejsFunction(this, "BudgetAlertFunction", {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(__dirname, "../src/budget-alert-handler.ts"),
      handler: "handler",
      memorySize: 128,
      timeout: cdk.Duration.seconds(30),
      reservedConcurrentExecutions: 2,
      logGroup,
      bundling: {
        minify: true,
        sourceMap: true,
        target: "node22",
        bundleAwsSDK: true,
      },
      environment: { SLACK_WEBHOOK_SECRET_ARN: slackWebhookSecret.secretArn },
    });
    slackWebhookSecret.grantRead(alertFunction);

    const topic = new sns.Topic(this, "BudgetAlertTopic", {
      displayName: "FinOps budget alerts",
    });
    topic.addSubscription(new subscriptions.LambdaSubscription(alertFunction));
    topic.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: "AllowAwsBudgetsToPublish",
        principals: [new iam.ServicePrincipal("budgets.amazonaws.com")],
        actions: ["sns:Publish"],
        resources: [topic.topicArn],
        conditions: { StringEquals: { "aws:SourceAccount": this.account } },
      }),
    );

    const thresholds = [...new Set(props.budgetAlertThresholds)]
      .filter((threshold) => Number.isFinite(threshold) && threshold > 0 && threshold <= 100)
      .sort((a, b) => a - b);
    if (thresholds.length === 0) {
      throw new Error("budgetAlertThresholds must contain a percentage between 0 and 100");
    }

    let previousSubscriber: cr.AwsCustomResource | undefined;
    for (const threshold of thresholds) {
      const notification = {
        NotificationType: "ACTUAL",
        ComparisonOperator: "GREATER_THAN",
        Threshold: threshold,
      };
      const subscriber = new cr.AwsCustomResource(this, `BudgetSlackSubscriber${threshold}`, {
        onCreate: {
          service: "Budgets",
          action: "createSubscriber",
          region: "us-east-1",
          parameters: {
            AccountId: this.account,
            BudgetName: props.budgetName,
            Notification: notification,
            Subscriber: { SubscriptionType: "SNS", Address: topic.topicArn },
          },
          physicalResourceId: cr.PhysicalResourceId.of(`${this.stackName}-budget-slack-${threshold}`),
        },
        onDelete: {
          service: "Budgets",
          action: "deleteSubscriber",
          region: "us-east-1",
          parameters: {
            AccountId: this.account,
            BudgetName: props.budgetName,
            Notification: notification,
            Subscriber: { SubscriptionType: "SNS", Address: topic.topicArn },
          },
        },
        policy: cr.AwsCustomResourcePolicy.fromStatements([
          new iam.PolicyStatement({
            // AWS Budgets authorizes subscriber changes as a budget modification.
            actions: ["budgets:ModifyBudget"],
            resources: [
              `arn:${this.partition}:budgets::${this.account}:budget/${props.budgetName}`,
            ],
          }),
        ]),
        installLatestAwsSdk: false,
      });
      subscriber.node.addDependency(topic);
      if (previousSubscriber) subscriber.node.addDependency(previousSubscriber);
      previousSubscriber = subscriber;
    }

    const forecastThreshold = props.budgetForecastAlertThreshold;
    if (!Number.isFinite(forecastThreshold) || forecastThreshold <= 0 || forecastThreshold > 100) {
      throw new Error("budgetForecastAlertThreshold must be a percentage between 0 and 100");
    }
    const forecastNotification = {
      NotificationType: "FORECASTED",
      ComparisonOperator: "GREATER_THAN",
      Threshold: forecastThreshold,
    };
    const forecastSubscriber = new cr.AwsCustomResource(this, "BudgetForecastSlackNotification", {
      onCreate: {
        service: "Budgets",
        action: "createNotification",
        region: "us-east-1",
        parameters: {
          AccountId: this.account,
          BudgetName: props.budgetName,
          Notification: forecastNotification,
          Subscribers: [{ SubscriptionType: "SNS", Address: topic.topicArn }],
        },
        physicalResourceId: cr.PhysicalResourceId.of(
          `${this.stackName}-budget-forecast-slack-${forecastThreshold}`,
        ),
      },
      onDelete: {
        service: "Budgets",
        action: "deleteNotification",
        region: "us-east-1",
        parameters: {
          AccountId: this.account,
          BudgetName: props.budgetName,
          Notification: forecastNotification,
        },
      },
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          actions: ["budgets:ModifyBudget"],
          resources: [
            `arn:${this.partition}:budgets::${this.account}:budget/${props.budgetName}`,
          ],
        }),
      ]),
      installLatestAwsSdk: false,
    });
    forecastSubscriber.node.addDependency(previousSubscriber ?? topic);

    new cdk.CfnOutput(this, "BudgetName", { value: props.budgetName });
    new cdk.CfnOutput(this, "BudgetAlertThresholds", { value: thresholds.join(", ") });
    new cdk.CfnOutput(this, "BudgetForecastAlertThreshold", { value: String(forecastThreshold) });
    new cdk.CfnOutput(this, "BudgetAlertTopicArn", { value: topic.topicArn });
    new cdk.CfnOutput(this, "BudgetAlertFunctionName", { value: alertFunction.functionName });
  }
}
