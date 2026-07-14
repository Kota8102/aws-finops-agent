import {
  CloudWatchClient,
  GetMetricDataCommand,
  ListMetricsCommand,
  type Metric,
} from "@aws-sdk/client-cloudwatch";
import {
  BudgetsClient,
  DescribeBudgetsCommand,
  DescribeNotificationsForBudgetCommand,
} from "@aws-sdk/client-budgets";
import {
  ComputeOptimizerClient,
  GetEBSVolumeRecommendationsCommand,
  GetEC2InstanceRecommendationsCommand,
  GetEnrollmentStatusCommand,
  GetIdleRecommendationsCommand,
  GetLambdaFunctionRecommendationsCommand,
  GetRDSDatabaseRecommendationsCommand,
} from "@aws-sdk/client-compute-optimizer";
import {
  CostExplorerClient,
  GetAnomaliesCommand,
  ListCostAllocationTagsCommand,
} from "@aws-sdk/client-cost-explorer";
import {
  CostOptimizationHubClient,
  GetPreferencesCommand,
  ListRecommendationSummariesCommand,
  ListRecommendationsCommand as ListCostOptimizationHubRecommendationsCommand,
} from "@aws-sdk/client-cost-optimization-hub";
import {
  ListRecommendationsCommand,
  TrustedAdvisorClient,
} from "@aws-sdk/client-trustedadvisor";

export type CollectorStatus = "ok" | "unavailable" | "error";

export interface CollectorResult<T> {
  source: string;
  status: CollectorStatus;
  region: string;
  collectedAt: string;
  data: T;
  message?: string;
}

export interface CloudWatchSignal {
  resourceType: "EC2" | "RDS";
  resourceId: string;
  metric: "CPUUtilization";
  average: number;
  maximumDailyAverage: number;
  sampleCount: number;
  unit: "Percent";
  assessment: "low-utilization-candidate" | "observed";
}

export interface CloudWatchEvidence {
  lookbackDays: number;
  lowUtilizationThresholds: { ec2CpuAveragePercent: number; rdsCpuAveragePercent: number };
  scannedResources: number;
  signals: CloudWatchSignal[];
  notes: string[];
}

export interface SavingsEstimate {
  estimatedMonthlySavings?: number;
  savingsOpportunityPercentage?: number;
  currency?: string;
}

export interface ComputeOptimizerRecommendation extends SavingsEstimate {
  resourceType: "EC2" | "EBS" | "Lambda" | "RDS" | "IdleResource";
  resourceId: string;
  finding: string;
  currentConfiguration?: string;
  recommendedConfiguration?: string;
  reasons: string[];
  performanceRisk?: string | number;
  lookbackDays?: number;
}

export interface ComputeOptimizerEvidence {
  enrollmentStatus: string;
  recommendations: ComputeOptimizerRecommendation[];
  partialErrors: string[];
  truncated: boolean;
}

export interface TrustedAdvisorRecommendation {
  name: string;
  status: string;
  awsServices: string[];
  source: string;
  affectedResources: number;
  estimatedMonthlySavings?: number;
  estimatedPercentMonthlySavings?: number;
  lastUpdatedAt?: string;
}

export interface TrustedAdvisorEvidence {
  recommendations: TrustedAdvisorRecommendation[];
  totalEstimatedMonthlySavings: number;
}

export interface BudgetSummary {
  name: string;
  type: string;
  limit?: number;
  actual?: number;
  forecast?: number;
  currency?: string;
  actualPercent?: number;
  forecastPercent?: number;
  alarmNotificationCount: number;
}

export interface BudgetsEvidence {
  budgets: BudgetSummary[];
  overBudgetCount: number;
  forecastOverBudgetCount: number;
}

export interface CostOptimizationHubRecommendation {
  id: string;
  actionType: string;
  resourceType: string;
  resourceId?: string;
  resourceArn?: string;
  region?: string;
  estimatedMonthlySavings?: number;
  currency?: string;
  implementationEffort?: string;
  restartNeeded?: boolean;
  rollbackPossible?: boolean;
}

