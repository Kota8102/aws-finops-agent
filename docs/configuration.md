# 設定リファレンス

CDK context（`-c key=value`）が最優先で、次に環境変数、最後にデフォルト値が使われます。
`-c`で渡した値は次回のデプロイへ自動保存されないため、既定値と異なる設定は毎回指定するか、環境変数/CDK contextファイルで管理してください。

## 基本設定

| CDK context | 環境変数 | リポジトリ既定値 | 説明 |
| --- | --- | --- | --- |
| `deploymentRegion` | `CDK_DEPLOY_REGION` | `ap-northeast-1` | Lambda、CloudWatch、Compute Optimizerの対象リージョン |
| `slackWebhookSecretName` | `SLACK_WEBHOOK_SECRET_NAME` | `finops/slack-webhook` | Webhookを保存したSecret名 |
| `scheduleTimezone` | `SCHEDULE_TIMEZONE` | `Asia/Tokyo` | 集計日付とSchedulerのタイムゾーン |
| `scheduleExpression` | `SCHEDULE_EXPRESSION` | `cron(0 9 * * ? *)` | EventBridge Scheduler式 |
| `scheduleEnabled` | `SCHEDULE_ENABLED` | `true` | 定期実行の有効/無効 |
| `reportLookbackDays` | `REPORT_LOOKBACK_DAYS` | `7` | 比較期間の日数 |
| `costMetric` | `COST_METRIC` | `UnblendedCost` | Cost Explorerのコスト指標 |
| `createAnomalyMonitor` | `CREATE_ANOMALY_MONITOR` | `false` | サービス別Anomaly monitorをCDKで作成 |

## AI・調査Agent

| CDK context | 環境変数 | リポジトリ既定値 | 説明 |
| --- | --- | --- | --- |
| `bedrockModelId` | `BEDROCK_MODEL_ID` | `global.anthropic.claude-sonnet-5` | Bedrockモデル/推論プロファイルID |
| `bedrockRegion` | `BEDROCK_REGION` | `ap-northeast-1` | Bedrock Runtime APIのリージョン |
| `investigationEnabled` | `FINOPS_INVESTIGATION_ENABLED` | `true` | 読み取り専用の追加調査を有効化 |
| `investigationMinChangeUsd` | `FINOPS_INVESTIGATION_MIN_CHANGE_USD` | `100` | 調査を始める最小の増加額（USD） |
| `investigationMinChangePercent` | `FINOPS_INVESTIGATION_MIN_CHANGE_PERCENT` | `20` | 調査を始める最小の増加率（%） |
| `investigationMaxTargets` | `FINOPS_INVESTIGATION_MAX_TARGETS` | `3` | 1回の日次レポートで調査するサービス数の上限 |
| `investigationMaxToolCalls` | `FINOPS_INVESTIGATION_MAX_TOOL_CALLS` | `6` | Agentが実行する読み取りツール数の上限 |
| `investigationMaxTurns` | `FINOPS_INVESTIGATION_MAX_TURNS` | `4` | BedrockとのTool Use往復回数の上限 |

## Budget即時通知

| CDK context | 環境変数 | リポジトリ既定値 | 説明 |
| --- | --- | --- | --- |
| `budgetName` | `BUDGET_NAME` | `My Monthly Cost Budget` | 即時通知を接続する既存のCOST budget名 |
| `budgetAlertThresholds` | `BUDGET_ALERT_THRESHOLDS` | `50,75,90` | 即時Slack通知を接続する実績コストのしきい値（%） |
| `budgetForecastAlertThreshold` | `BUDGET_FORECAST_ALERT_THRESHOLD` | `90` | 即時Slack通知を作成する予測コストのしきい値（%） |

## コスト指標を変更する

`costMetric`は次の値に対応しています。

- `UnblendedCost`
- `AmortizedCost`
- `BlendedCost`
- `NetUnblendedCost`
- `NetAmortizedCost`

組織のFinOpsルールに合わせて選択してください。Savings PlansやReserved Instancesを期間配分して評価する場合は、一般に`AmortizedCost`系が検討対象になります。

## モデルを変更する

利用可能なBedrockモデル/推論プロファイルはアカウントとリージョンによって異なります。

```bash
npx cdk deploy \
  -c bedrockModelId=YOUR_INFERENCE_PROFILE_ID \
  -c bedrockRegion=ap-northeast-1
```

`global.`で始まる推論プロファイルは、Lambdaを東京リージョンへ配置していても推論がリージョン横断になる場合があります。データレジデンシー要件がある場合は、利用可能な地域限定プロファイルを確認して置き換えてください。
