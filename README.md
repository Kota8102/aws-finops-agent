# AWS FinOps Agent for Slack

AWSのコストと利用状況を毎日収集し、生成AIが「何が変わったか」「次に何を確認すべきか」を短くまとめてSlackへ通知する、読み取り中心のFinOps Agentです。AWS Budgetのしきい値到達は、日次レポートを待たずSlackへ即時通知できます。

- **デプロイ**: AWS CDK（TypeScript）
- **データソース**: Cost Explorer / AWS Budgets / Cost Optimization Hub / CloudWatch / Compute Optimizer / Trusted Advisor / Cost Anomaly Detection
- **AI分析**: Amazon Bedrock Converse API
- **追加調査**: 一定以上のコスト増加を検知すると、専用の調査Agentが読み取り専用の深掘り調査を実施

> **安全性について**: このAgentはAWSリソースを自動停止・削除・購入しません。通知される削減案は、必ず担当者が影響を検証してから実施してください。

## 通知イメージ

毎日1回、次のようなSlack通知が届きます（Block Kit・最大7ブロック）。

```text
AWS FinOps｜2026-07-14｜🔴 要対応

7日コスト        前週比
$1,245.47        ↓ $918.54 (-42.4%)

当月累計          CE月末見込
$2,995            $6,584

Budget             削減候補/月（重複除外）
🔴 $2,995 / $200  COH $1,174（控除前）

要点
全体コストは減少していますが、S3が前週比98%増加しています。
バケット・Usage Type別に増加元を確認してください。

今やること
① P0 S3増加元をCost ExplorerとStorage Lensで確認する
② P1 低利用EC2/EBSの停止・削除可否を所有者へ確認する

変化が大きいサービス
↑ S3 $461 (+98%)   ↓ EC2 $443 (-52%)

証拠: CW ✓  CO ✓  TA ✓  Budget ✓  Hub ✓  Tag –  異常 ✓
詳細: 内訳 ・ Budget ・ 最適化Hub ・ 異常 ・ 対象リソース
```

冒頭の判定（🔴/🟡/🟢）は次のルールです。

| 判定 | 条件 |
| --- | --- |
| 🔴 要対応 | P0アクション、Budgetの実績/予測超過、またはCost Anomalyが1件以上 |
| 🟡 要確認 | P1アクション、前週比の絶対値が20%以上、AIフォールバック、または収集元のエラー |
| 🟢 正常 | 上記に該当しない |

## できること

- **コストの可視化** — 直近7日と前週の比較、当月累計とCost Explorerの月末予測、変動が大きいサービス上位3件
- **削減候補の収集** — CloudWatch（低CPUのEC2/RDS）、Compute Optimizer、Trusted Advisor、Cost Optimization Hub（重複除外済み）
- **アラート・異常検知** — AWS Budgetsの実績・予測・しきい値超過のSlack即時通知、Cost Anomaly Detectionの異常と影響額
- **AI分析と追加調査** — Bedrockによる日本語要約と優先アクション、大きな増加時のUsage Type / Operation / Region内訳・CloudTrail変更履歴・リソース構成の読み取り調査
- **壊れにくい通知** — 一部のAWS APIやAI分析が失敗しても、取得できた情報で通知を継続

## クイックスタート

詳細な手順（前提条件、dry-run、Budget即時通知の接続など）は[セットアップガイド](./docs/setup.md)を参照してください。最短の流れは次のとおりです。

```bash
# 1. 依存関係とAWS認証
npm ci
export AWS_PROFILE=your-profile AWS_REGION=ap-northeast-1
aws sso login --profile "$AWS_PROFILE"

# 2. Slack WebhookをSecrets Managerへ保存
aws secretsmanager create-secret \
  --name finops/slack-webhook \
  --secret-string '{"url":"https://hooks.slack.com/services/REPLACE_ME"}' \
  --region "$AWS_REGION"

# 3. まず定期実行を無効にしてデプロイし、動作確認
npx cdk deploy \
  -c deploymentRegion="$AWS_REGION" \
  -c slackWebhookSecretName=finops/slack-webhook \
  -c scheduleEnabled=false \
  -c createAnomalyMonitor=false

# 4. 確認できたら定期実行を有効化（毎日09:00 JST）
npx cdk deploy -c deploymentRegion="$AWS_REGION" -c scheduleEnabled=true
```

## ドキュメント

| ドキュメント | 内容 |
| --- | --- |
| [セットアップガイド](./docs/setup.md) | 前提条件、9ステップの導入手順、dry-run、Budget即時通知、アンインストール |
| [アーキテクチャ](./docs/architecture.md) | 構成図、データソース一覧、調査Agentの動き、作成されるAWSリソース、設計メモ |
| [設定リファレンス](./docs/configuration.md) | CDK context / 環境変数の一覧、コスト指標とBedrockモデルの変更方法 |
| [IAMとセキュリティ](./docs/security.md) | Lambdaの権限一覧、権限分離の方針、運用時の注意 |
| [運用ガイド](./docs/operations.md) | Agent自体のコスト、ログの見方、トラブルシューティング、既知の制約 |

## 開発

```bash
npm test
npm run build
npx cdk synth
```

テストは日付範囲、サービス別コスト比較、AI構造化出力のパース、Slack通知の簡潔さを確認します。

### ディレクトリ構成

```text
.
├── bin/finops-feedback.ts           # CDK Appと設定読み込み
├── lib/finops-feedback-stack.ts     # AWSリソースとIAM
├── lib/finops-budget-alert-stack.ts # Budget即時Slack通知用の分離スタック
├── src/handler.ts                   # Cost Explorer、Bedrock、Slack、Lambda handler
├── src/investigation-handler.ts     # 条件付きの読み取り専用調査Agent
├── src/budget-alert-handler.ts      # Budget SNSをSlackへ中継
├── src/collectors.ts                # FinOps証拠ソースの収集
├── test/handler.test.ts             # Unit tests
├── docs/                            # 詳細ドキュメント
├── cdk.json                         # CDKの既定値
└── .env.example                     # ローカル設定例（秘密値なし）
```

## Contributing

IssueやPull Requestを歓迎します。変更時は次を確認してください。

1. AWSリソースを変更する権限をLambdaへ追加しない
2. 新しいデータソースの失敗が通知全体を止めないようにする
3. Slack通知を7ブロック程度に保ち、詳細を詰め込みすぎない
4. `npm test`、`npm run build`、`npx cdk synth`を実行する
5. アカウントID、リソースID、Webhook、コストデータをコミットしない

## ライセンス

このリポジトリには、現時点ではLICENSEファイルが含まれていません。OSSとして公開する前に、利用目的に合うライセンスを選択して追加してください。ライセンスが設定されるまでは、第三者が自由に利用・改変・再配布できる状態ではありません。
