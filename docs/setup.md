# セットアップガイド

導入は3段階です。**準備（手順1〜4）→ 動作確認（手順5〜7）→ 本番運用（手順8〜9）**。

いきなり定期実行を有効にせず、まずSlackへ投稿しないdry-runで確認する流れになっています。所要時間は約15分（CDK bootstrap済みの場合）です。

- [前提条件](#前提条件)
- 準備: [1. 依存関係](#1-依存関係をインストール) → [2. AWSログイン](#2-awsへログイン) → [3. Webhook保存](#3-slack-webhookをsecrets-managerへ保存) → [4. Bootstrap](#4-cdk-bootstrap)
- 動作確認: [5. 定期実行OFFでデプロイ](#5-まずは定期実行を無効にしてデプロイ) → [6. dry-run](#6-slackへ投稿しないdry-run) → [7. テスト投稿](#7-slackへ1件だけテスト投稿)
- 本番運用: [8. 定期実行を有効化](#8-定期実行を有効化) → [9. Budget即時通知](#9-budgetしきい値をslackへ即時通知)
- [アンインストール](#アンインストール)

## 前提条件

### 必須

| 項目 | 補足 |
| --- | --- |
| Node.js 22以上 / npm | |
| AWS CLI v2 | |
| AWS CDK v2 | devDependencyに含まれるため `npx cdk` で実行できます（グローバルインストール不要） |
| AWS認証情報 | IAM Identity Center（SSO）などの一時クレデンシャルを推奨 |
| Cost Explorerの有効化 | 未有効の場合、コスト取得そのものが失敗します |
| Bedrockモデルへのアクセス | 使用するモデルまたは推論プロファイルが有効なリージョンを確認してください |
| Slack Incoming Webhook | 発行済みのURLが必要です |

### 任意の前提条件

以下は設定されていなくてもデプロイ・実行できます。そのデータソースは収集ステータス `unavailable` として扱われ、通知は残りの情報で継続します。

- Compute Optimizerのオプトイン
- Trusted Advisorの利用条件を満たすAWSアカウント/サポートプラン
- Cost Anomaly Detectionのモニター
- Cost Optimization Hubのオプトイン

### Budget即時通知（手順9）を使う場合

対象のCOST budgetと、**実績コスト（ACTUAL）** の通知しきい値をあらかじめ作成しておいてください。このCDKアプリは既存の通知にSNS購読先を追加するだけで、予算額・しきい値・メール通知先は変更しません。

---

## 1. 依存関係をインストール

```bash
npm ci
```

## 2. AWSへログイン

長期アクセスキーではなく、AWS IAM Identity Center（SSO）や一時クレデンシャルの利用を推奨します。

```bash
export AWS_PROFILE=your-profile
export AWS_REGION=ap-northeast-1
export CDK_DEPLOY_REGION=ap-northeast-1

aws sso login --profile "$AWS_PROFILE"
aws sts get-caller-identity
```

<details>
<summary><code>.env</code> で管理したい場合</summary>

AWS CLIとCDKは`.env`を自動では読み込みません。実行前に自分でシェルへ読み込んでください。雛形は [`.env.example`](../.env.example) です。

```bash
set -a
source .env
set +a
```

`.env`はGit管理対象外（`.gitignore`済み）です。

</details>

## 3. Slack WebhookをSecrets Managerへ保存

> [!CAUTION]
> Webhook URLをソースコード、Lambda環境変数、Issue、Pull Requestへ直接書かないでください。

```bash
aws secretsmanager create-secret \
  --name finops/slack-webhook \
  --secret-string '{"url":"https://hooks.slack.com/services/REPLACE_ME"}' \
  --region "$AWS_REGION"
```

同名のSecretが既にある場合は、作成ではなく更新します。

```bash
aws secretsmanager put-secret-value \
  --secret-id finops/slack-webhook \
  --secret-string '{"url":"https://hooks.slack.com/services/REPLACE_ME"}' \
  --region "$AWS_REGION"
```

Secretの値は次のいずれの形式でも読み込めます。

- Webhook URLそのもの（プレーンテキスト）
- `{"url":"https://hooks.slack.com/..."}`
- `{"webhookUrl":"https://hooks.slack.com/..."}`

## 4. CDK Bootstrap

アカウント・リージョンの組み合わせごとに、初回のみ必要です。

```bash
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
npx cdk bootstrap "aws://${ACCOUNT_ID}/${AWS_REGION}"
```

---

## 5. まずは定期実行を無効にしてデプロイ

初回はSchedulerとCost Anomaly monitorの新規作成を明示的に無効化し、安全に動作確認します。

```bash
npx cdk deploy \
  -c deploymentRegion="$AWS_REGION" \
  -c slackWebhookSecretName=finops/slack-webhook \
  -c scheduleEnabled=false \
  -c createAnomalyMonitor=false
```

> [!NOTE]
> デプロイ時に表示されるIAMポリシーの差分を確認してから承認してください。すべて読み取り系のアクションであること、リソース変更系（`Delete*` / `Stop*` / `Purchase*` など）が含まれていないことを確認できます。

## 6. Slackへ投稿しないdry-run

`dryRun:true` で呼ぶと、収集とAI分析までを実行してSlack投稿だけをスキップします。

```bash
FUNCTION_NAME=$(aws cloudformation describe-stacks \
  --stack-name FinOpsFeedbackStack \
  --region "$AWS_REGION" \
  --query 'Stacks[0].Outputs[?OutputKey==`CostFeedbackFunctionName`].OutputValue' \
  --output text)

aws lambda invoke \
  --function-name "$FUNCTION_NAME" \
  --cli-binary-format raw-in-base64-out \
  --payload '{"dryRun":true}' \
  --region "$AWS_REGION" \
  /tmp/finops-feedback-response.json

cat /tmp/finops-feedback-response.json
```

正常時は次のような結果が返ります。

```json
{
  "postedToSlack": false,
  "aiFallback": false,
  "collectorStatus": {
    "cloudWatch": "ok",
    "computeOptimizer": "ok",
    "trustedAdvisor": "ok",
    "costAnomalies": "ok"
  }
}
```

`collectorStatus` の値の意味は次のとおりです。

| 値 | 意味 | 対応 |
| --- | --- | --- |
| `ok` | 正常に取得できた | 不要 |
| `unavailable` | 未設定・未オプトイン・権限不足などで利用できない | [任意の前提条件](#任意の前提条件)を確認。放置しても他の収集は継続します |
| `error` | 予期しない失敗 | CloudWatch Logsを確認 → [運用ガイド](./operations.md#トラブルシューティング) |

`aiFallback: true` の場合はBedrock呼び出しに失敗し、数値ベースの簡易通知へ切り替わっています。

> [!WARNING]
> `dryRun:true` でもCost Explorer、CloudWatch、BedrockなどのAPI呼び出しは実行され、**それに伴う料金は発生します**。

## 7. Slackへ1件だけテスト投稿

表示崩れや情報量を実際のSlackで確認します。

```bash
aws lambda invoke \
  --function-name "$FUNCTION_NAME" \
  --cli-binary-format raw-in-base64-out \
  --payload '{"dryRun":false}' \
  --region "$AWS_REGION" \
  /tmp/finops-feedback-slack-test.json
```

---

## 8. 定期実行を有効化

Slackの表示と収集結果に問題がなければ、Schedulerを有効にします。デフォルトは**毎日09:00 JST**です。

**Cost Anomaly monitorをこのスタックで作成する場合:**

```bash
npx cdk deploy \
  -c deploymentRegion="$AWS_REGION" \
  -c scheduleEnabled=true \
  -c createAnomalyMonitor=true
```

**既存のCost Anomaly monitorを使う場合:**

```bash
npx cdk deploy \
  -c deploymentRegion="$AWS_REGION" \
  -c scheduleEnabled=true \
  -c createAnomalyMonitor=false
```

> [!IMPORTANT]
> Cost Anomaly monitorにはアカウント単位のクォータがあります。既にモニターを運用している場合は `createAnomalyMonitor=false` を使ってください。
> また、このスタックは異常を**読み取る**ためのモニターを作成できますが、メール/SNS通知用のAnomaly Subscriptionは作成しません。

## 9. Budgetしきい値をSlackへ即時通知

日次レポートを待たず、Budget到達をその場でSlackへ流す任意設定です。既存のCOST budgetの実績コスト通知に、Slack用のSNS購読先を追加します。

以下は `My Monthly Cost Budget` の50%・75%・90%に接続する例です。

```bash
export BUDGET_NAME='My Monthly Cost Budget'
export BUDGET_ALERT_THRESHOLDS='50,75,90'
export BUDGET_FORECAST_ALERT_THRESHOLD=90

npx cdk deploy FinOpsBudgetAlertStack \
  -c deploymentRegion="$AWS_REGION" \
  -c slackWebhookSecretName=finops/slack-webhook \
  -c budgetName="$BUDGET_NAME" \
  -c budgetAlertThresholds="$BUDGET_ALERT_THRESHOLDS" \
  -c budgetForecastAlertThreshold="$BUDGET_FORECAST_ALERT_THRESHOLD"
```

`FinOpsBudgetAlertStack` が作成するものは次の4つです。

1. SNS Topic
2. Slack投稿用Lambda（30秒タイムアウト）
3. 既存Budgetの**実績**しきい値へのSNS購読追加
4. **予測**しきい値のSlack通知（1件、このスタックが管理）

既存の実績しきい値に登録されているメール購読者はそのまま残るため、Budget到達時にはメールとSlackの両方へ届きます。

> [!NOTE]
> しきい値通知はBudgetサービスの判定タイミングに従うため、Cost Explorerの表示更新とは多少ずれる場合があります。
> 予測通知はこのスタックが管理する1件です。この通知へ手動でメール購読者を追加しても、スタック削除時には通知全体が削除されます。

---

## アンインストール

先にSchedulerとAnomaly monitorを無効化してから削除すると、削除中の予期しない実行を避けられます。

```bash
npx cdk deploy \
  -c scheduleEnabled=false \
  -c createAnomalyMonitor=false
npx cdk destroy
```

次のリソースは**スタック削除後も残ります**。

| 残るリソース | 理由 |
| --- | --- |
| Slack Webhook用のSecrets Manager Secret | スタック外で作成したものを参照しているため |
| CloudWatch Logs Log Group（2つ） | 監査目的で `RemovalPolicy.RETAIN` を設定しているため |

不要であれば、内容と保持要件を確認してから手動で削除してください。

## つまずいたら

- 通知が来ない・数値がおかしい → [運用ガイド / トラブルシューティング](./operations.md#トラブルシューティング)
- しきい値やモデルを変えたい → [設定リファレンス](./configuration.md)
- 権限を確認したい → [IAMとセキュリティ](./security.md)
</content>
