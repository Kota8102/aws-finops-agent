import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDateWindows,
  formatSlackMessage,
  parseFeedback,
  summarizeDailyTotals,
  summarizeServiceCosts,
  type DailyCostRow,
} from "../src/handler";
import { formatBudgetAlertMessage } from "../src/budget-alert-handler";
import { isActionableAnomaly, type FinOpsEvidence } from "../src/collectors";
import { selectInvestigationTargets, type FinOpsInvestigation } from "../src/investigation-handler";

test("buildDateWindows uses the requested timezone and exclusive end dates", () => {
  const windows = buildDateWindows(new Date("2026-07-14T00:30:00Z"), "Asia/Tokyo", 7);
  assert.deepEqual(windows, {
    previousStart: "2026-06-30",
    recentStart: "2026-07-07",
    todayExclusive: "2026-07-14",
    monthStart: "2026-07-01",
    lookbackDays: 7,
  });
});

test("summarizeServiceCosts compares the two complete periods", () => {
  const windows = buildDateWindows(new Date("2026-07-14T00:30:00Z"), "Asia/Tokyo", 7);
  const rows: DailyCostRow[] = [
    { date: "2026-07-06", service: "Amazon Elastic Compute Cloud", amount: 10 },
    { date: "2026-07-07", service: "Amazon Elastic Compute Cloud", amount: 12 },
    { date: "2026-07-08", service: "Amazon Elastic Compute Cloud", amount: 13 },
    { date: "2026-07-07", service: "Amazon Simple Storage Service", amount: 4 },
    { date: "2026-07-08", service: "Amazon Simple Storage Service", amount: 5 },
  ];
  const summaries = summarizeServiceCosts(rows, windows);
  const ec2 = summaries.find((item) => item.service === "Amazon Elastic Compute Cloud");
  assert.equal(ec2?.recentCost, 25);
  assert.equal(ec2?.previousCost, 10);
  assert.equal(ec2?.changeAmount, 15);
});

test("summarizeDailyTotals aggregates spend per day inside the window", () => {
  const rows: DailyCostRow[] = [
    { date: "2026-06-29", service: "Amazon Elastic Compute Cloud", amount: 99 },
    { date: "2026-07-07", service: "Amazon Elastic Compute Cloud", amount: 10 },
    { date: "2026-07-07", service: "Amazon Simple Storage Service", amount: 2 },
    { date: "2026-07-08", service: "Amazon Elastic Compute Cloud", amount: 5 },
  ];
  assert.deepEqual(summarizeDailyTotals(rows, "2026-06-30", "2026-07-14"), [
    { date: "2026-07-07", amount: 12 },
    { date: "2026-07-08", amount: 5 },
  ]);
});

test("isActionableAnomaly requires recency and material impact", () => {
  const criteria = { activeWithinDays: 7, minImpactUsd: 10 };
  const today = "2026-07-14";
  assert.equal(isActionableAnomaly({ totalImpact: 25 }, today, criteria), true);
  assert.equal(isActionableAnomaly({ endDate: "2026-07-10", totalImpact: 25 }, today, criteria), true);
  assert.equal(isActionableAnomaly({ endDate: "2026-06-20", totalImpact: 500 }, today, criteria), false);
  assert.equal(isActionableAnomaly({ totalImpact: 3 }, today, criteria), false);
});

test("selectInvestigationTargets limits the agent to material cost increases", () => {
  const report = {
    generatedAt: "2026-07-14T00:30:00.000Z",
    currency: "USD",
    recentPeriod: { start: "2026-07-07", endExclusive: "2026-07-14" },
    previousPeriod: { start: "2026-06-30", endExclusive: "2026-07-07" },
    monthToDatePeriod: { start: "2026-07-01", endExclusive: "2026-07-14" },
    recentTotal: 1_000,
    previousTotal: 600,
    changeAmount: 400,
    changePercent: 66.7,
    monthToDateTotal: 1_000,
    monthToDateProjection: 2_000,
    costExplorerForecast: 1_900,
    dailyTotals: [],
    dataNote: "test",
    serviceSummaries: [
      {
        service: "Amazon Elastic Compute Cloud - Compute",
        recentCost: 500,
        previousCost: 300,
        changeAmount: 200,
        changePercent: 66.7,
        recentSharePercent: 50,
      },
      {
        service: "Amazon Simple Storage Service",
        recentCost: 250,
        previousCost: 175,
        changeAmount: 75,
        changePercent: 42.9,
        recentSharePercent: 25,
      },
      {
        service: "Tax",
        recentCost: 250,
        previousCost: 0,
        changeAmount: 250,
        changePercent: null,
        recentSharePercent: 25,
      },
    ],
  };
  const targets = selectInvestigationTargets(report);
  assert.deepEqual(targets.map((target) => target.service), ["Amazon Elastic Compute Cloud - Compute"]);
});

