// takibi.sh — 焚き火コマンドの短い玄関
// - /mcp        → 本番MCP (https://atsm.wtf/mcp) へリバースプロキシ（Authorization 透過・SSE素通し）
// - /health     → デプロイ成否の即確認（トークン不要）。?deep=1 でバックエンド死活も
// - /connect    → atsm.wtf/connect?invite=... へ転送（招待フロー）
// - /(その他)   → コマンド一覧 + 一行コピペ の LP
//
// デプロイ: wrangler deploy （ルート takibi.sh/* は wrangler.toml で設定）

const BACKEND = "https://atsm.wtf";

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
      // body はストリームのまま返す（JSON-RPC も SSE も素通し）
      return new Response(resp.body, {
        status: resp.status,
        statusText: resp.statusText,
        headers: resp.headers,
      });
    }

    // 2) ヘルスチェック: /health （トークン不要・デプロイ成否の即確認用）
    //    ?deep=1 を付けるとバックエンド(atsm.wtf/mcp)の死活も確認する
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
<meta property="og:type" content="website">
<meta property="og:title" content="🔥 takibi.sh">
<meta property="og:description" content="ターミナルから一行で、焚き火に入る。 / Enter the campfire with one line from your terminal.">
<meta property="og:url" content="https://takibi.sh">
<meta name="twitter:card" content="summary">
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
  .lang { position:absolute; top:18px; right:18px; background:#1a1612; color:#f3ece2; border:1px solid #4a3d2c; border-radius:8px; padding:5px 12px; font-size:12px; cursor:pointer; }
  .lang:hover { background:#2a2218; }
</style>
</head>
<body>
<div class="wrap">
  <button class="lang" id="langBtn" onclick="__setLang(__lang==='ja'?'en':'ja')">🌐 EN</button>
  <h1>🔥 takibi.sh</h1>
  <p class="sub" data-i18n="sub">ターミナルから一行で、焚き火に入る。</p>

  <h2 data-i18n="h1">1. 繋ぐ</h2>
  <pre><button class="copy" data-c='claude mcp add --transport http takibi https://takibi.sh/mcp --header "Authorization: Bearer &lt;token&gt;"'>copy</button><code>claude mcp add --transport http takibi https://takibi.sh/mcp \\
  --header "Authorization: Bearer &lt;token&gt;"</code></pre>
  <p class="muted" data-i18n="tok">&lt;token&gt; は招待リンクから取得した api_token（次の「2. 招待」参照）。</p>

  <h2 data-i18n="h2">2. 招待をもらう</h2>
  <p class="step" data-i18n="s1">① 焚き火（atsm.wtf）の仲間に招待を依頼（kenny / yuki が発行・承認）</p>
  <p class="step">② <a href="/connect">takibi.sh/connect?invite=&lt;token&gt;</a> <span data-i18n="s2">を開いてメールで申請 → 承認されると magic link が届く → <code>api_token</code> 取得</span></p>
  <p class="step" data-i18n="s3">③ 上の一行で繋ぐ。あとは作業の区切りに薪をくべる。</p>

  <h2 data-i18n="h3">3. 焚き火コマンド</h2>
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
  <p class="muted" data-i18n="cmdnote">薪の先頭にコマンドを書くと焚き火ボットが動く。日本語エイリアス（「テンション」「家建てて」等）も可。</p>

  <h2 data-i18n="h4">約束</h2>
  <p class="muted"><span data-i18n="promise">LOVE &amp; RESPECT ／ 盛らない ／ 薪は雑でいい ／ 最後の判は、人が。</span><br><span data-i18n="lost">迷ったら</span> <a href="https://atsm.wtf">atsm.wtf</a> <span data-i18n="lost2">へ。</span></p>

  <footer data-i18n="foot">🔥 焚き火のある場所 — atsm.wtf</footer>
</div>
<script>
  document.querySelectorAll('.copy').forEach(function(b){
    b.addEventListener('click', function(){
      navigator.clipboard.writeText(b.getAttribute('data-c')).then(function(){
        var t=b.textContent; b.textContent='copied'; setTimeout(function(){b.textContent=t;},1200);
      });
    });
  });

  // i18n (ja/en) — vision: 世界中で使われる / i18n by default
  var I18N = {
    en: {
      sub: "Enter the campfire with one line from your terminal.",
      h1: "1. Connect",
      tok: "&lt;token&gt; is the api_token from your invite link (see step 2).",
      h2: "2. Get invited",
      s1: "① Ask a campfire (atsm.wtf) member for an invite (issued/approved by kenny / yuki)",
      s2: "— open it, apply by email → on approval a magic link arrives → get your <code>api_token</code>",
      s3: "③ Connect with the one-liner above. Then toss a log on the fire at each break.",
      h3: "3. Campfire commands",
      cmdnote: "Start a log with a command and the campfire bot runs. Japanese aliases also work.",
      h4: "The promise",
      promise: "LOVE &amp; RESPECT ／ no hype ／ rough logs welcome ／ a human presses the last button.",
      lost: "Lost? Head to", lost2: ".",
      foot: "🔥 where the campfire is — atsm.wtf",
      langBtn: "🌐 日本語"
    }
  };
  var __lang = (localStorage.getItem("takibi_lang") || ((navigator.language||"ja").slice(0,2)==="en"?"en":"ja"));
  function __applyI18n(){
    var d = I18N[__lang];
    document.documentElement.lang = __lang;
    var btn = document.getElementById("langBtn");
    if (__lang === "ja"){ // restore originals from data-ja, fall back to current
      document.querySelectorAll("[data-i18n]").forEach(function(el){ if(el.dataset.ja!=null) el.innerHTML = el.dataset.ja; });
      if (btn) btn.textContent = "🌐 EN";
      return;
    }
    document.querySelectorAll("[data-i18n]").forEach(function(el){
      var k = el.getAttribute("data-i18n");
      if (el.dataset.ja == null) el.dataset.ja = el.innerHTML; // stash ja original once
      if (d && d[k] != null) el.innerHTML = d[k];
    });
    if (btn) btn.textContent = d.langBtn;
  }
  window.__setLang = function(l){ __lang = l; localStorage.setItem("takibi_lang", l); __applyI18n(); };
  // stash ja originals first, then apply detected lang
  document.querySelectorAll("[data-i18n]").forEach(function(el){ el.dataset.ja = el.innerHTML; });
  __applyI18n();
</script>
</body>
</html>`;