export interface CostOptimizationHubEvidence {
  savingsEstimationMode?: string;
  currency?: string;
  estimatedTotalDedupedSavings: number;
  recommendations: CostOptimizationHubRecommendation[];
  groupedSavings: Array<{
    actionType: string;
    estimatedMonthlySavings?: number;
    recommendationCount?: number;
  }>;
  truncated: boolean;
}

export interface CostAllocationTagsEvidence {
  activeTagKeys: string[];
  totalActiveTags: number;
}

export interface CostAnomalyEvidenceItem {
  id: string;
  monitorArn?: string;
  startDate?: string;
  endDate?: string;
  dimension?: string;
  totalImpact: number;
  impactPercentage?: number;
  actualSpend?: number;
  expectedSpend?: number;
  score?: number;
  rootCauses: Array<{
    service?: string;
    region?: string;
    usageType?: string;
    linkedAccountName?: string;
    contribution?: number;
  }>;
}

export interface CostAnomalyEvidence {
  lookbackDays: number;
  anomalies: CostAnomalyEvidenceItem[];
  totalImpact: number;
}

export interface FinOpsEvidence {
  cloudWatch: CollectorResult<CloudWatchEvidence>;
  computeOptimizer: CollectorResult<ComputeOptimizerEvidence>;
  trustedAdvisor: CollectorResult<TrustedAdvisorEvidence>;
  budgets: CollectorResult<BudgetsEvidence>;
  costOptimizationHub: CollectorResult<CostOptimizationHubEvidence>;
  costAllocationTags: CollectorResult<CostAllocationTagsEvidence>;
  costAnomalies: CollectorResult<CostAnomalyEvidence>;
}

interface SavingsShape {
  savingsOpportunity?: {
    savingsOpportunityPercentage?: number;
    estimatedMonthlySavings?: { value?: number; currency?: string };
  };
  savingsOpportunityAfterDiscounts?: {
    savingsOpportunityPercentage?: number;
    estimatedMonthlySavings?: { value?: number; currency?: string };
  };
}

const regionalRegion = process.env.AWS_REGION ?? "ap-northeast-1";
const globalRegion = "us-east-1";
const cloudWatch = new CloudWatchClient({ region: regionalRegion });
const computeOptimizer = new ComputeOptimizerClient({ region: regionalRegion });
const trustedAdvisor = new TrustedAdvisorClient({ region: globalRegion });
const costExplorer = new CostExplorerClient({ region: globalRegion });
const budgets = new BudgetsClient({ region: globalRegion });
const costOptimizationHub = new CostOptimizationHubClient({ region: globalRegion });

function addDays(dateString: string, days: number): string {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dateInTimezone(now: Date, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(now)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function resourceIdFromArn(arn: string | undefined, fallback: string): string {
  if (!arn) return fallback;
  return arn.split(/[/:]/).filter(Boolean).at(-1) ?? fallback;
}

function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error).slice(0, 500);
  return `${error.name}: ${error.message}`.slice(0, 500);
}

function isUnavailableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return [
    "AccessDeniedException",
    "OptInRequiredException",
    "SubscriptionRequiredException",
    "ValidationException",
  ].includes(error.name);
}

async function safeCollect<T>(
  source: string,
  region: string,
  emptyData: T,
  collect: () => Promise<T>,
  now: Date,
): Promise<CollectorResult<T>> {
  try {
    return {
      source,
      status: "ok",
      region,
      collectedAt: now.toISOString(),
      data: await collect(),
    };
  } catch (error) {
    return {
      source,
      status: isUnavailableError(error) ? "unavailable" : "error",
      region,
      collectedAt: now.toISOString(),
      data: emptyData,
      message: describeError(error),
    };
  }
}

