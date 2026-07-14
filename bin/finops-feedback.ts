#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { FinOpsBudgetAlertStack } from "../lib/finops-budget-alert-stack";
import { FinOpsFeedbackStack } from "../lib/finops-feedback-stack";

const app = new cdk.App();

function parseBudgetAlertThresholds(value: string | undefined): number[] {
  return (value ?? "50,75,90")
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item));
}

new FinOpsFeedbackStack(app, "FinOpsFeedbackStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region:
      app.node.tryGetContext("deploymentRegion") ??
      process.env.CDK_DEPLOY_REGION ??
      "ap-northeast-1",
  },
  slackWebhookSecretName:
    app.node.tryGetContext("slackWebhookSecretName") ??
    process.env.SLACK_WEBHOOK_SECRET_NAME ??
    "finops/slack-webhook",
  scheduleTimezone:
    app.node.tryGetContext("scheduleTimezone") ??
    process.env.SCHEDULE_TIMEZONE ??
    "Asia/Tokyo",
  scheduleExpression:
    app.node.tryGetContext("scheduleExpression") ??
    process.env.SCHEDULE_EXPRESSION ??
    "cron(0 9 * * ? *)",
  bedrockModelId:
    app.node.tryGetContext("bedrockModelId") ??
    process.env.BEDROCK_MODEL_ID ??
    "global.anthropic.claude-sonnet-5",
  bedrockRegion:
    app.node.tryGetContext("bedrockRegion") ??
    process.env.BEDROCK_REGION ??
    "ap-northeast-1",
  reportLookbackDays: Number(
    app.node.tryGetContext("reportLookbackDays") ??
      process.env.REPORT_LOOKBACK_DAYS ??
      7,
  ),
  costMetric:
    app.node.tryGetContext("costMetric") ??
    process.env.COST_METRIC ??
    "UnblendedCost",
  scheduleEnabled:
    String(
      app.node.tryGetContext("scheduleEnabled") ??
        process.env.SCHEDULE_ENABLED ??
        "true",
    ).toLowerCase() !== "false",
  createAnomalyMonitor:
    String(
      app.node.tryGetContext("createAnomalyMonitor") ??
        process.env.CREATE_ANOMALY_MONITOR ??
        "false",
    ).toLowerCase() === "true",
  investigationEnabled:
    String(
      app.node.tryGetContext("investigationEnabled") ??
        process.env.FINOPS_INVESTIGATION_ENABLED ??
        "true",
    ).toLowerCase() !== "false",
  investigationMinChangeUsd: Number(
    app.node.tryGetContext("investigationMinChangeUsd") ??
      process.env.FINOPS_INVESTIGATION_MIN_CHANGE_USD ??
      100,
  ),
  investigationMinChangePercent: Number(
    app.node.tryGetContext("investigationMinChangePercent") ??
      process.env.FINOPS_INVESTIGATION_MIN_CHANGE_PERCENT ??
      20,
  ),
  investigationMaxTargets: Number(
    app.node.tryGetContext("investigationMaxTargets") ??
      process.env.FINOPS_INVESTIGATION_MAX_TARGETS ??
      3,
  ),
  investigationMaxToolCalls: Number(
    app.node.tryGetContext("investigationMaxToolCalls") ??
      process.env.FINOPS_INVESTIGATION_MAX_TOOL_CALLS ??
      6,
  ),
  investigationMaxTurns: Number(
    app.node.tryGetContext("investigationMaxTurns") ??
      process.env.FINOPS_INVESTIGATION_MAX_TURNS ??
      4,
  ),
});

new FinOpsBudgetAlertStack(app, "FinOpsBudgetAlertStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region:
      app.node.tryGetContext("deploymentRegion") ??
      process.env.CDK_DEPLOY_REGION ??
      "ap-northeast-1",
  },
  slackWebhookSecretName:
    app.node.tryGetContext("slackWebhookSecretName") ??
    process.env.SLACK_WEBHOOK_SECRET_NAME ??
    "finops/slack-webhook",
  budgetName:
    app.node.tryGetContext("budgetName") ??
    process.env.BUDGET_NAME ??
    "My Monthly Cost Budget",
  budgetAlertThresholds: parseBudgetAlertThresholds(
    app.node.tryGetContext("budgetAlertThresholds") ??
      process.env.BUDGET_ALERT_THRESHOLDS,
  ),
  budgetForecastAlertThreshold: Number(
    app.node.tryGetContext("budgetForecastAlertThreshold") ??
      process.env.BUDGET_FORECAST_ALERT_THRESHOLD ??
      90,
  ),
});
