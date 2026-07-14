import type { Handler, SNSEvent } from "aws-lambda";
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";

interface SlackPayload {
  text: string;
  blocks: Array<Record<string, unknown>>;
}

const secretsManager = new SecretsManagerClient({});
let cachedSlackWebhookUrl: string | undefined;

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

function budgetConsoleUrl(): string {
  const region = process.env.AWS_REGION ?? "ap-northeast-1";
  return `https://${region}.console.aws.amazon.com/billing/home?region=${region}#/budgets`;
}

function extractThreshold(value: string): string | undefined {
  return value.match(/\b(\d+(?:\.\d+)?)\s*%/)?.[1];
}

function extractAmounts(value: string): string[] {
  const dollarAmounts = [...value.matchAll(/\$\s*(\d[\d,]*(?:\.\d+)?)/g)]
    .map((match) => `$${match[1]}`);
  const currencyAmounts = [...value.matchAll(/\b(\d[\d,]*(?:\.\d+)?)\s*(USD|JPY|EUR)\b/gi)]
    .map((match) => `${match[1]} ${match[2].toUpperCase()}`);
  return [...new Set([...dollarAmounts, ...currencyAmounts])].slice(0, 3);
}

function extractBudgetName(subject: string): string | undefined {
  const name = subject
    .replace(/^\s*AWS\s+Budgets\s*:\s*/i, "")
    .replace(/\s+(?:has|is|exceeded|forecasted)\b[\s\S]*$/i, "")
    .trim();
  return name && name !== subject.trim() ? truncate(name, 160) : undefined;
}

export function formatBudgetAlertMessage(subject: string, message: string): SlackPayload {
  const sourceText = `${subject}\n${message}`;
  const isForecast = /\bforecast(?:ed)?\b|\bFORECASTED\b/i.test(sourceText);
  const threshold = extractThreshold(sourceText);
  const amounts = extractAmounts(sourceText);
  const budgetName = extractBudgetName(subject);
  const title = isForecast
    ? "月末予測が予算しきい値を超過しました"
    : "実績コストが予算しきい値を超過しました";
  const details = [
    budgetName ? `対象予算: *${budgetName}*` : undefined,
    threshold ? `通知しきい値: *${threshold}%*` : undefined,
    amounts.length > 0 ? `通知内の金額: ${amounts.join(" / ")}` : undefined,
    "対応: Cost Explorerで当月の増加サービスを確認してください。",
  ].filter(Boolean).join("\n");
  const consoleUrl = budgetConsoleUrl();

  return {
    text: `AWS Budget アラート: ${title}`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "⚠️ AWS Budget アラート", emoji: true },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: `*${title}*\n${details}` },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `次の確認: <${consoleUrl}|AWS Budgetsを開く> → Cost Explorerで上位サービスを確認`,
          },
        ],
      },
    ],
  };
}

async function getSlackWebhookUrl(): Promise<string> {
  if (cachedSlackWebhookUrl) return cachedSlackWebhookUrl;

  const secretArn = process.env.SLACK_WEBHOOK_SECRET_ARN;
  if (!secretArn) throw new Error("SLACK_WEBHOOK_SECRET_ARN is not configured");

  const response = await secretsManager.send(new GetSecretValueCommand({ SecretId: secretArn }));
  const secretString = response.SecretString;
  if (!secretString) throw new Error("Slack webhook secret is empty");

  let url = secretString.trim();
  try {
    const parsed = JSON.parse(secretString) as { url?: string; webhookUrl?: string };
    url = parsed.url ?? parsed.webhookUrl ?? url;
  } catch {
    // A raw webhook URL is also supported.
  }

  if (!url.startsWith("https://hooks.slack.com/")) {
    throw new Error("Slack webhook secret must be a Slack Incoming Webhook URL");
  }
  cachedSlackWebhookUrl = url;
  return url;
}

async function postToSlack(payload: SlackPayload): Promise<void> {
  const response = await fetch(await getSlackWebhookUrl(), {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Slack webhook failed (${response.status}): ${body.slice(0, 300)}`);
  }
}

export const handler: Handler<SNSEvent, void> = async (event) => {
  for (const record of event.Records) {
    await postToSlack(formatBudgetAlertMessage(record.Sns.Subject ?? "AWS Budgets しきい値に到達", record.Sns.Message));
  }

  console.log(JSON.stringify({
    message: "AWS Budget alert posted to Slack",
    recordCount: event.Records.length,
  }));
};