async function listResourceMetrics(
  namespace: string,
  metricName: string,
  dimensionName: string,
  maxResources: number,
): Promise<Array<{ resourceId: string; metric: Metric }>> {
  const metricsByResource = new Map<string, Metric>();
  let nextToken: string | undefined;

  do {
    const response = await cloudWatch.send(
      new ListMetricsCommand({ Namespace: namespace, MetricName: metricName, NextToken: nextToken }),
    );
    for (const metric of response.Metrics ?? []) {
      const resourceId = metric.Dimensions?.find((dimension) => dimension.Name === dimensionName)?.Value;
      if (!resourceId) continue;
      const existing = metricsByResource.get(resourceId);
      if (!existing || (metric.Dimensions?.length ?? 99) < (existing.Dimensions?.length ?? 99)) {
        metricsByResource.set(resourceId, metric);
      }
      if (metricsByResource.size >= maxResources) break;
    }
    nextToken = response.NextToken;
  } while (nextToken && metricsByResource.size < maxResources);

  return [...metricsByResource.entries()].map(([resourceId, metric]) => ({ resourceId, metric }));
}

async function getCpuSignals(
  resourceType: "EC2" | "RDS",
  namespace: "AWS/EC2" | "AWS/RDS",
  dimensionName: "InstanceId" | "DBInstanceIdentifier",
  threshold: number,
  now: Date,
  lookbackDays: number,
): Promise<{ scanned: number; signals: CloudWatchSignal[] }> {
  const definitions = await listResourceMetrics(namespace, "CPUUtilization", dimensionName, 100);
  if (definitions.length === 0) return { scanned: 0, signals: [] };

  const response = await cloudWatch.send(
    new GetMetricDataCommand({
      StartTime: new Date(now.getTime() - lookbackDays * 86_400_000),
      EndTime: now,
      ScanBy: "TimestampDescending",
      MetricDataQueries: definitions.map(({ metric }, index) => ({
        Id: `m${index}`,
        ReturnData: true,
        MetricStat: {
          Metric: {
            Namespace: metric.Namespace,
            MetricName: metric.MetricName,
            Dimensions: metric.Dimensions,
          },
          Period: 86_400,
          Stat: "Average",
          Unit: "Percent",
        },
      })),
    }),
  );

  const signals = (response.MetricDataResults ?? [])
    .map((result) => {
      const index = Number(result.Id?.slice(1));
      const definition = definitions[index];
      const values = (result.Values ?? []).filter(Number.isFinite);
      if (!definition || values.length === 0) return undefined;
      const average = values.reduce((sum, value) => sum + value, 0) / values.length;
      return {
        resourceType,
        resourceId: definition.resourceId,
        metric: "CPUUtilization" as const,
        average,
        maximumDailyAverage: Math.max(...values),
        sampleCount: values.length,
        unit: "Percent" as const,
        assessment: average < threshold ? "low-utilization-candidate" as const : "observed" as const,
      };
    })
    .filter((signal): signal is CloudWatchSignal => Boolean(signal))
    .sort((a, b) => a.average - b.average);

  const low = signals.filter((signal) => signal.assessment === "low-utilization-candidate");
  const comparison = signals.filter((signal) => signal.assessment === "observed").slice(0, 5);
  return { scanned: definitions.length, signals: [...low, ...comparison].slice(0, 25) };
}

export async function collectCloudWatchEvidence(now = new Date()): Promise<CloudWatchEvidence> {
  const lookbackDays = Number(process.env.EVIDENCE_LOOKBACK_DAYS ?? 14);
  const ec2Threshold = Number(process.env.EC2_LOW_CPU_THRESHOLD ?? 10);
  const rdsThreshold = Number(process.env.RDS_LOW_CPU_THRESHOLD ?? 20);
  const [ec2, rds] = await Promise.all([
    getCpuSignals("EC2", "AWS/EC2", "InstanceId", ec2Threshold, now, lookbackDays),
    getCpuSignals("RDS", "AWS/RDS", "DBInstanceIdentifier", rdsThreshold, now, lookbackDays),
  ]);

  return {
    lookbackDays,
    lowUtilizationThresholds: {
      ec2CpuAveragePercent: ec2Threshold,
      rdsCpuAveragePercent: rdsThreshold,
    },
    scannedResources: ec2.scanned + rds.scanned,
    signals: [...ec2.signals, ...rds.signals],
    notes: [
      "低CPUは削減候補のシグナルであり、停止・縮小の根拠として単独では使用しません。",
      "CloudWatchの収集対象はデプロイリージョン内のEC2とRDSです。",
    ],
  };
}

