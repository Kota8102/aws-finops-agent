# 運用ガイド

- [トラブルシューティング](#トラブルシューティング)
- [ログを見る](#ログを見る)
- [このAgent自体のコスト](#このagent自体のコスト)
- [既知の制約](#既知の制約)

## トラブルシューティング

### 通知が届かない・AIが動かない

| 症状 | 確認事項 |
| --- | --- |
| Slack投稿が4xxで失敗 | Secretの値、Webhookの失効・ローテーション、URLが`https://hooks.slack.com/`で始まるか |
| Bedrockが`AccessDeniedException`で失敗 | モデル / 推論プロファイルID、Bedrockの利用可否、IAM、SCP、`bedrockRegion`の設定 |
| `aiFallback: true` になる | LambdaログのBedrockエラーを確認。数値ベースのフォールバック通知は継続されます |
| 定期実行されない | `scheduleEnabled`が`true`か、Schedulerの失敗イベントがSQS DLQに溜まっていないか |
| Budgetはメールに届くがSlackへ届かない | `FinOpsBudgetAlertStack`のCustom Resourceと`BudgetAlertFunction`のCloudWatch Logs。Budget通知が**実績（ACTUAL）**で作成済みか |

### データソースが `unavailable` になる

まず[前提条件（任意）](./setup.md#任意の前提条件)を確認してください。`unavailable`でも他の収集と通知は継続します。

| データソース | 確認事項 |
| --- | --- |
| Compute Optimizer | 対象アカウント / リージョンでオプトイン済みか、推薦生成に必要な稼働履歴があるか |
| Trusted Advisor | AWSアカウントの利用条件、サポートプラン、IAM |
| Budgets | Billing consoleへのアクセス、Budget閲覧権限、Billing Viewの設定 |
| Cost Optimization Hub | Hubのオプトインと閲覧権限 |
| コスト配分タグ | Linked Accountではタグ一覧を読めない場合があります。管理アカウントまたは委任管理者の権限 |
| CloudWatchの確認リソースが0件 | デプロイ先リージョンにEC2 / RDSのCPUメトリクスが存在するか |
| Cost Anomalyが常に0件 | モニターの有無と、作成後の学習期間。7日間比較と異常検知は判定方式が異なるため、直近7日で増加していても異常0件はあり得ます |

### 数値が想定と違う

| 症状 | 確認事項 |
| --- | --- |
| コストが請求画面と一致しない | [`costMetric`](./configuration.md#コスト指標を変更する)の選択、Cost Explorerのデータ遅延、当日を除外した集計期間 |
| 月末見込みが不自然 | Cost Explorer予測が優先されます。APIが取得不可の場合は線形外挿へフォールバックします |
| 削減候補の金額が実感と合わない | Cost Optimization Hubの重複除外済み金額（割引前/割引後は通知に表示）を優先表示しています。将来の利用量で実現額は変動します |
| 異常があるのに🔴にならない | 🔴へ昇格するのは「進行中または終了から7日以内、かつ影響額$10以上」の異常だけです（[`ANOMALY_ACTIVE_WITHIN_DAYS` / `ANOMALY_MIN_IMPACT_USD`](./configuration.md#コードで固定されている値)）。しきい値未満の異常は証拠行に `0（過去N）` と表示され、AI分析の入力には含まれます |

### 追加調査が動かない

| 症状 | 確認事項 |
| --- | --- |
| 調査が`取得不可` | `InvestigationFunction`のCloudWatch LogsでBedrock、CloudTrail、対象サービスのIAMエラーを確認。日次通知自体は継続します |
| 調査が`上限到達` | [`investigationMaxToolCalls` / `investigationMaxTurns`](./configuration.md#調査agentとモデル)。上限を上げる前に、日次レポートの実行時間（タイムアウト5分）とBedrock料金を評価してください |
| 調査が一度も走らない | [`investigationEnabled`](./configuration.md#調査agentとモデル)と起動条件（+$100以上 **かつ** +20%以上）。しきい値未満のときは意図的に走りません |

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

調査Agentのログは別のLog Groupにあります。関数名を`InvestigationFunction`のものに差し替えて同じコマンドを実行してください。

Schedulerの起動失敗イベントはSQS DLQへ送られます（14日保持）。URLはCloudFormation Outputの`DeadLetterQueueUrl`で確認できます。

```bash
aws cloudformation describe-stacks \
  --stack-name FinOpsFeedbackStack \
  --region "$AWS_REGION" \
  --query 'Stacks[0].Outputs'
```

## このAgent自体のコスト

コスト可視化のために課金が発生する、という点は最初に把握しておいてください。主な課金要素は次のとおりです。

| 課金要素 | 発生タイミング |
| --- | --- |
| Amazon Bedrockの入力 / 出力トークン | 毎日1回（日次要約） |
| 調査AgentのBedrock、Cost Explorer、CloudTrail、各種読み取りAPI | **大きなコスト増加を検知した日だけ** |
| Cost Explorer API | 毎日 |
| Lambda実行時間 | 毎日（+ Budget到達時） |
| Secrets ManagerのSecret | 常時（Secret 1件分） |
| CloudWatch LogsとCloudWatch API | 毎日 |
| EventBridge Scheduler、SQS DLQ | 毎日 |
| Budget即時通知用のSNSと短時間Lambda | Budgetしきい値到達時 |

料金はリージョン、モデル、実行頻度、リソース数で変わります。導入前に各サービスの公式料金ページで確認し、必要ならこのAgent自体にもAWS Budgetsを設定してください。

**コストを抑えたい場合の選択肢:**

- [`investigationEnabled=false`](./configuration.md#追加調査を無効にする) で追加調査を止める
- [`scheduleExpression`](./configuration.md#通知時刻を変更する) を平日のみに変更する
- より小さいBedrockモデルへ切り替える

AI入力は上位Recommendationに絞り込んでおり、日次実行を前提とした量に抑えています。

## 既知の制約

### 収集範囲

- Cost Explorerは請求アカウント全体を見ますが、**CloudWatchとCompute Optimizerはデプロイ先の1リージョンだけ**を確認します
- タグは有効なキーを表示するだけです。タグ値・配賦額・Cost Category・Business Unit別の集計は行いません
- CloudWatchはEC2 / RDSを各最大100リソース探索し、14日間の日次平均CPUを使います
- `maximumDailyAverage`は「日次平均の最大値」であり、瞬間的な最大CPUではありません
- メモリ利用率はCloudWatch Agentが必要なため、収集対象に含みません
- CloudTrail Event historyは**デプロイ先リージョンの過去90日間の管理イベント**のみです。S3オブジェクト操作などのData event、他リージョンの変更は見えず、イベントとコストの厳密な因果も保証しません
- S3のバケット別・プレフィックス別の請求額は標準のCost Explorerでは特定できません。Storage LensまたはCost and Usage Report（CUR）を別途有効化すると深掘りできます

### 金額の精度

- Slackの「削減候補/月」はCost Optimization Hubの重複除外済み金額を優先します。将来の利用量により実現額は変動します
- Cost Explorer予測も、季節性、予約割引、クレジット、Tax、月末処理の影響で実額と異なる場合があります
- Cost Explorerの最新データには遅延や未確定調整が含まれる場合があります

### 機能面

- Cost Anomaly monitorは作成できますが、**Anomaly Subscriptionは作成しません**
- 予測（`FORECASTED`）通知は`FinOpsBudgetAlertStack`が1件を管理します。この通知へ手動でメール購読者を追加しても、スタック削除時に通知全体が削除されます
- 調査Agentは日次コスト比較で検出した増加を対象にします。Cost Anomaly Detectionが0件でも、週次比較の増加は調査されます
- EC2 / RDS / Lambda / S3以外は、まずCost Explorer内訳とCloudTrailを使います。リソース構成の専用調査は必要に応じて追加してください
- Slackからの対話、承認ワークフロー、自動修復は未実装です（[しないこと](../README.md#しないこと)）
</content>
