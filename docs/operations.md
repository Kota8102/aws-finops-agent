# 運用ガイド

## このAgent自体のコスト

このAgent自体にもAWS利用料が発生します。主な課金要素は次のとおりです。

- Amazon Bedrockの入力/出力トークン
- 大きなコスト増加時だけ発生する調査AgentのBedrock、Cost Explorer、CloudTrail、各サービスの読み取りAPI
- Cost Explorer API
- Lambda実行時間
- Secrets ManagerのSecret
- CloudWatch LogsとCloudWatch API
- EventBridge Scheduler、SQS DLQ
- Budget即時通知用のSNSと短時間Lambda

料金はリージョン、モデル、実行頻度、リソース数で変わります。導入前に各サービスの公式料金ページで確認し、必要ならAWS Budgetsも併用してください。AI入力は上位Recommendationへ制限し、日次実行を前提にしています。

## ログを見る

```bash
LOG_GROUP=$(aws lambda get-function-configuration \
  --function-name "$FUNCTION_NAME" \
  --region "$AWS_REGION" \
  --query 'LoggingConfig.LogGroup' \
  --output text)

aws logs tail "$LOG_GROUP" \
  --since 1h \
  --region "$AWS_REGION"
```

Schedulerの失敗イベントはSQS DLQへ送られます。URLはCloudFormation Outputの`DeadLetterQueueUrl`で確認できます。

## トラブルシューティング

| 症状 | 確認事項 |
| --- | --- |
| `AccessDeniedException`でBedrockが失敗 | モデル/推論プロファイルID、Bedrock利用可否、IAM、SCP、Bedrockリージョンを確認 |
| `aiFallback: true` | LambdaログのBedrockエラーを確認。数値ベースのフォールバック通知は継続されます |
| Compute Optimizerが`unavailable` | 対象アカウント/リージョンでオプトイン済みか、推薦生成に必要な履歴があるか確認 |
| Trusted Advisorが`unavailable` | AWSアカウントの利用条件、サポートプラン、IAMを確認 |
| Cost Anomalyが常に0件 | モニターの有無と作成後の学習期間を確認。週次比較と異常検知は判定方式が異なります |
| CloudWatchの確認リソースが0件 | デプロイ先リージョンにEC2/RDSのCPUメトリクスがあるか確認 |
| Slack投稿が4xxで失敗 | Secretの値、Webhookの失効・ローテーション、URLが`https://hooks.slack.com/`で始まるか確認 |
| Budgetはメールに届くがSlackへ届かない | `FinOpsBudgetAlertStack`のCustom Resourceと`BudgetAlertFunction`のCloudWatch Logsを確認。Budgetの通知しきい値が実績（ACTUAL）で作成済みか確認 |
| コストが請求画面と一致しない | コスト指標、Cost Explorerのデータ遅延、当日を除外した集計期間を確認 |
| Budgetが`unavailable` | Billing consoleへのアクセス、Budget閲覧権限、Billing Viewの設定を確認 |
| Cost Optimization Hubが`unavailable` | Hubのオプトインと閲覧権限を確認。Hubが未設定でも他の収集は継続します |
| コスト配分タグが`unavailable` | Linked Accountではタグ一覧を読めない場合があります。管理アカウントまたは委任管理者の権限を確認 |
| 月末見込みが不自然 | Cost Explorer予測が優先されます。APIが取得不可の場合は線形外挿へフォールバックします |
| 調査が`取得不可` | `InvestigationFunction`のCloudWatch LogsでBedrock、CloudTrail、対象サービスのIAMエラーを確認。日次通知は継続します |
| 調査が`上限到達` | `investigationMaxToolCalls`または`investigationMaxTurns`を確認。上限を増やす前に、通知の実行時間とBedrock料金を評価します |

## 既知の制約

### 収集範囲

- Cost Explorerは請求アカウント全体ですが、CloudWatchとCompute Optimizerはデプロイ先の1リージョンだけを確認します。
- タグは既に有効なキーを表示するだけで、タグ値・配賦額・Cost Category・Business Unit別の集計は行いません。
- CloudWatchはEC2/RDSを各最大100リソース探索し、14日間の日次平均CPUを使います。
- `maximumDailyAverage`は瞬間的な最大CPUではありません。
- メモリ利用率はCloudWatch Agentが必要なため、現在のCloudWatch収集対象には含みません。
- CloudTrail Event historyはデプロイ先リージョンの過去90日間の管理イベントだけです。S3オブジェクト操作などのData event、他リージョンの変更、イベントとコストの厳密な因果は保証しません。
- S3のバケット別・プレフィックス別の請求額は、標準のCost Explorerだけでは特定できません。Storage LensまたはCost and Usage Reportを別途有効化すると深掘りできます。

### 金額の精度

- Slackの削減候補/月はCost Optimization Hubの重複除外済み金額を優先します。将来の利用量により実現額は変動します。
- Cost Explorer予測も季節性、予約割引、クレジット、Tax、月末処理の影響で実額と異なる場合があります。
- Cost Explorerの最新データには遅延や未確定調整が含まれる場合があります。

### 機能面

- Cost Anomaly monitorは作成できますが、Anomaly Subscriptionは作成しません。
- 予測（`FORECASTED`）通知は`FinOpsBudgetAlertStack`が1件を管理します。この通知へメール購読者を追加した場合でも、スタック削除時には通知全体が削除されます。
- 調査Agentは日次コスト比較で検出した増加を対象にします。Cost Anomaly Detectionが0件でも、週次比較の増加は調査されます。
- EC2/RDS/Lambda/S3以外は、まずCost Explorer内訳とCloudTrailを使います。リソース構成の専用調査は要望・データ量に応じて追加してください。
- Slackからの対話、承認ワークフロー、自動修復は未実装です。