function extractSavings(candidate: SavingsShape | undefined): SavingsEstimate {
  const selected = candidate?.savingsOpportunityAfterDiscounts ?? candidate?.savingsOpportunity;
  return {
    estimatedMonthlySavings: selected?.estimatedMonthlySavings?.value,
    savingsOpportunityPercentage: selected?.savingsOpportunityPercentage,
    currency: selected?.estimatedMonthlySavings?.currency,
  };
}

function rankFirst<T extends { rank?: number }>(options: T[] | undefined): T | undefined {
  return options?.slice().sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))[0];
}

async function collectPages<T>(
  fetchPage: (nextToken?: string) => Promise<{ items: T[]; nextToken?: string }>,
  maxItems = 1_000,
): Promise<{ items: T[]; truncated: boolean }> {
  const items: T[] = [];
  let nextToken: string | undefined;

  do {
    const page = await fetchPage(nextToken);
    items.push(...page.items);
    nextToken = page.nextToken;
  } while (nextToken && items.length < maxItems);

  return { items: items.slice(0, maxItems), truncated: Boolean(nextToken) };
}

function spendAmount(spend: { Amount?: string } | undefined): number | undefined {
  const amount = Number(spend?.Amount);
  return Number.isFinite(amount) ? amount : undefined;
}

function budgetPercent(amount: number | undefined, limit: number | undefined): number | undefined {
  if (amount === undefined || limit === undefined || limit <= 0) return undefined;
  return (amount / limit) * 100;
}

export async function collectBudgetsEvidence(): Promise<BudgetsEvidence> {
  const accountId = process.env.AWS_ACCOUNT_ID;
  if (!accountId) {
    const error = new Error("AWS_ACCOUNT_ID is not configured");
    error.name = "ValidationException";
    throw error;
  }

  const page = await collectPages(async (nextToken) => {
    const response = await budgets.send(
      new DescribeBudgetsCommand({ AccountId: accountId, MaxResults: 100, NextToken: nextToken }),
    );
    return { items: response.Budgets ?? [], nextToken: response.NextToken };
  }, 100);

  const costBudgets = page.items.filter((budget) => budget.BudgetType === "COST");
  const summaries = await Promise.all(
    costBudgets.map(async (budget) => {
      const name = budget.BudgetName ?? "Unnamed budget";
      const notifications = await budgets.send(
        new DescribeNotificationsForBudgetCommand({ AccountId: accountId, BudgetName: name }),
      ).catch(() => undefined);
      const limit = spendAmount(budget.BudgetLimit);
      const actual = spendAmount(budget.CalculatedSpend?.ActualSpend);
      const forecast = spendAmount(budget.CalculatedSpend?.ForecastedSpend);
      return {
        name,
        type: budget.BudgetType ?? "COST",
        limit,
        actual,
        forecast,
        currency: budget.BudgetLimit?.Unit ?? budget.CalculatedSpend?.ActualSpend?.Unit,
        actualPercent: budgetPercent(actual, limit),
        forecastPercent: budgetPercent(forecast, limit),
        alarmNotificationCount: (notifications?.Notifications ?? []).filter(
          (item) => item.NotificationState === "ALARM",
        ).length,
      } satisfies BudgetSummary;
    }),
  );

  summaries.sort(
    (a, b) =>
      Math.max(b.actualPercent ?? 0, b.forecastPercent ?? 0) -
      Math.max(a.actualPercent ?? 0, a.forecastPercent ?? 0),
  );
  return {
    budgets: summaries,
    overBudgetCount: summaries.filter((budget) => (budget.actualPercent ?? 0) >= 100).length,
    forecastOverBudgetCount: summaries.filter((budget) => (budget.forecastPercent ?? 0) >= 100).length,
  };
}

