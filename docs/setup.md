# セットアップガイド

手順は「準備（1〜4）→ 動作確認（5〜7）→ 本番運用（8〜9）」の3段階です。

## 前提条件

- Node.js 22以上
- npm
- AWS CLI v2
- AWS CDK v2（プロジェクトのdevDependencyから`npx cdk`で実行できます）
- AWS認証情報を設定済み
- Cost Explorerを有効化済み
- 利用するBedrockモデルまたは推論プロファイルへのアクセス
- Slack Incoming Webhookを作成済み

Budgetの即時Slack通知（手順9）も使う場合は、対象のCOST budgetと、実績コストの通知しきい値をあらかじめ作成してください。このCDKアプリは既存の通知へSNS購読先を追加し、予算額・しきい値・メール通知先を変更しません。

以下は未設定でもデプロイできますが、そのデータソースは`unavailable`として扱われます。

- Compute Optimizerのオプトイン
- Trusted Advisorの利用条件を満たすAWSアカウント/サポートプラン
- Cost Anomaly Detectionのモニター
- Cost Optimization Hubのオプトイン

## 1. 依存関係をインストール

```bash
npm ci
```

## 2. AWSへログイン

AWS IAM Identity Center（SSO）や短期認証情報の利用を推奨します。

```bash
export AWS_PROFILE=your-profile
export AWS_REGION=ap-northeast-1
export CDK_DEPLOY_REGION=ap-northeast-1

aws sso login --profile "$AWS_PROFILE"
aws sts get-caller-identity
```

`.env`を使う場合、AWS CLIやCDKはこのファイルを自動では読み込みません。実行前にシェルへ読み込んでください。雛形は[`.env.example`](../.env.example)です。

```bash
set -a
source .env
set +a
```

`.env`はGit管理対象外です。長期アクセスキーより、SSOや一時クレデンシャルを優先してください。

## 3. Slack WebhookをSecrets Managerへ保存

Webhook URLをソースコードやLambda環境変数へ直接書かないでください。

```bash
aws secretsmanager create-secret \
  --name finops/slack-webhook \
  --secret-string '{"url":"https://hooks.slack.com/services/REPLACE_ME"}' \
  --region "$AWS_REGION"
```

同名のSecretが既にある場合は更新します。

```bash
aws secretsmanager put-secret-value \
  --secret-id finops/slack-webhook \
  --secret-string '{"url":"https://hooks.slack.com/services/REPLACE_ME"}' \
  --region "$AWS_REGION"
```

Secretの値は、Webhook URLそのもの、`{"url":"..."}`、`{"webhookUrl":"..."}`のいずれでも読み込めます。

## 4. CDK Bootstrap

アカウント・リージョンごとに初回のみ必要です。

```bash
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
npx cdk bootstrap "aws://${ACCOUNT_ID}/${AWS_REGION}"
```

## 5. 最初は定期実行を無効にしてデプロイ

初回はSchedulerとCost Anomaly monitorの新規作成を無効にし、安全に動作確認します。

```bash
npx cdk deploy \
  -c deploymentRegion="$AWS_REGION" \
  -c slackWebhookSecretName=finops/slack-webhook \
  -c scheduleEnabled=false \
  -c createAnomalyMonitor=false
```

デプロイ時に作成されるIAMポリシーの差分を確認してから承認してください。

## 6. Slackへ投稿しないdry-run

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

`dryRun:true`でもCost Explorer、CloudWatch、BedrockなどのAPI呼び出しと、それに伴う料金は発生します。

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

データソースが未設定の場合は`unavailable`、予期しない失敗は`error`になります。他の収集とAI分析は可能な範囲で継続します。

## 7. Slackへ1件だけテスト投稿

```bash
aws lambda invoke \
  --function-name "$FUNCTION_NAME" \
  --cli-binary-format raw-in-base64-out \
  --payload '{"dryRun":false}' \
  --region "$AWS_REGION" \
  /tmp/finops-feedback-slack-test.json
```

## 8. 定期実行を有効化

Slack表示と収集結果を確認できたら、Schedulerを有効にします。デフォルトは毎日09:00 JSTです。

Cost Anomaly monitorもこのスタックで作成する場合：

```bash
npx cdk deploy \
  -c deploymentRegion="$AWS_REGION" \
  -c scheduleEnabled=true \
  -c createAnomalyMonitor=true
```

既存のCost Anomaly monitorを利用する場合：

```bash
npx cdk deploy \
  -c deploymentRegion="$AWS_REGION" \
  -c scheduleEnabled=true \
  -c createAnomalyMonitor=false
```

Cost Anomaly monitorにはアカウント単位のクォータがあるため、既存モニターがある場合は`createAnomalyMonitor=false`を使用してください。このスタックは異常を読み取るためのモニターを作成できますが、メール/SNS通知用のAnomaly Subscriptionは作成しません。

## 9. Budgetしきい値をSlackへ即時通知

既存のCOST budgetの実績コスト通知に、Slack用SNS購読先を追加します。以下は`My Monthly Cost Budget`の50%・75%・90%に接続する例です。

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

`FinOpsBudgetAlertStack`はSNS Topic、Slack投稿用Lambda、実績しきい値へのSNS購読、予測しきい値のSlack通知を作成します。実績しきい値のメール購読者は残り、Budget到達時にはメールとSlackの両方へ届きます。予測通知はSlack専用で、スタックが管理します。しきい値通知はBudgetサービスの判定タイミングに従うため、Cost Explorerの表示更新とは多少ずれる場合があります。

## アンインストール

必要に応じてSchedulerを無効化してから削除します。

```bash
npx cdk deploy \
  -c scheduleEnabled=false \
  -c createAnomalyMonitor=false
npx cdk destroy
```

次のリソースはスタック削除後も残ります。

- Slack Webhook用Secrets Manager Secret（スタック外で作成）
- CloudWatch Logs Log Group（監査のため`RETAIN`）

不要であれば、内容と保持要件を確認してから手動で削除してください。
