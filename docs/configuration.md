# 設定リファレンス

## 設定値の決まり方

優先順位は次のとおりです。上にあるものが勝ちます。

```text
1. CDK context（-c key=value）        ← デプロイ時に明示指定
2. cdk.json の context                ← リポジトリの既定値
3. 環境変数                            ← .env などから読み込んだ値
4. コード内のフォールバック値            ← bin/finops-feedback.ts
```

> [!WARNING]
> `-c` で渡した値は**次回のデプロイへ自動保存されません**。既定値と異なる設定を使う場合は、毎回`-c`で指定するか、[`cdk.json`](../cdk.json)の`context`へ書き込んで管理してください。
>
> 例: 定期実行を無効にしたままデプロイしたい場合、`-c scheduleEnabled=false` を省略すると`cdk.json`の`true`が使われて有効化されます。

## 基本設定

| CDK context | 環境変数 | 既定値 | 説明 |
| --- | --- | --- | --- |
| `deploymentRegion` | `CDK_DEPLOY_REGION` | `ap-northeast-1` ※ | Lambda、CloudWatch、Compute Optimizerの対象リージョン |
| `slackWebhookSecretName` | `SLACK_WEBHOOK_SECRET_NAME` | `finops/slack-webhook` | Webhookを保存したSecret名 |
| `scheduleTimezone` | `SCHEDULE_TIMEZONE` | `Asia/Tokyo` ※ | 集計日付とSchedulerのタイムゾーン |
| `scheduleExpression` | `SCHEDULE_EXPRESSION` | `cron(0 9 * * ? *)` | EventBridge Scheduler式 |
| `scheduleEnabled` | `SCHEDULE_ENABLED` | `true` ※ | 定期実行の有効 / 無効 |
| `reportLookbackDays` | `REPORT_LOOKBACK_DAYS` | `7` | 比較する期間の日数 |
| `costMetric` | `COST_METRIC` | `UnblendedCost` | Cost Explorerのコスト指標 |
| `createAnomalyMonitor` | `CREATE_ANOMALY_MONITOR` | `true` ※ | サービス別Anomaly monitorをCDKで新規作成 |

※ = [`cdk.json`](../cdk.json) の `context` で設定されている値。指定を省略するとこの値が使われます。

> [!IMPORTANT]
> `createAnomalyMonitor` の既定値は `cdk.json` により **`true`** です（`bin/finops-feedback.ts` のコード側フォールバックは`false`ですが、`cdk.json`が優先されます）。
> Cost Anomaly monitorにはアカウント単位のクォータがあるため、既存モニターを運用している環境では明示的に `-c createAnomalyMonitor=false` を指定してください。

## 調査Agentとモデル

| CDK context | 環境変数 | 既定値 | 説明 |
| --- | --- | --- | --- |
| `bedrockModelId` | `BEDROCK_MODEL_ID` | `global.anthropic.claude-sonnet-5` ※ | Bedrockモデル / 推論プロファイルID |
| `bedrockRegion` | `BEDROCK_REGION` | `ap-northeast-1` ※ | Bedrock Runtime APIのリージョン |
| `investigationEnabled` | `FINOPS_INVESTIGATION_ENABLED` | `true` | 読み取り専用の追加調査を有効化 |
| `investigationMinChangeUsd` | `FINOPS_INVESTIGATION_MIN_CHANGE_USD` | `100` | 調査を始める最小の増加額（USD） |
| `investigationMinChangePercent` | `FINOPS_INVESTIGATION_MIN_CHANGE_PERCENT` | `20` | 調査を始める最小の増加率（%） |
| `investigationMaxTargets` | `FINOPS_INVESTIGATION_MAX_TARGETS` | `3` | 1回のレポートで調査するサービス数の上限 |
| `investigationMaxToolCalls` | `FINOPS_INVESTIGATION_MAX_TOOL_CALLS` | `6` | Agentが実行する読み取りツール数の上限 |
| `investigationMaxTurns` | `FINOPS_INVESTIGATION_MAX_TURNS` | `4` | BedrockとのTool Use往復回数の上限 |

調査の起動条件は「増加額 **かつ** 増加率」の両方を満たす必要があります。通知が静かすぎる場合は`investigationMinChangeUsd`を下げ、騒がしい場合は上げてください。