export async function collectCostOptimizationHubEvidence(): Promise<CostOptimizationHubEvidence> {
  const [preferences, summaries, recommendations] = await Promise.all([
    costOptimizationHub.send(new GetPreferencesCommand({})),
    costOptimizationHub.send(
      new ListRecommendationSummariesCommand({ groupBy: "ActionType", maxResults: 50 }),
    ),
    collectPages(async (nextToken) => {
      const response = await costOptimizationHub.send(
        new ListCostOptimizationHubRecommendationsCommand({
          includeAllRecommendations: false,
          maxResults: 50,
          nextToken,
        }),
      );
      return { items: response.items ?? [], nextToken: response.nextToken };
    }, 50),
  ]);

  const mappedRecommendations = recommendations.items
    .map((item) => ({
      id: item.recommendationId ?? "unknown-recommendation",
      actionType: item.actionType ?? "Unknown",
      resourceType: item.currentResourceType ?? item.recommendedResourceType ?? "Unknown",
      resourceId: item.resourceId,
      resourceArn: item.resourceArn,
      region: item.region,
      estimatedMonthlySavings: item.estimatedMonthlySavings,
      currency: item.currencyCode,
      implementationEffort: item.implementationEffort,
      restartNeeded: item.restartNeeded,
      rollbackPossible: item.rollbackPossible,
    }))
    .sort((a, b) => (b.estimatedMonthlySavings ?? 0) - (a.estimatedMonthlySavings ?? 0));
  const dedupedSavings = summaries.estimatedTotalDedupedSavings ?? mappedRecommendations.reduce(
    (sum, item) => sum + (item.estimatedMonthlySavings ?? 0),
    0,
  );

  return {
    savingsEstimationMode: preferences.savingsEstimationMode,
    currency: summaries.currencyCode,
    estimatedTotalDedupedSavings: dedupedSavings,
    recommendations: mappedRecommendations,
    groupedSavings: (summaries.items ?? []).map((item) => ({
      actionType: item.group ?? "Unknown",
      estimatedMonthlySavings: item.estimatedMonthlySavings,
      recommendationCount: item.recommendationCount,
    })),
    truncated: recommendations.truncated || Boolean(summaries.nextToken),
  };
}

export async function collectCostAllocationTagsEvidence(): Promise<CostAllocationTagsEvidence> {
  const tags: string[] = [];
  let nextToken: string | undefined;

  do {
    const response = await costExplorer.send(
      new ListCostAllocationTagsCommand({ Status: "Active", NextToken: nextToken }),
    );
    tags.push(...(response.CostAllocationTags ?? []).flatMap((tag) => tag.TagKey ? [tag.TagKey] : []));
    nextToken = response.NextToken;
  } while (nextToken && tags.length < 100);

  const uniqueTags = [...new Set(tags)].sort();
  return { activeTagKeys: uniqueTags.slice(0, 20), totalActiveTags: uniqueTags.length };
}