test("parseFeedback accepts a fenced JSON response", () => {
  const feedback = parseFeedback(`
    \`\`\`json
    {"summary":"増加しています","highlights":[],"savingsActions":[],"watchouts":["確認"]}
    \`\`\`
  `);
  assert.equal(feedback.summary, "増加しています");
  assert.deepEqual(feedback.watchouts, ["確認"]);
});

test("formatBudgetAlertMessage keeps the alert concise and links to AWS Budgets", () => {
  const payload = formatBudgetAlertMessage(
    "AWS Budgets: My Monthly Cost Budget forecasted exceeds 90%",
    "Forecasted cost is $6,584.17 against a 6,000 USD monthly budget.",
  );
  assert.match(payload.text, /AWS Budget アラート/);
  assert.match(JSON.stringify(payload.blocks), /月末予測が予算しきい値を超過/);
  assert.match(JSON.stringify(payload.blocks), /通知しきい値: \*90%\*/);
  assert.match(JSON.stringify(payload.blocks), /\$6,584.17/);
  assert.match(JSON.stringify(payload.blocks), /billing\/home/);
  assert.doesNotMatch(JSON.stringify(payload.blocks), /Forecasted cost is/);
  assert.ok(payload.blocks.length <= 3);
});

test("formatSlackMessage is concise and action oriented", () => {
  const report = {
    generatedAt: "2026-07-14T00:30:00.000Z",
    currency: "USD",
    recentPeriod: { start: "2026-07-07", endExclusive: "2026-07-14" },
    previousPeriod: { start: "2026-06-30", endExclusive: "2026-07-07" },
    monthToDatePeriod: { start: "2026-07-01", endExclusive: "2026-07-14" },
    recentTotal: 25,
    previousTotal: 10,
    changeAmount: 15,
    changePercent: 150,
    monthToDateTotal: 30,
    monthToDateProjection: 71.5,
    costExplorerForecast: 68,
    dailyTotals: [
      { date: "2026-07-07", amount: 2 },
      { date: "2026-07-12", amount: 9 },
    ],
    serviceSummaries: [{
      service: "Amazon Elastic Compute Cloud",
      recentCost: 25,
      previousCost: 10,
      changeAmount: 15,
      changePercent: 150,
      recentSharePercent: 100,
    }],
    dataNote: "テストデータ",
  };
  const feedback = {
    summary: "EC2が増えています",
    highlights: [],
    savingsActions: [{
      priority: "P1",
      action: "夜間停止を検討",
      expectedImpact: "利用時間を削減",
      howToValidate: "7日間比較",
      risk: "本番影響を確認",
    }],
    watchouts: [],
  } satisfies Parameters<typeof formatSlackMessage>[1];
  const payload = formatSlackMessage(report, feedback);
  assert.match(payload.text, /今やること/);
  assert.match(payload.text, /前7日比/);
  assert.doesNotMatch(JSON.stringify(payload.blocks), /効果:/);
  assert.doesNotMatch(JSON.stringify(payload.blocks), /検証:/);
  assert.doesNotMatch(JSON.stringify(payload.blocks), /注意点/);
  assert.match(JSON.stringify(payload.blocks), /要確認/);
  assert.match(JSON.stringify(payload.blocks), /前7日比/);
  assert.match(JSON.stringify(payload.blocks), /P0=今すぐ \/ P1=今週 \/ P2=計画/);
  assert.ok(payload.blocks.length <= 7);

  const fallbackPayload = formatSlackMessage(report, feedback, "Bedrock unavailable");
  assert.match(JSON.stringify(fallbackPayload.blocks), /AI分析はフォールバック/);
  assert.ok(fallbackPayload.blocks.length <= 7);

  const evidence = {
    cloudWatch: {
      source: "CloudWatch", status: "ok", region: "ap-northeast-1", collectedAt: report.generatedAt,
      data: {
        lookbackDays: 14,
        lowUtilizationThresholds: { ec2CpuAveragePercent: 10, rdsCpuAveragePercent: 20 },
        scannedResources: 1,
        signals: [],
        notes: [],
      },
    },
    computeOptimizer: {
      source: "Compute Optimizer", status: "ok", region: "ap-northeast-1", collectedAt: report.generatedAt,
      data: { enrollmentStatus: "Active", recommendations: [], partialErrors: [], truncated: false },
    },
    trustedAdvisor: {
      source: "Trusted Advisor", status: "ok", region: "us-east-1", collectedAt: report.generatedAt,
      data: { recommendations: [], totalEstimatedMonthlySavings: 0 },
    },
    budgets: {
      source: "AWS Budgets", status: "ok", region: "us-east-1", collectedAt: report.generatedAt,
      data: {
        budgets: [{
          name: "Monthly cost", type: "COST", limit: 100, actual: 150, forecast: 175,
          currency: "USD", actualPercent: 150, forecastPercent: 175, alarmNotificationCount: 1,
        }],
        overBudgetCount: 1,
        forecastOverBudgetCount: 1,
      },
    },
    costOptimizationHub: {
      source: "Cost Optimization Hub", status: "ok", region: "us-east-1", collectedAt: report.generatedAt,
      data: {
        savingsEstimationMode: "AfterDiscounts",
        currency: "USD",
        estimatedTotalDedupedSavings: 123,
        recommendations: [{
          id: "recommendation-1", actionType: "Rightsize", resourceType: "Ec2Instance",
          resourceId: "i-0123456789abcdef0", region: "ap-northeast-1", estimatedMonthlySavings: 123,
        }],
        groupedSavings: [{ actionType: "Rightsize", estimatedMonthlySavings: 123, recommendationCount: 1 }],
        truncated: false,
      },
    },
    costAllocationTags: {
      source: "Cost allocation tags", status: "ok", region: "us-east-1", collectedAt: report.generatedAt,
      data: { activeTagKeys: ["CostCenter"], totalActiveTags: 1 },
    },
    costAnomalies: {
      source: "Cost Anomaly Detection", status: "ok", region: "us-east-1", collectedAt: report.generatedAt,
      data: {
        lookbackDays: 30,
        anomalies: [],
        totalImpact: 0,
        actionableAnomalyCount: 0,
        actionableTotalImpact: 0,
        actionableCriteria: { activeWithinDays: 7, minImpactUsd: 10 },
      },
    },
  } satisfies FinOpsEvidence;
  const actionablePayload = formatSlackMessage(report, feedback, undefined, evidence);
  const renderedBlocks = JSON.stringify(actionablePayload.blocks);
  assert.match(renderedBlocks, /要対応/);
  assert.match(renderedBlocks, /削減候補\/月（重複除外）/);
  assert.match(renderedBlocks, /凡例: CW=CloudWatch低CPU/);
  assert.match(renderedBlocks, /cost-explorer/);
  assert.match(renderedBlocks, /budgets\/overview/);
  assert.match(renderedBlocks, /cost-optimization-hub/);
  assert.match(renderedBlocks, /Instances:instanceId=i-0123456789abcdef0/);
  assert.ok(actionablePayload.blocks.length <= 7);

  const investigation = {
    status: "completed",
    targets: [{
      service: "Amazon Elastic Compute Cloud - Compute",
      recentCost: 25,
      previousCost: 10,
      changeAmount: 15,
      changePercent: 150,
    }],
    maxToolCalls: 6,
    toolCallsUsed: 2,
    steps: [],
    conclusion: { findings: [] },
  } satisfies FinOpsInvestigation;
  const investigatedPayload = formatSlackMessage(report, feedback, undefined, evidence, investigation);
  assert.match(JSON.stringify(investigatedPayload.blocks), /調査: EC2 完了（2\/6）/);
});

