// 🔥 たきび — Alexa スキルのバックエンド (AWS Lambda / Node 20, Function URL)
// 「アレクサ、たきびに繋げて」→ 焚き火(atsm.wtf)の最新の薪を読み上げる。
//
// env:
//   ATSM_TOKEN     (必須)   焚き火の read 用 api_token（"Bearer " 接頭辞は任意）
//   ALEXA_SKILL_ID (必須)   amzn1.ask.skill.xxxx。これと一致しない appId は 403（fail-closed）
//
// 呼び出し形態:
//   - Lambda Function URL (HTTPS): event.requestContext.http あり → HTTPラップで返す
//   - Alexa Skills Kit トリガー直結:  event 自体が Alexa リクエスト → レスポンスObjをそのまま返す
//
// ⚠ 署名検証(Signature/SignatureCertChainUrl)は未実装。fail-closed の appId 一致 +
//   timestamp 鮮度(150s) で守る。ストア公開申請する場合は署名検証を足すこと。

const BACKEND = "https://atsm.wtf";
const MAX_POSTS = 3;
const MAX_BODY = 140;

export const handler = async (event) => {
  const isHttp = !!event?.requestContext?.http; // Function URL 経由か
  let req = event;
  if (isHttp) {
    if (event.requestContext.http.method !== "POST") {
      return http(405, { error: "POST only" });
    }
    try {
      req = JSON.parse(event.body || "{}");
    } catch {
      return reply(isHttp, speak("リクエストを読み取れませんでした。", true), 200);
    }
  }

  // appId 検証（fail-closed: 未設定でも一致しなければ拒否）
  const appId =
    req?.context?.System?.application?.applicationId ||
    req?.session?.application?.applicationId;
  const expected = process.env.ALEXA_SKILL_ID;
  if (!expected || appId !== expected) {
    return isHttp ? http(403, { error: "forbidden" }) : speak("このスキルはまだ設定中です。", true);
  }

  // timestamp 鮮度（リプレイ簡易対策）
  const ts = req?.request?.timestamp ? Date.parse(req.request.timestamp) : NaN;
  if (!Number.isNaN(ts) && Math.abs(Date.now() - ts) > 150000) {
    return isHttp ? http(400, { error: "stale" }) : speak("時間切れです。もう一度どうぞ。", true);
  }

  const type = req?.request?.type;
  const intent = req?.request?.intent?.name;

  if (type === "SessionEndedRequest") return reply(isHttp, null, 200);
  if (intent === "AMAZON.StopIntent" || intent === "AMAZON.CancelIntent") {
    return reply(isHttp, speak("また焚き火で。", true), 200);
  }
  if (intent === "AMAZON.HelpIntent") {
    return reply(isHttp, speak("「アレクサ、たきびに繋げて」で、焚き火の最新の薪を読み上げます。", false), 200);
  }

  // LaunchRequest / ReadWoodIntent / FallbackIntent → 最新の薪
  try {
    const ssml = await buildFirepitSsml();
    return reply(isHttp, speakSsml(ssml, true), 200);
  } catch (e) {
    console.error("firepit error:", e?.stack || e?.message || String(e));
    return reply(isHttp, speak("いま焚き火に繋げませんでした。少し経ってからどうぞ。", true), 200);
  }
};

async function buildFirepitSsml() {
  const token = process.env.ATSM_TOKEN || "";
  if (!token) throw new Error("ATSM_TOKEN not set");
  const auth = token.startsWith("Bearer ") ? token : `Bearer ${token}`;

  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    authorization: auth,
  };
  // Cloudflare の bot チャレンジを越えるための秘密ヘッダ（WAF skip ルールと対）
  if (process.env.TAKIBI_KEY) headers["x-takibi-key"] = process.env.TAKIBI_KEY;

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
  if (!r.ok) {
    const b = await r.text().catch(() => "");
    throw new Error("mcp " + r.status + " body=" + b.slice(0, 240));
  }
  const text = extractMcpText(await r.text());
  const posts = parsePosts(text).filter((p) => !isBot(p)).slice(0, MAX_POSTS);

  if (posts.length === 0) return "<speak>いま焚き火に新しい薪はありません。</speak>";
  const parts = [`<speak>いま焚き火には、${posts.length}本の薪。<break time="400ms"/>`];
  for (const p of posts) parts.push(`${esc(p.who)}さん。${esc(p.body)}<break time="500ms"/>`);
  parts.push("以上です。</speak>");
  return parts.join("");
}

function extractMcpText(raw) {
  let jsonStr = raw.trim();
  if (jsonStr.startsWith("event:") || jsonStr.includes("\ndata:") || jsonStr.startsWith("data:")) {
    const line = raw.split("\n").find((l) => l.startsWith("data:"));
    if (line) jsonStr = line.slice(5).trim();
  }
  const obj = JSON.parse(jsonStr);
  const content = obj?.result?.content;
  return Array.isArray(content)
    ? content.filter((c) => c.type === "text").map((c) => c.text).join("\n")
    : "";
}

function parsePosts(text) {
  const re = /\[([^\]]+)\]\s+\d{2}-\d{2}\s+\d{2}:\d{2}\s+\(id:\s*[0-9a-f-]+\)\n/g;
  const heads = [];
  let m;
  while ((m = re.exec(text)) !== null) heads.push({ name: m[1].trim(), start: m.index, bodyStart: re.lastIndex });
  const out = [];
  for (let i = 0; i < heads.length; i++) {
    const end = i + 1 < heads.length ? heads[i + 1].start : text.length;
    const body = clean(text.slice(heads[i].bodyStart, end).trim());
    if (body.length > 0) out.push({ who: surname(heads[i].name), body });
  }
  return out;
}

function isBot(p) {
  return p.body.startsWith("🤖") || p.body.startsWith("🎙");
}
function surname(name) {
  const t = name.split(/[\s　]/).filter(Boolean);
  return t.length ? t[0] : name;
}
function clean(s) {
  let t = s
    .replace(/https?:\/\/\S+/g, "")
    .replace(/`[^`]*`/g, "")
    .replace(/[#>*_~|]/g, " ")
    .replace(/[\r\n]+/g, "、")
    .replace(/[ \t　]+/g, " ")
    .trim();
  if (t.length > MAX_BODY) t = t.slice(0, MAX_BODY) + "、以下略";
  return t;
}
function esc(s) {
  return String(s).replace(/&/g, "＆").replace(/</g, "〈").replace(/>/g, "〉").replace(/"/g, "”");
}
function speak(text, end) {
  return speakSsml("<speak>" + esc(text) + "</speak>", end);
}
function speakSsml(ssml, end) {
  return { version: "1.0", response: { outputSpeech: { type: "SSML", ssml }, shouldEndSession: end !== false } };
}
// Function URL 用 HTTP ラップ
function http(statusCode, obj) {
  return { statusCode, headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify(obj) };
}
function reply(isHttp, alexaObj, statusCode) {
  if (!isHttp) return alexaObj; // ASK トリガー直結
  if (alexaObj === null) return { statusCode: 200, body: "" };
  return { statusCode, headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify(alexaObj) };
}