export async function collectComputeOptimizerEvidence(): Promise<ComputeOptimizerEvidence> {
  const enrollment = await computeOptimizer.send(new GetEnrollmentStatusCommand({}));
  const enrollmentStatus = enrollment.status ?? "Unknown";
  if (enrollmentStatus !== "Active") {
    const error = new Error(`Compute Optimizer enrollment status is ${enrollmentStatus}`);
    error.name = "OptInRequiredException";
    throw error;
  }

  const calls = await Promise.allSettled([
    collectPages(async (nextToken) => {
      const response = await computeOptimizer.send(
        new GetEC2InstanceRecommendationsCommand({ maxResults: 100, nextToken }),
      );
      return { items: response.instanceRecommendations ?? [], nextToken: response.nextToken };
    }),
    collectPages(async (nextToken) => {
      const response = await computeOptimizer.send(
        new GetEBSVolumeRecommendationsCommand({ maxResults: 100, nextToken }),
      );
      return { items: response.volumeRecommendations ?? [], nextToken: response.nextToken };
    }),
    collectPages(async (nextToken) => {
      const response = await computeOptimizer.send(
        new GetLambdaFunctionRecommendationsCommand({ maxResults: 100, nextToken }),
      );
      return { items: response.lambdaFunctionRecommendations ?? [], nextToken: response.nextToken };
    }),
    collectPages(async (nextToken) => {
      const response = await computeOptimizer.send(
        new GetRDSDatabaseRecommendationsCommand({ maxResults: 100, nextToken }),
      );
      return { items: response.rdsDBRecommendations ?? [], nextToken: response.nextToken };
    }),
    collectPages(async (nextToken) => {
      const response = await computeOptimizer.send(
        new GetIdleRecommendationsCommand({ maxResults: 100, nextToken }),
      );
      return { items: response.idleRecommendations ?? [], nextToken: response.nextToken };
    }),
  ] as const);
  const recommendations: ComputeOptimizerRecommendation[] = [];
  const partialErrors: string[] = [];

  const [ec2Result, ebsResult, lambdaResult, rdsResult, idleResult] = calls;
  if (ec2Result.status === "fulfilled") {
    for (const item of ec2Result.value.items) {
      if (item.finding === "Optimized") continue;
      const option = rankFirst(item.recommendationOptions);
      recommendations.push({
        resourceType: "EC2",
        resourceId: item.instanceName ?? resourceIdFromArn(item.instanceArn, "unknown-instance"),
        finding: item.finding ?? "Unknown",
        currentConfiguration: item.currentInstanceType,
        recommendedConfiguration: option?.instanceType,
        reasons: item.findingReasonCodes?.map(String) ?? [],
        performanceRisk: option?.performanceRisk,
        lookbackDays: item.lookBackPeriodInDays,
        ...extractSavings(option),
      });
    }
  } else partialErrors.push(`EC2: ${describeError(ec2Result.reason)}`);

  if (ebsResult.status === "fulfilled") {
    for (const item of ebsResult.value.items) {
      if (item.finding === "Optimized") continue;
      const option = rankFirst(item.volumeRecommendationOptions);
      recommendations.push({
        resourceType: "EBS",
        resourceId: resourceIdFromArn(item.volumeArn, "unknown-volume"),
        finding: item.finding ?? "Unknown",
        currentConfiguration: item.currentConfiguration
          ? `${item.currentConfiguration.volumeType ?? "unknown"}/${item.currentConfiguration.volumeSize ?? "?"}GiB`
          : undefined,
        recommendedConfiguration: option?.configuration
          ? `${option.configuration.volumeType ?? "unknown"}/${option.configuration.volumeSize ?? "?"}GiB`
          : undefined,
        reasons: [],
        performanceRisk: option?.performanceRisk,
        lookbackDays: item.lookBackPeriodInDays,
        ...extractSavings(option),
      });
    }
  } else partialErrors.push(`EBS: ${describeError(ebsResult.reason)}`);

  if (lambdaResult.status === "fulfilled") {
    for (const item of lambdaResult.value.items) {
      if (item.finding === "Optimized") continue;
      const option = rankFirst(item.memorySizeRecommendationOptions);
      recommendations.push({
        resourceType: "Lambda",
        resourceId: resourceIdFromArn(item.functionArn, "unknown-function"),
        finding: item.finding ?? "Unknown",
        currentConfiguration: item.currentMemorySize ? `${item.currentMemorySize}MB` : undefined,
        recommendedConfiguration: option?.memorySize ? `${option.memorySize}MB` : undefined,
        reasons: item.findingReasonCodes?.map(String) ?? [],
        performanceRisk: item.currentPerformanceRisk,
        lookbackDays: item.lookbackPeriodInDays,
        ...extractSavings(option),
      });
    }
  } else partialErrors.push(`Lambda: ${describeError(lambdaResult.reason)}`);

  if (rdsResult.status === "fulfilled") {
    for (const item of rdsResult.value.items) {
      if (item.instanceFinding === "Optimized" && item.storageFinding === "Optimized") continue;
      const option = rankFirst(item.instanceRecommendationOptions);
      recommendations.push({
        resourceType: "RDS",
        resourceId: resourceIdFromArn(item.resourceArn, item.dbClusterIdentifier ?? "unknown-database"),
        finding: `${item.instanceFinding ?? "Unknown"}/${item.storageFinding ?? "Unknown"}`,
        currentConfiguration: item.currentDBInstanceClass,
        recommendedConfiguration: option?.dbInstanceClass,
        reasons: [
          ...(item.instanceFindingReasonCodes?.map(String) ?? []),
          ...(item.storageFindingReasonCodes?.map(String) ?? []),
        ],
        performanceRisk: option?.performanceRisk,
        lookbackDays: item.lookbackPeriodInDays,
        ...extractSavings(option),
      });
    }
  } else partialErrors.push(`RDS: ${describeError(rdsResult.reason)}`);

  if (idleResult.status === "fulfilled") {
    for (const item of idleResult.value.items) {
      recommendations.push({
        resourceType: "IdleResource",
        resourceId: item.resourceId ?? resourceIdFromArn(item.resourceArn, "unknown-resource"),
        finding: item.finding ?? "Idle",
        currentConfiguration: item.resourceType,
        reasons: item.findingDescription ? [item.findingDescription] : [],
        lookbackDays: item.lookBackPeriodInDays,
        ...extractSavings(item),
      });
    }
  } else partialErrors.push(`Idle: ${describeError(idleResult.reason)}`);

  recommendations.sort(
    (a, b) => (b.estimatedMonthlySavings ?? 0) - (a.estimatedMonthlySavings ?? 0),
  );
  const truncated = calls.some(
    (result) => result.status === "fulfilled" && result.value.truncated,
  );
  return { enrollmentStatus, recommendations: recommendations.slice(0, 50), partialErrors, truncated };
}

