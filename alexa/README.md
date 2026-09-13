# 🔥 Alexa スキル「たきび」（AWS Lambda 構成）

「**アレクサ、たきびに繋げて**」で、焚き火(atsm.wtf)の最新の薪を Alexa が読み上げる。

```
あなた : 「アレクサ、たきびに繋げて」
Alexa : 「いま焚き火には、3本の薪。粟田さん。画面共有ウィンドウを改善…以上です。」
```

## しくみ（全部 AWS）

```
Echo端末 ─"たきびに繋げて"─▶ Alexa ─(ASKトリガー)─▶ Lambda takibi-alexa (ap-northeast-1)
                                                       │ atsm.wtf/mcp
                                                       │   header: x-takibi-key: <secret>   ← CloudflareのWAFスキップ用
                                                       ▼ community_list_posts
                                            最新の薪 → ボット薪除外 → 上位3本 → SSML 読み上げ
```

- バックエンド実装: `lambda/index.mjs`（Node 20・依存ゼロ・global fetch）
- 対話モデル/マニフェスト: `skill-package/`（ASK CLI 形式）

## デプロイ済みの状態（2026-06-08 時点）

| 項目 | 値 |
|---|---|
| Lambda | `takibi-alexa` / region `ap-northeast-1` / Node20 / 128MB / timeout 10s |
| ARN | `arn:aws:lambda:ap-northeast-1:495350830663:function:takibi-alexa` |
| IAM role | `takibi-alexa-role`（AWSLambdaBasicExecutionRole） |
| 権限 | `alexa-appkit.amazon.com` からの invoke を許可（ASKトリガー） |
| env | `ATSM_TOKEN`(焚き火read) / `TAKIBI_KEY`(WAFスキップ秘密) / `ALEXA_SKILL_ID`(現プレースホルダ) |

`ALEXA_SKILL_ID` が一致しない appId は **fail-closed で拒否**（公開しても焚き火の中身は漏れない）。
動作確認済み: appId不一致→「このスキルはまだ設定中です」/ appId一致→焚き火fetchへ到達。

> Lambda Function URL は当初作ったが、この AWS アカウントでは公開アクセスが 403（OrgのSCP想定）。
> Alexa は **ASKトリガー（Lambda ARN直結）** で繋ぐので Function URL は削除済み。

## 残りの人手（2ステップ）

### ① kenny さん: Cloudflare の WAF スキップルール（← これが入るまで焚き火に到達できない）

`atsm.wtf` は Cloudflare 配下で、**AWSデータセンターIP が bot チャレンジ（"Just a moment…"）で弾かれる**。
そこで「特定の秘密ヘッダが付いていたら bot 判定をスキップ」するルールを足す:

```
Security → WAF → Custom rules（または Configuration Rules / Bot Fight Mode の Skip）
  When:  (http.request.uri.path eq "/mcp") and (http.request.headers["x-takibi-key"][0] eq "<SECRET>")
  Then:  Skip → Bot Fight Mode（および該当する Managed Challenge）
```

`<SECRET>` の実値は **`alexa/lambda/.waf-secret`（gitignore済）** に保存。Lambda env `TAKIBI_KEY` と同値。
取り出し方（どちらでも同じ値）:

```bash
cat alexa/lambda/.waf-secret
# or AWS から:
aws lambda get-function-configuration --function-name takibi-alexa \
  --region ap-northeast-1 --query 'Environment.Variables.TAKIBI_KEY' --output text
```

⚠ 秘密なので Slack/メール等の安全な経路で kenny さんへ。焚き火フィードには貼らない。

### ② yuki さん: Alexa スキルを作る（Amazon 開発者アカウントのブラウザログインが要るので人手）

> 前提: Amazon 開発者アカウント（無料 / https://developer.amazon.com ）。個人/コミュニティ用は配布 **PRIVATE** のままでOK。

開発者コンソール手順:
1. https://developer.amazon.com/alexa/console/ask →「スキルの作成」→ モデル=**Custom**、ホスト=**Provision your own**
2. 「対話モデル」→ JSONエディター に `skill-package/interactionModels/custom/ja-JP.json` を貼る → 保存 → ビルド
3. 「エンドポイント」→ **AWS Lambda の ARN** → 上記 ARN を貼る（デフォルトのリージョンに ap-northeast-1 用の欄がある）
4. 画面上部のスキルIDをコピー（`amzn1.ask.skill.xxxx`）→ Lambda env を実値に更新:
   ```bash
   aws lambda update-function-configuration --function-name takibi-alexa \
     --region ap-northeast-1 \
     --environment "Variables={ATSM_TOKEN=$(aws lambda get-function-configuration --function-name takibi-alexa --region ap-northeast-1 --query 'Environment.Variables.ATSM_TOKEN' --output text),TAKIBI_KEY=$(cat alexa/lambda/.waf-secret),ALEXA_SKILL_ID=amzn1.ask.skill.xxxx}"
   ```
5. 「テスト」タブを Development にして `アレクサ、たきびに繋げて`。自分の Echo（同一Amazonアカウント）でもそのまま使える。

（ASK CLI 派なら: `npm i -g ask-cli && ask configure`(ブラウザログイン) → `ask deploy`。スキルIDは同様に env へ。）

## コードを更新したとき

```bash
cd alexa/lambda && zip -q -j /tmp/takibi-alexa.zip index.mjs
aws lambda update-function-code --function-name takibi-alexa --zip-file fileb:///tmp/takibi-alexa.zip --region ap-northeast-1
```

## 撤去（全消し）

```bash
aws lambda delete-function --function-name takibi-alexa --region ap-northeast-1
aws iam detach-role-policy --role-name takibi-alexa-role --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
aws iam delete-role --role-name takibi-alexa-role
# Alexa スキルは開発者コンソール / ask CLI で削除
```

## ⚠ 既知の制限（盛らない）

- **署名検証は未実装**。ガードは appId 一致(fail-closed) + timestamp 鮮度(150s)のみ。
  ストア公開申請する場合は `Signature`/`SignatureCertChainUrl` の検証が必須（PRIVATE 運用は現状で可）。
- **双方向通話**（koe.live/takibi の音声ルーム参加）は Alexa カスタムスキルの仕様上不可。本スキルは読み上げ一方向。
- invocation 名 `たきび` は単語1つ。PRIVATE は可だが、ストア審査では2語以上推奨。
- **焚き火 fetch は WAF ルール①が入るまで未疎通**（appId一致でも "繋げませんでした" を返す）。
