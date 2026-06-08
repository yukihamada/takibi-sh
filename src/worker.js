// takibi.sh — 焚き火コマンドの短い玄関
// - /mcp        → 本番MCP (https://atsm.wtf/mcp) へリバースプロキシ（Authorization 透過・SSE素通し）
// - /health     → デプロイ成否の即確認（トークン不要）。?deep=1 でバックエンド死活も
// - /connect    → atsm.wtf/connect?invite=... へ転送（招待フロー）
// - /(その他)   → コマンド一覧 + 一行コピペ の LP
//
// デプロイ: wrangler deploy （ルート takibi.sh/* は wrangler.toml で設定）

const BACKEND = "https://atsm.wtf";

export default {
  async fetch(request, env) {
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

    // 3) Alexa スキルのバックエンド: POST /alexa
    //    「アレクサ、たきびに繋げて」→ 最新の薪をAlexaが読み上げる。
    //    必要な env: ATSM_TOKEN(焚き火の read token) / 任意: ALEXA_SKILL_ID(検証用)
    if (url.pathname === "/alexa") {
      return handleAlexa(request, env);
    }

    // 4) 招待フロー転送（短いURLで入れる）: /connect?invite=xxx
    if (url.pathname === "/connect") {
      return Response.redirect(BACKEND + "/connect" + url.search, 302);
    }

    // 5) LP
    return new Response(LANDING_HTML, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
      },
    });
  },
};

// ───────────────────────────── Alexa ─────────────────────────────
// 「アレクサ、たきびに繋げて」で焚き火の最新の薪を読み上げるカスタムスキルのバックエンド。
// セキュリティ: applicationId 一致 + timestamp 鮮度(150秒)で簡易ガード。
//   ⚠ 未実装: Alexa の Signature/SignatureCertChainUrl 署名検証（ストア公開の認証には必須）。
//   個人/コミュニティ用スキルとしてはこのガードで運用可。公開申請前に署名検証を足すこと。
const ALEXA_MAX_POSTS = 3;       // 一度に読む薪の本数
const ALEXA_MAX_BODY = 140;      // 1本あたりの本文最大文字数（読み上げ用）

async function handleAlexa(request, env) {
  if (request.method !== "POST") {
    return new Response("Alexa endpoint: POST only", { status: 405 });
  }
  let event;
  try {
    event = await request.json();
  } catch {
    return alexaSpeak("リクエストを読み取れませんでした。", true);
  }

  // applicationId 検証（ALEXA_SKILL_ID を設定したときのみ・第三者POST対策）
  const appId =
    event?.context?.System?.application?.applicationId ||
    event?.session?.application?.applicationId;
  if (env.ALEXA_SKILL_ID && appId !== env.ALEXA_SKILL_ID) {
    return new Response("forbidden", { status: 403 });
  }

  // timestamp 鮮度（リプレイ対策の簡易版）
  const ts = event?.request?.timestamp ? Date.parse(event.request.timestamp) : NaN;
  if (!Number.isNaN(ts) && Math.abs(Date.now() - ts) > 150000) {
    return new Response("stale request", { status: 400 });
  }

  const type = event?.request?.type;
  const intent = event?.request?.intent?.name;

  if (type === "SessionEndedRequest") {
    return new Response(null, { status: 200 });
  }
  if (intent === "AMAZON.StopIntent" || intent === "AMAZON.CancelIntent") {
    return alexaSpeak("また焚き火で。", true);
  }
  if (intent === "AMAZON.HelpIntent") {
    return alexaSpeak(
      "「アレクサ、たきびに繋げて」と言うと、焚き火の最新の薪を読み上げます。",
      false
    );
  }

  // LaunchRequest / ReadWoodIntent / FallbackIntent → 最新の薪を読む
  try {
    const ssml = await buildFirepitSsml(env);
    return alexaSpeakSsml(ssml, true);
  } catch (e) {
    return alexaSpeak("いま焚き火に繋げませんでした。少し経ってからもう一度どうぞ。", true);
  }
}