export async function collectTrustedAdvisorEvidence(): Promise<TrustedAdvisorEvidence> {
  const recommendations: TrustedAdvisorRecommendation[] = [];
  let nextToken: string | undefined;

  do {
    const response = await trustedAdvisor.send(
      new ListRecommendationsCommand({
        pillar: "cost_optimizing",
        language: "ja",
        maxResults: 100,
        nextToken,
      }),
    );
    for (const item of response.recommendationSummaries ?? []) {
      if (item.status === "ok") continue;
      const cost = item.pillarSpecificAggregates?.costOptimizing;
      recommendations.push({
        name: item.name ?? "Unnamed recommendation",
        status: item.status ?? "unknown",
        awsServices: item.awsServices ?? [],
        source: item.source ?? "unknown",
        affectedResources:
          (item.resourcesAggregates?.errorCount ?? 0) +
          (item.resourcesAggregates?.warningCount ?? 0),
        estimatedMonthlySavings: cost?.estimatedMonthlySavings,
        estimatedPercentMonthlySavings: cost?.estimatedPercentMonthlySavings,
        lastUpdatedAt: item.lastUpdatedAt?.toISOString(),
      });
    }
    nextToken = response.nextToken;
  } while (nextToken && recommendations.length < 200);

  recommendations.sort(
    (a, b) => (b.estimatedMonthlySavings ?? 0) - (a.estimatedMonthlySavings ?? 0),
  );
  return {
    recommendations: recommendations.slice(0, 50),
    totalEstimatedMonthlySavings: recommendations.reduce(
      (sum, item) => sum + (item.estimatedMonthlySavings ?? 0),
      0,
    ),
  };
}

