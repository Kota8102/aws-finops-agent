# IAMとセキュリティ

日次通知Lambdaが行うAWS操作は、コスト・メトリクス・Recommendation・リソース情報の読み取り、調査Lambdaの同期呼び出し、Bedrock推論です。調査Lambdaは、増加した対象サービスの内訳・変更履歴・構成情報だけを読み取ります。EC2停止、EBS削除、Savings Plans購入などの変更権限はどちらにも含みません。

## 主な権限

- `ce:GetCostAndUsage`, `ce:GetCostForecast`, `ce:GetAnomalies`, `ce:ListCostAllocationTags`
- `budgets:ViewBudget`
- `FinOpsBudgetAlertStack`のCustom Resourceには、既存BudgetのSNS購読を追加・削除する`budgets:ModifyBudget`（AWS BudgetsのSubscriber APIはこの権限で認可されます）
- `cost-optimization-hub:GetPreferences`, `GetRecommendation`, `ListRecommendationSummaries`, `ListRecommendations`
- `cloudwatch:ListMetrics`, `cloudwatch:GetMetricData`
- `compute-optimizer:Get*Recommendations`
- 推薦の関連情報を得るためのEC2/Lambda/RDSのDescribe/List
- `trustedadvisor:ListRecommendations`
- 日次Lambda: `lambda:InvokeFunction`（調査Lambdaだけ）
- 調査Lambda: `ce:GetCostAndUsage`, `cloudtrail:LookupEvents`, `ec2:DescribeInstances`, `rds:DescribeDBInstances`, `lambda:ListFunctions`, `s3:ListAllMyBuckets`, `s3:GetLifecycleConfiguration`
- `bedrock:InvokeModel`
- Slack Webhook Secretの`secretsmanager:GetSecretValue`

調査LambdaにはSlack Secretの読み取り権限を付与しません。BedrockのTool Useはモデルのプロンプトだけで認可せず、対象サービス、許可済みツール、期間、最大回数をコードで検証します。

## 運用時の注意

- Webhook URLをログ、Issue、Pull Request、ソースコードへ貼らないでください。
- Webhookが漏えいした場合はSlack側で直ちに再発行し、Secrets Managerを更新してください。
- Bedrockには集計コスト、Recommendation、リソース識別子、Linked Account名、リージョン、Usage Typeが送られます。
- 同じ内容の一部がAIの要約を通じてSlackへ投稿される可能性があります。組織のデータ分類に合わせてマスキングしてください。
- グローバル推論プロファイルを使う場合は、組織のリージョン制限やSCPも確認してください。
- CDKをデプロイする利用者には、このスタックとIAMロールを作成できる権限が必要です。Lambda実行ロールとは分けて考えてください。