function emptyEvidence(collectedAt: string): FinOpsEvidence {
  return {
    cloudWatch: {
      source: "CloudWatch", status: "ok", region: "ap-northeast-1", collectedAt,
      data: {
        lookbackDays: 14,
        lowUtilizationThresholds: { ec2CpuAveragePercent: 10, rdsCpuAveragePercent: 20 },
        scannedResources: 0,
        signals: [],
        notes: [],
      },
    },
    computeOptimizer: {
      source: "Compute Optimizer", status: "ok", region: "ap-northeast-1", collectedAt,
      data: { enrollmentStatus: "Active", recommendations: [], partialErrors: [], truncated: false },
    },
    trustedAdvisor: {
      source: "Trusted Advisor", status: "ok", region: "us-east-1", collectedAt,
      data: { recommendations: [], totalEstimatedMonthlySavings: 0 },
    },
    budgets: {
      source: "AWS Budgets", status: "ok", region: "us-east-1", collectedAt,
      data: { budgets: [], overBudgetCount: 0, forecastOverBudgetCount: 0 },
    },
    costOptimizationHub: {
      source: "Cost Optimization Hub", status: "ok", region: "us-east-1", collectedAt,
      data: { estimatedTotalDedupedSavings: 0, recommendations: [], groupedSavings: [], truncated: false },
    },
    costAllocationTags: {
      source: "Cost allocation tags", status: "ok", region: "us-east-1", collectedAt,
      data: { activeTagKeys: [], totalActiveTags: 0 },
    },
    costAnomalies: {
      source: "Cost Anomaly Detection", status: "ok", region: "global", collectedAt,
      data: {
        lookbackDays: 30,
        anomalies: [],
        totalImpact: 0,
        actionableAnomalyCount: 0,
        actionableTotalImpact: 0,
        actionableCriteria: { activeWithinDays: 7, minImpactUsd: 10 },
      },
    },
  };
}

