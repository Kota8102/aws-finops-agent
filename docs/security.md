# IAMとセキュリティ

## 基本方針

**このAgentはAWSリソースを変更しません。** EC2の停止、EBSの削除、Savings Plansの購入、設定変更に必要な権限を、いずれのLambdaにも付与していません。

権限は役割ごとに3つのロールへ分離しています。

| ロール | 役割 | Slack Webhookの読み取り | Bedrock |
| --- | --- | --- | --- |
| 日次レポートLambda | コスト・メトリクス・Recommendationの収集、調査Lambdaの呼び出し、Slack投稿 | あり | あり |
| 調査Lambda | 増加サービスの内訳・変更履歴・構成情報の読み取り | なし | あり |
| Budget Alert Lambda | Budget SNSイベントをSlackへ中継 | あり | なし |

調査LambdaにSlack Secretの読み取り権限を与えていないのは、モデルが操作するコンポーネントから外部への出力経路を分離するためです。調査結果は日次レポートLambdaを経由してのみSlackへ届きます。

## 権限一覧

### 日次レポートLambda

| Sid | アクション |
| --- | --- |
| `ReadCostExplorer` | `ce:GetCostAndUsage`, `ce:GetCostForecast`, `ce:GetAnomalies`, `ce:ListCostAllocationTags` |
| `ReadBudgets` | `budgets:ViewBudget`（自アカウントのbudget ARNに限定） |
| `ReadCostOptimizationHub` | `cost-optimization-hub:GetPreferences`, `GetRecommendation`, `ListRecommendationSummaries`, `ListRecommendations` |
| `ReadCloudWatchUtilization` | `cloudwatch:ListMetrics`, `cloudwatch:GetMetricData` |
| `ReadComputeOptimizerRecommendations` | `compute-optimizer:GetEnrollmentStatus`, `GetEC2InstanceRecommendations`, `GetEBSVolumeRecommendations`, `GetLambdaFunctionRecommendations`, `GetRDSDatabaseRecommendations`, `GetIdleRecommendations` |
| `ReadComputeOptimizerDependencies` | `ec2:DescribeInstances`, `ec2:DescribeVolumes`, `lambda:ListFunctions`, `lambda:ListProvisionedConcurrencyConfigs`, `rds:DescribeDBClusters`, `rds:DescribeDBInstances` |
| `ReadTrustedAdvisorRecommendations` | `trustedadvisor:ListRecommendations` |
| `InvokeConfiguredBedrockModel` | `bedrock:InvokeModel`（設定した推論プロファイル / 基盤モデルのARNに限定） |
| （Secret） | `secretsmanager:GetSecretValue`（Slack Webhook Secretのみ） |
| （Lambda） | `lambda:InvokeFunction`（調査Lambdaのみ） |

`ReadComputeOptimizerDependencies` のDescribe/Listは、Compute Optimizerの推薦にインスタンス名などの文脈を付けるために使います。

### 調査Lambda

| Sid | アクション |
| --- | --- |
| `InvestigateCostExplorer` | `ce:GetCostAndUsage` |
| `InvestigateCloudTrailChanges` | `cloudtrail:LookupEvents` |
| `InvestigateResourceInventory` | `ec2:DescribeInstances`, `lambda:ListFunctions`, `rds:DescribeDBInstances`, `s3:ListAllMyBuckets` |
| `InvestigateS3LifecycleConfiguration` | `s3:GetLifecycleConfiguration` |
| `InvokeConfiguredBedrockModel` | `bedrock:InvokeModel`（同上） |

### `FinOpsBudgetAlertStack`

| コンポーネント | アクション |
| --- | --- |
| Budget Alert Lambda | `secretsmanager:GetSecretValue`（Slack Webhook Secretのみ） |
| SNS Topic | AWS BudgetsからのPublishを許可 |
| Custom Resource | `budgets:ModifyBudget`：既存BudgetへのSNS購読追加・削除に使用（AWS BudgetsのSubscriber APIはこの権限で認可されます） |

> [!NOTE]
> `budgets:ModifyBudget` は名前のとおり変更系ですが、用途は購読先（Subscriber）の追加・削除に限られます。AWS Budgetsのその他の変更操作と権限が共通であるためこの名前になっています。予算額・しきい値・メール通知先はこのスタックでは変更しません。

## モデル出力を認可の根拠にしない

BedrockのTool Useでは、モデルが「どの読み取りをしたいか」を選びます。しかし**実行の可否はモデルの出力では決まりません**。実装側で次を検証してからAWS APIを呼びます。

- 対象サービスが、コード側で検知した増加サービスに含まれているか
- 要求されたツールが許可リストに含まれているか
- 期間が許容範囲内か
- ツール呼び出し回数・往復回数が上限（`investigationMaxToolCalls` / `investigationMaxTurns`）を超えていないか

## 運用時の注意

### Slack Webhookの取り扱い

- Webhook URLをログ、Issue、Pull Request、ソースコードへ貼らないでください
- 漏えいした場合は**Slack側で直ちに再発行**し、Secrets Managerの値を更新してください（[更新手順](./setup.md#3-slack-webhookをsecrets-managerへ保存)）

### Bedrockへ送られるデータ

以下がモデルへの入力に含まれます。組織のデータ分類ポリシーと照合してください。

- 集計コスト額
- Recommendationの内容
- リソース識別子（インスタンスID、バケット名など）
- Linked Account名、リージョン、Usage Type

**同じ内容の一部は、AIの要約を通じてSlackへ投稿される可能性があります。** マスキングが必要な場合は収集段階で処理してください。

### リージョンとデータレジデンシー

グローバル推論プロファイル（`global.` プレフィックス）を使う場合、推論がリージョン横断になる場合があります。組織のリージョン制限やSCPも併せて確認してください（[モデルを変更する](./configuration.md#モデルを変更する)）。

### デプロイ権限

CDKをデプロイする利用者には、このスタックとIAMロールを作成できる権限が必要です。**Lambda実行ロールの権限とは別物**として扱ってください。Lambda実行ロールが読み取り専用であることは、デプロイ実行者の権限を制限するものではありません。
</content>
