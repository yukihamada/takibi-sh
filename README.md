# takibi.sh — 焚き火コマンドの短い玄関

ターミナルから一行で ATSM の焚き火（MCP）に入るための、軽量 Cloudflare Worker。

```
claude mcp add --transport http takibi https://takibi.sh/mcp \
  --header "Authorization: Bearer <token>"
```

## 何をするか

| パス | 動作 |
|---|---|
| `/mcp` | 本番MCP `https://atsm.wtf/mcp` へリバースプロキシ。`Authorization: Bearer` を透過。JSON-RPC も SSE も素通し |
| `/connect` | `https://atsm.wtf/connect?invite=...` へ302転送（招待フロー） |
| `/`（その他） | コマンド一覧＋一行コピペの LP |

kenny さんの本番 atsm.wtf 側のインフラには一切触らない（プロキシのみ）。トークンはホスト非依存の Bearer なので、takibi.sh 経由でもそのまま機能する。

## 前提

- ドメイン `takibi.sh` は Cloudflare 管理（NS=cloudflare）。**粟田さんのCloudflareアカウント**にゾーンが紐づいていること。
- プロキシ先 `https://atsm.wtf/mcp` は実在・LIVE（`POST` で `tools/list` が 200 を返すことを確認済み 2026-06-08）。

## デプロイ（粟田さんのアカウントで）

```bash
npm i -g wrangler          # 未導入なら
wrangler login             # takibi.sh があるCloudflareアカウントで
wrangler deploy
```

`wrangler.toml` の `routes` で `takibi.sh/*` に当たる。デプロイ後の確認:

```bash
# LP
curl -sS https://takibi.sh/ | head
# MCP プロキシ（本番と同じ tools 一覧が返れば成功）
curl -sS -X POST https://takibi.sh/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## ローカル確認

```bash
wrangler dev
# 別ターミナルで:
curl -sS -X POST http://localhost:8787/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## メモ

- `.well-known/mcp` はバックエンドに無い（404）。`claude mcp add --transport http` は `/mcp` 直で動く。
- LP のコマンド一覧は焚き火コマンドボットに合わせて更新する。