test("formatSlackMessage surfaces findings, watchouts, and actionable anomalies", () => {
  const report = {
    generatedAt: "2026-07-14T00:30:00.000Z",
    currency: "USD",
    recentPeriod: { start: "2026-07-07", endExclusive: "2026-07-14" },
    previousPeriod: { start: "2026-06-30", endExclusive: "2026-07-07" },
    monthToDatePeriod: { start: "2026-07-01", endExclusive: "2026-07-14" },
    recentTotal: 100,
    previousTotal: 90,
    changeAmount: 10,
    changePercent: 11.1,
    monthToDateTotal: 130,
    monthToDateProjection: 300,
    costExplorerForecast: 280,
    dailyTotals: [],
    serviceSummaries: [],
    dataNote: "テストデータ",
  };
  const feedback = {
    summary: "S3のリクエスト課金が増加しています",
    highlights: [{
      service: "Amazon Simple Storage Service",
      finding: "リクエスト課金が前7日比3倍",
      evidence: "PutRequests $40→$120",
    }],
    savingsActions: [
      { priority: "P0", action: "S3増加元の確認", expectedImpact: "-", howToValidate: "-", risk: "-" },
      { priority: "P1", action: "低利用EC2の停止可否確認", expectedImpact: "-", howToValidate: "-", risk: "-" },
      { priority: "P2", action: "ライフサイクルルールの整備", expectedImpact: "-", howToValidate: "-", risk: "-" },
    ],
    watchouts: ["バケット別の増加元はStorage Lensでのみ特定できます"],
  } satisfies Parameters<typeof formatSlackMessage>[1];

  const observed = JSON.stringify(formatSlackMessage(report, feedback).blocks);
  assert.match(observed, /\*観察\*/);
  assert.match(observed, /リクエスト課金が前7日比3倍/);
  assert.match(observed, /⚠ バケット別の増加元/);
  assert.match(observed, /③ \*P2\*/);

  const investigation = {
    status: "completed",
    targets: [{
      service: "Amazon Simple Storage Service",
      recentCost: 60,
      previousCost: 20,
      changeAmount: 40,
      changePercent: 200,
    }],
    maxToolCalls: 6,
    toolCallsUsed: 3,
    steps: [],
    conclusion: {
      findings: [{
        service: "Amazon Simple Storage Service",
        assessment: "PutRequestsの増加が主因の可能性",
        confidence: "medium",
        evidence: "USAGE_TYPE内訳でRequests-Tier1が+$95",
      }],
    },
  } satisfies FinOpsInvestigation;
  const investigated = JSON.stringify(
    formatSlackMessage(report, feedback, undefined, undefined, investigation).blocks,
  );
  assert.match(investigated, /原因の仮説（調査Agent）/);
  assert.match(investigated, /PutRequestsの増加が主因の可能性/);
  assert.match(investigated, /確信度: 中/);
  assert.doesNotMatch(investigated, /\*観察\*/);

  const calmFeedback = { ...feedback, savingsActions: [], watchouts: [] };
  const pastOnly = emptyEvidence(report.generatedAt);
  pastOnly.costAnomalies.data.anomalies = [
    { id: "a1", totalImpact: 120, endDate: "2026-06-20", rootCauses: [] },
  ];
  pastOnly.costAnomalies.data.totalImpact = 120;
  const pastPayload = JSON.stringify(formatSlackMessage(report, calmFeedback, undefined, pastOnly).blocks);
  assert.match(pastPayload, /正常/);
  assert.match(pastPayload, /異常 ✓ 0（過去1）/);

  const active = emptyEvidence(report.generatedAt);
  active.costAnomalies.data.anomalies = [{ id: "a2", totalImpact: 120, rootCauses: [] }];
  active.costAnomalies.data.totalImpact = 120;
  active.costAnomalies.data.actionableAnomalyCount = 1;
  active.costAnomalies.data.actionableTotalImpact = 120;
  const activePayload = JSON.stringify(formatSlackMessage(report, calmFeedback, undefined, active).blocks);
  assert.match(activePayload, /要対応/);
  assert.match(activePayload, /異常 ✓ 1件 \$120\.00/);
});