// atsm.wtf/mcp から最新の薪を取得して SSML を組む
async function buildFirepitSsml(env) {
  const token = env.ATSM_TOKEN || "";
  if (!token) throw new Error("ATSM_TOKEN not set");
  const auth = token.startsWith("Bearer ") ? token : `Bearer ${token}`;

  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    authorization: auth,
  };
  // Cloudflare の bot チャレンジを越える秘密ヘッダ（WAF skip ルールと対・AWS経路と共通）
  if (env.TAKIBI_KEY) headers["x-takibi-key"] = env.TAKIBI_KEY;

  const r = await fetch(BACKEND + "/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "community_list_posts", arguments: {} },
    }),
  });
  if (!r.ok) throw new Error("mcp " + r.status);
  const raw = await r.text();
  const text = extractMcpText(raw);
  const posts = parsePosts(text)
    .filter((p) => !isBotPost(p))
    .slice(0, ALEXA_MAX_POSTS);

  if (posts.length === 0) {
    return "<speak>いま焚き火に新しい薪はありません。</speak>";
  }
  const parts = [`<speak>いま焚き火には、${posts.length}本の薪。<break time="400ms"/>`];
  for (const p of posts) {
    parts.push(`${escapeSsml(p.who)}さん。${escapeSsml(p.body)}<break time="500ms"/>`);
  }
  parts.push("以上です。</speak>");
  return parts.join("");
}

// MCP のレスポンス(JSON もしくは SSE 行)から content[].text を取り出す
function extractMcpText(raw) {
  // SSE の場合は "data: {...}" 行に JSON が入る
  let jsonStr = raw.trim();
  if (jsonStr.startsWith("event:") || jsonStr.includes("\ndata:") || jsonStr.startsWith("data:")) {
    const line = raw.split("\n").find((l) => l.startsWith("data:"));
    if (line) jsonStr = line.slice(5).trim();
  }
  const obj = JSON.parse(jsonStr);
  const content = obj?.result?.content;
  if (Array.isArray(content)) {
    return content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
  }
  return "";
}

// "[名前] MM-DD HH:MM (id: xxx)\n本文..." の連結をパース
function parsePosts(text) {
  const re = /\[([^\]]+)\]\s+\d{2}-\d{2}\s+\d{2}:\d{2}\s+\(id:\s*[0-9a-f-]+\)\n/g;
  const heads = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    heads.push({ name: m[1].trim(), start: m.index, bodyStart: re.lastIndex });
  }
  const out = [];
  for (let i = 0; i < heads.length; i++) {
    const end = i + 1 < heads.length ? heads[i + 1].start : text.length;
    const body = text.slice(heads[i].bodyStart, end).trim();
    out.push({ name: heads[i].name, body, who: surname(heads[i].name), spoken: cleanForSpeech(body) });
  }
  // body を読み上げ用に正規化（cleanForSpeech 済みを body に入れ替え）
  return out.map((p) => ({ who: p.who, body: p.spoken })).filter((p) => p.body.length > 0);
}

function isBotPost(p) {
  return p.body.startsWith("🤖") || p.body.startsWith("🎙");
}

// "濱田 優貴" → "濱田" / 空白なしはそのまま
function surname(name) {
  const t = name.split(/[\s　]/).filter(Boolean);
  return t.length ? t[0] : name;
}

// URL・コード・記号を落として読み上げ向けに整形 + 字数制限
function cleanForSpeech(s) {
  let t = s
    .replace(/https?:\/\/\S+/g, "")        // URL 除去（読み上げると長い）
    .replace(/`[^`]*`/g, "")               // インラインコード除去
    .replace(/[#>*_~|]/g, " ")             // markdown 記号
    .replace(/[\r\n]+/g, "、")             // 改行は読点に
    .replace(/[ \t　]+/g, " ")
    .trim();
  if (t.length > ALEXA_MAX_BODY) t = t.slice(0, ALEXA_MAX_BODY) + "、以下略";
  return t;
}

function escapeSsml(s) {
  return String(s)
    .replace(/&/g, "＆")
    .replace(/</g, "〈")
    .replace(/>/g, "〉")
    .replace(/"/g, "”");
}

function alexaSpeak(text, end) {
  return alexaSpeakSsml("<speak>" + escapeSsml(text) + "</speak>", end);
}

function alexaSpeakSsml(ssml, end) {
  return new Response(
    JSON.stringify({
      version: "1.0",
      response: {
        outputSpeech: { type: "SSML", ssml },
        shouldEndSession: end !== false,
      },
    }),
    { headers: { "content-type": "application/json; charset=utf-8" } }
  );
}

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
  <p class="step">① 焚き火（atsm.wtf）の仲間に招待を依頼（kenny / yuki が発行・承認）</p>
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
  <p class="muted">LOVE &amp; RESPECT ／ 盛らない ／ 薪は雑でいい ／ 最後の判は、人が。<br>迷ったら <a href="https://atsm.wtf">atsm.wtf</a> へ。</p>

  <footer>🔥 焚き火のある場所 — atsm.wtf</footer>
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