> [!NOTE]
> `investigationMaxToolCalls` / `investigationMaxTurns` を上げると調査は深くなりますが、日次レポート全体の実行時間（Lambdaタイムアウト5分）とBedrock料金が増えます。上限に達した場合は通知に`上限到達`と表示されます。

## Budget即時通知

`FinOpsBudgetAlertStack` 用の設定です。詳細は[セットアップガイド 手順9](./setup.md#9-budgetしきい値をslackへ即時通知)を参照してください。

| CDK context | 環境変数 | 既定値 | 説明 |
| --- | --- | --- | --- |
| `budgetName` | `BUDGET_NAME` | `My Monthly Cost Budget` | 即時通知を接続する**既存**のCOST budget名 |
| `budgetAlertThresholds` | `BUDGET_ALERT_THRESHOLDS` | `50,75,90` | 即時Slack通知を接続する実績コストのしきい値（%） |
| `budgetForecastAlertThreshold` | `BUDGET_FORECAST_ALERT_THRESHOLD` | `90` | 即時Slack通知を作成する予測コストのしきい値（%） |

## コードで固定されている値

次の値はCDK contextや環境変数では変更できません。変更するには [`lib/finops-feedback-stack.ts`](../lib/finops-feedback-stack.ts) を編集してください。

| 環境変数 | 値 | 用途 |
| --- | --- | --- |
| `COST_EXPLORER_REGION` | `us-east-1` | Cost Explorer系APIの呼び出し先 |
| `EVIDENCE_LOOKBACK_DAYS` | `14` | CloudWatchのCPU平均を計算する期間 |
| `ANOMALY_LOOKBACK_DAYS` | `30` | Cost Anomaly Detectionを遡る期間 |
| `ANOMALY_ACTIVE_WITHIN_DAYS` | `7` | 🔴要対応へ昇格させる異常の新しさ（進行中、または終了からこの日数以内） |
| `ANOMALY_MIN_IMPACT_USD` | `10` | 🔴要対応へ昇格させる異常の最小影響額（USD） |
| `EC2_LOW_CPU_THRESHOLD` | `10` | 低利用EC2と判定するCPU利用率（%） |
| `RDS_LOW_CPU_THRESHOLD` | `20` | 低利用RDSと判定するCPU利用率（%） |

## レシピ

### コスト指標を変更する

`costMetric` は次の値に対応しています。

| 値 | 特徴 |
| --- | --- |
| `UnblendedCost`（既定） | 実際の請求額に最も近い。日次の変動を素直に見たい場合 |
| `AmortizedCost` | Savings Plans / RIの前払いを期間配分。予約を含めた実質コストを見たい場合 |
| `BlendedCost` | 組織内で平均化した単価 |
| `NetUnblendedCost` | ディスカウント適用後の`UnblendedCost` |
| `NetAmortizedCost` | ディスカウント適用後の`AmortizedCost` |

組織のFinOpsルールに合わせて選択してください。Savings PlansやReserved Instancesを期間配分して評価したい場合は、一般に`AmortizedCost`系が検討対象になります。

```bash
npx cdk deploy -c costMetric=AmortizedCost
```

### 通知時刻を変更する

`scheduleExpression` にEventBridge Scheduler式を渡します。タイムゾーンは`scheduleTimezone`に従います。

```bash
# 平日8:00 JSTのみ通知
npx cdk deploy -c scheduleExpression='cron(0 8 ? * MON-FRI *)'
```

### モデルを変更する

利用可能なBedrockモデル / 推論プロファイルは、アカウントとリージョンによって異なります。

```bash
npx cdk deploy \
  -c bedrockModelId=YOUR_INFERENCE_PROFILE_ID \
  -c bedrockRegion=ap-northeast-1
```

> [!CAUTION]
> `global.` で始まる推論プロファイルは、Lambdaを東京リージョンへ配置していても**推論がリージョン横断になる場合があります**。データレジデンシー要件がある場合は、利用可能な地域限定プロファイル（`jp.` / `apac.` など）を確認して置き換えてください。組織のSCPによるリージョン制限も併せて確認が必要です。

### 追加調査を無効にする

Bedrock料金や実行時間を抑えたい場合は、調査Agentだけを切れます。日次レポートは通常どおり動作します。

```bash
npx cdk deploy -c investigationEnabled=false
```
</content>