export async function collectCostAnomalyEvidence(now = new Date()): Promise<CostAnomalyEvidence> {
  const lookbackDays = Number(process.env.ANOMALY_LOOKBACK_DAYS ?? 30);
  const today = dateInTimezone(now, process.env.REPORT_TIMEZONE ?? "Asia/Tokyo");
  const anomalies: CostAnomalyEvidenceItem[] = [];
  let nextPageToken: string | undefined;

  do {
    const response = await costExplorer.send(
      new GetAnomaliesCommand({
        DateInterval: { StartDate: addDays(today, -lookbackDays), EndDate: today },
        MaxResults: 100,
        NextPageToken: nextPageToken,
      }),
    );
    for (const item of response.Anomalies ?? []) {
      const totalImpact = item.Impact?.TotalImpact ?? 0;
      anomalies.push({
        id: item.AnomalyId ?? "unknown-anomaly",
        monitorArn: item.MonitorArn,
        startDate: item.AnomalyStartDate,
        endDate: item.AnomalyEndDate,
        dimension: item.DimensionValue,
        totalImpact,
        impactPercentage: item.Impact?.TotalImpactPercentage,
        actualSpend: item.Impact?.TotalActualSpend,
        expectedSpend: item.Impact?.TotalExpectedSpend,
        score: item.AnomalyScore?.CurrentScore,
        rootCauses: (item.RootCauses ?? []).slice(0, 5).map((cause) => ({
          service: cause.Service,
          region: cause.Region,
          usageType: cause.UsageType,
          linkedAccountName: cause.LinkedAccountName,
          contribution: cause.Impact?.Contribution,
        })),
      });
    }
    nextPageToken = response.NextPageToken;
  } while (nextPageToken && anomalies.length < 200);

  anomalies.sort((a, b) => b.totalImpact - a.totalImpact);
  return {
    lookbackDays,
    anomalies: anomalies.slice(0, 50),
    totalImpact: anomalies.reduce((sum, item) => sum + item.totalImpact, 0),
  };
}

export async function collectFinOpsEvidence(now = new Date()): Promise<FinOpsEvidence> {
  const [
    cloudWatchResult,
    computeOptimizerResult,
    trustedAdvisorResult,
    budgetsResult,
    costOptimizationHubResult,
    costAllocationTagsResult,
    anomalyResult,
  ] =
    await Promise.all([
      safeCollect(
        "CloudWatch",
        regionalRegion,
        {
          lookbackDays: 14,
          lowUtilizationThresholds: { ec2CpuAveragePercent: 10, rdsCpuAveragePercent: 20 },
          scannedResources: 0,
          signals: [],
          notes: [],
        },
        () => collectCloudWatchEvidence(now),
        now,
      ),
      safeCollect(
        "Compute Optimizer",
        regionalRegion,
        { enrollmentStatus: "Unknown", recommendations: [], partialErrors: [], truncated: false },
        collectComputeOptimizerEvidence,
        now,
      ),
      safeCollect(
        "Trusted Advisor",
        "global",
        { recommendations: [], totalEstimatedMonthlySavings: 0 },
        collectTrustedAdvisorEvidence,
        now,
      ),
      safeCollect(
        "AWS Budgets",
        globalRegion,
        { budgets: [], overBudgetCount: 0, forecastOverBudgetCount: 0 },
        collectBudgetsEvidence,
        now,
      ),
      safeCollect(
        "Cost Optimization Hub",
        globalRegion,
        {
          estimatedTotalDedupedSavings: 0,
          recommendations: [],
          groupedSavings: [],
          truncated: false,
        },
        collectCostOptimizationHubEvidence,
        now,
      ),
      safeCollect(
        "Cost allocation tags",
        globalRegion,
        { activeTagKeys: [], totalActiveTags: 0 },
        collectCostAllocationTagsEvidence,
        now,
      ),
      safeCollect(
        "Cost Anomaly Detection",
        "global",
        { lookbackDays: 30, anomalies: [], totalImpact: 0 },
        () => collectCostAnomalyEvidence(now),
        now,
      ),
    ]);

  return {
    cloudWatch: cloudWatchResult,
    computeOptimizer: computeOptimizerResult,
    trustedAdvisor: trustedAdvisorResult,
    budgets: budgetsResult,
    costOptimizationHub: costOptimizationHubResult,
    costAllocationTags: costAllocationTagsResult,
    costAnomalies: anomalyResult,
  };
}
