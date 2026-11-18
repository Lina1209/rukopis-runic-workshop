const ALLOWED_ORIGINS = new Set([
  "https://headless-corhincross-mila997-1407.wix-site-host.com",
  "https://mirror-info.forum2x2.ru"
]);

const GOOGLE_TRANSLATE_URL = "https://translation.googleapis.com/language/translate/v2";
const MAX_TEXT_LENGTH = 5000;
const MAX_BATCH_SIZE = 20;

function corsHeaders(origin) {
  const headers = {
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400"
  };

  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  return headers;
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function validLanguage(value) {
  return typeof value === "string" && /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})?$/.test(value);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");

    if (request.method === "OPTIONS") {
      if (origin && !ALLOWED_ORIGINS.has(origin)) {
        return new Response(null, { status: 403 });
      }
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      return json({ error: "Origin is not allowed." }, 403, null);
    }

    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return json({
        service: "Rukopis Google Translate API",
        status: "online",
        method: "POST /translate"
      }, 200, origin);
    }

    if (request.method !== "POST" || url.pathname !== "/translate") {
      return json({ error: "Use POST /translate." }, 404, origin);
    }

    if (!env.GOOGLE_TRANSLATE_API_KEY) {
      return json({ error: "Translation service is not configured." }, 503, origin);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Request body must be valid JSON." }, 400, origin);
    }

    const q = body?.q;
    const target = body?.target;
    const source = body?.source;

    const texts = Array.isArray(q) ? q : [q];

    if (
      texts.length < 1 ||
      texts.length > MAX_BATCH_SIZE ||
      texts.some((item) => typeof item !== "string" || item.length === 0 || item.length > MAX_TEXT_LENGTH)
    ) {
      return json({
        error: "Text must contain 1–20 non-empty strings, each up to 5000 characters."
      }, 400, origin);
    }

    if (!validLanguage(target) || (source !== undefined && source !== "auto" && !validLanguage(source))) {
      return json({ error: "Invalid source or target language code." }, 400, origin);
    }

    const googleBody = new URLSearchParams();
    for (const item of texts) googleBody.append("q", item);
    googleBody.set("target", target);
    googleBody.set("format", body.format === "html" ? "html" : "text");
    if (source && source !== "auto") googleBody.set("source", source);

    let googleResponse;
    try {
      googleResponse = await fetch(
        `${GOOGLE_TRANSLATE_URL}?key=${encodeURIComponent(env.GOOGLE_TRANSLATE_API_KEY)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
          body: googleBody.toString()
        }
      );
    } catch {
      return json({ error: "Could not reach the translation provider." }, 502, origin);
    }

    let result;
    try {
      result = await googleResponse.json();
    } catch {
      return json({ error: "The translation provider returned an invalid response." }, 502, origin);
    }

    if (!googleResponse.ok) {
      const providerMessage = result?.error?.message;
      return json({
        error: "Translation request failed.",
        details: typeof providerMessage === "string" ? providerMessage.slice(0, 300) : undefined
      }, googleResponse.status === 429 ? 429 : 502, origin);
    }

    const translations = result?.data?.translations;
    if (!Array.isArray(translations) || translations.length !== texts.length) {
      return json({ error: "Unexpected translation response." }, 502, origin);
    }

    return json({
      translations: translations.map((item) => ({
        translatedText: item.translatedText,
        detectedSourceLanguage: item.detectedSourceLanguage || null
      }))
    }, 200, origin);
  }
};
