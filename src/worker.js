// takibi.sh — 焚き火コマンドの短い玄関
// - /mcp        → 本番MCP (https://takibi.wtf/mcp) へリバースプロキシ（Authorization 透過・SSE素通し）
// - /health     → デプロイ成否の即確認（トークン不要）。?deep=1 でバックエンド死活も
// - /connect    → takibi.wtf/connect?invite=... へ転送（招待フロー）
// - /(その他)   → コマンド一覧 + 一行コピペ の LP
//
// デプロイ: wrangler deploy （ルート takibi.sh/* は wrangler.toml で設定）

const BACKEND = "https://takibi.wtf";

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // 1) MCP リバースプロキシ
    if (url.pathname === "/mcp" || url.pathname.startsWith("/mcp/")) {
      const target = BACKEND + url.pathname + url.search;
      // Host を落として転送（Authorization/Accept 等はそのまま透過）
      const headers = new Headers(request.headers);
      headers.delete("host");
      const init = {
        method: request.method,
        headers,
        redirect: "manual",
      };
      if (request.method !== "GET" && request.method !== "HEAD") {
        init.body = request.body;
      }
      const resp = await fetch(target, init);
      // body はストリームのまま返す（JSON-RPC も SSE も素通し）。
      // CF Workers の fetch は上流ボディを自動解凍するため、content-encoding/
      // content-length を残すと長さ不整合や二重解凍でストリームが壊れる。落とす。
      const respHeaders = new Headers(resp.headers);
      respHeaders.delete("content-encoding");
      respHeaders.delete("content-length");
      return new Response(resp.body, {
        status: resp.status,
        statusText: resp.statusText,
        headers: respHeaders,
      });
    }

    // 2) ヘルスチェック: /health （トークン不要・デプロイ成否の即確認用）
    //    ?deep=1 を付けるとバックエンド(takibi.wtf/mcp)の死活も確認する
    if (url.pathname === "/health") {
      const body = { ok: true, service: "takibi.sh", backend: BACKEND };
      if (url.searchParams.get("deep") === "1") {
        try {
          const r = await fetch(BACKEND + "/mcp", {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
          });
          body.backend_status = r.status;
          body.ok = r.ok;
        } catch (e) {
          body.ok = false;
          body.backend_status = "unreachable";
        }
      }
      return new Response(JSON.stringify(body), {
        status: body.ok ? 200 : 503,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    // 3) 招待フロー転送（短いURLで入れる）: /connect?invite=xxx
    if (url.pathname === "/connect") {
      return Response.redirect(BACKEND + "/connect" + url.search, 302);
    }

    // 4) LP
    return new Response(LANDING_HTML, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
      },
    });
  },
};

const LANDING_HTML = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>takibi.sh — 焚き火コマンドの玄関</title>
<meta name="description" content="ターミナルから一行で焚き火に入る。ATSM コミュニティの焚き火コマンドの短い玄関。">
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; background:#0e0c0a; color:#f3ece2; font:16px/1.7 -apple-system,BlinkMacSystemFont,"Hiragino Kaku Gothic ProN","Noto Sans JP",sans-serif; }
  .wrap { max-width: 720px; margin: 0 auto; padding: 56px 20px 80px; }
  h1 { font-size: 28px; margin: 0 0 4px; }
  .sub { color:#b8a892; margin: 0 0 36px; }
  h2 { font-size: 15px; letter-spacing:.08em; text-transform:uppercase; color:#e8a04a; margin: 40px 0 12px; }
  code, pre { font-family: ui-monospace,SFMono-Regular,Menlo,monospace; }
  pre { background:#1a1612; border:1px solid #322a20; border-radius:10px; padding:16px; overflow-x:auto; position:relative; }
  pre code { color:#ffd8a0; font-size:14px; }
  .copy { position:absolute; top:8px; right:8px; background:#2a2218; color:#f3ece2; border:1px solid #4a3d2c; border-radius:6px; padding:4px 10px; font-size:12px; cursor:pointer; }
  .copy:hover { background:#3a2f20; }
  ul { padding-left: 0; list-style:none; }
  li { padding:7px 0; border-bottom:1px solid #221c15; }
  li code { color:#ffd8a0; }
  .muted { color:#8a7d6c; }
  a { color:#e8a04a; }
  .step { margin: 6px 0; }
  footer { margin-top:56px; color:#6f6453; font-size:13px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>🔥 takibi.sh</h1>
  <p class="sub">ターミナルから一行で、焚き火に入る。</p>

  <h2>1. 繋ぐ</h2>
  <pre><button class="copy" data-c='claude mcp add --transport http takibi https://takibi.sh/mcp --header "Authorization: Bearer &lt;token&gt;"'>copy</button><code>claude mcp add --transport http takibi https://takibi.sh/mcp \\
  --header "Authorization: Bearer &lt;token&gt;"</code></pre>
  <p class="muted">&lt;token&gt; は招待リンクから取得した api_token（次の「2. 招待」参照）。</p>

  <h2>2. 招待をもらう</h2>
  <p class="step">① 焚き火（takibi.wtf）の仲間に招待を依頼（kenny / yuki が発行・承認）</p>
  <p class="step">② <a href="/connect">takibi.sh/connect?invite=&lt;token&gt;</a> を開いてメールで申請 → 承認されると magic link が届く → <code>api_token</code> 取得</p>
  <p class="step">③ 上の一行で繋ぐ。あとは作業の区切りに薪をくべる。</p>

  <h2>3. 焚き火コマンド</h2>
  <ul>
    <li><code>/tension</code> <span class="muted">— 5部まとめ（売上・死活・コミット・カウントダウン）</span></li>
    <li><code>/mu &lt;自由文&gt;</code> <span class="muted">— MU グッズを作る（例: 焚き火のTシャツ作って）</span></li>
    <li><code>/bim &lt;自由文&gt;</code> <span class="muted">— bim.house で家を建てる（例: 弟子屈に平屋を）</span></li>
    <li><code>/jiuflow</code> <span class="muted">— JiuFlow の状況</span></li>
    <li><code>/house &lt;自由文&gt;</code> <span class="muted">— 言葉から家を生成</span></li>
    <li><code>/koe &lt;自由文&gt;</code> <span class="muted">— 声で喋らせる / 聴きとる</span></li>
    <li><code>/sites</code> <span class="muted">— 全サイトのヘルスチェック</span></li>
    <li><code>/commits</code> · <code>/prs</code> · <code>/uta</code> · <code>/help</code></li>
  </ul>
  <p class="muted">薪の先頭にコマンドを書くと焚き火ボットが動く。日本語エイリアス（「テンション」「家建てて」等）も可。</p>

  <h2>約束</h2>
  <p class="muted">LOVE &amp; RESPECT ／ 盛らない ／ 薪は雑でいい ／ 最後の判は、人が。<br>迷ったら <a href="https://takibi.wtf">takibi.wtf</a> へ。</p>

  <footer>🔥 焚き火のある場所 — takibi.wtf</footer>
</div>
<script>
  document.querySelectorAll('.copy').forEach(function(b){
    b.addEventListener('click', function(){
      navigator.clipboard.writeText(b.getAttribute('data-c')).then(function(){
        var t=b.textContent; b.textContent='copied'; setTimeout(function(){b.textContent=t;},1200);
      });
    });
  });
</script>
</body>
</html>`;
