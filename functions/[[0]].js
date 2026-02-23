const ALLOWED_ROOT_DOMAIN = "vicdn.cc";
const HOST_RE = /^x([0-9]{3})\.vicdn\.cc$/i;

export async function onRequest(context) {
  const { request } = context;
  const cache = caches.default;

  const url = new URL(request.url);

  /* =========================
     0. CACHE KEY (URL ONLY)
     ========================= */

  const cacheKey = new Request(url.toString(), { method: "GET" });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  /* =========================
     1. PATH CHECK
     ========================= */

  const pathname = url.pathname.replace(/^\/+/, "");
  const lower = pathname.toLowerCase();

  if (!pathname) {
    return new Response("Not found", { status: 404 });
  }

  const isM3u8 = lower.endsWith(".m3u8");
  const isPng  = lower.endsWith(".png");
  const isJPG  = lower.endsWith(".jpg");
  const isVTT  = lower.endsWith(".vtt");

  /* =========================
     2. REFERER PROTECTION
     ========================= */

  const referer = request.headers.get("Referer");

  if (isM3u8 && !referer) {
    return new Response("Forbidden", { status: 403 });
  }

  if (referer) {
    let refHost;
    try {
      refHost = new URL(referer).hostname;
    } catch {
      return new Response("Forbidden", { status: 403 });
    }

    if (
      refHost !== ALLOWED_ROOT_DOMAIN &&
      !refHost.endsWith("." + ALLOWED_ROOT_DOMAIN)
    ) {
      return new Response("Forbidden", { status: 403 });
    }
  }

  /* =========================
     3. HOST → SHARD
     ========================= */

  const hostMatch = url.hostname.match(HOST_RE);
  if (!hostMatch) {
    return new Response("Forbidden", { status: 403 });
  }

  const shardId = hostMatch[1];

  /* =========================
     4. INDEX REDIRECT
     ========================= */

  if (lower === "index.html") {
    return Response.redirect("https://vicdn.cc/", 302);
  }

  /* =========================
     5. VIDEO ID
     ========================= */

  let videoId;

  if (isM3u8) {
    videoId = pathname.slice(0, -5);
  } else if (isJPG || isVTT) {
    videoId = pathname.slice(0, -4);
  } else if (isPng) {
    const match = pathname.match(/^((?:tv|mv)-\d+-\d+-\d+)-index/i);
    if (!match) {
      return new Response("Forbidden", { status: 403 });
    }
    videoId = match[1];
  } else {
    return new Response("Forbidden", { status: 403 });
  }

  /* =========================
     6. ORIGIN URL
     ========================= */

  const originUrl =
    `https://${videoId}.x${shardId}-vicdn-cc.pages.dev/${pathname}`;

  /* =========================
     7. FETCH ORIGIN (TÁCH RIÊNG PNG / M4S)
     ========================= */

let originRes;

try {
  originRes = await fetch(originUrl);
} catch (err) {
  return new Response("Bad Gateway", { status: 502 });
}

if (!originRes.ok) {
  return new Response("Not found", { status: 404 });
}

  /* =========================
     8. RESPONSE + CACHE
     ========================= */

  const res = new Response(originRes.body, originRes);

  res.headers.set(
    "Cache-Control",
    "public, max-age=31536000, immutable"
  );
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Access-Control-Allow-Origin", "*");
 
  if (res.status === 200) {
  await cache.put(cacheKey, res.clone());
  }
  return res;
}
