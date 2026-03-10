// Edge TTS Cloudflare Worker
// 通过 Microsoft Translator 端点获取 token，再调 Azure TTS REST API
// 无需 WebSocket，纯 HTTP 请求
//
// 环境变量（可选）：
//   AUTH_KEY - 鉴权密钥，设置后请求需带 Authorization: Bearer <key>

const OUTPUT_FORMAT = 'audio-24khz-48kbitrate-mono-mp3';
const TOKEN_REFRESH_BEFORE_EXPIRY = 5 * 60; // 提前5分钟刷新token

let tokenInfo = {
  endpoint: null,
  token: null,
  expiredAt: null
};

// ---- Token 获取 ----

async function hmacSha256(key, data) {
  const cryptoKey = await crypto.subtle.importKey(
    'raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data));
  return new Uint8Array(sig);
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes) {
  return btoa(String.fromCharCode(...bytes));
}

function uuid() {
  return crypto.randomUUID().replace(/-/g, '');
}

function dateFormat() {
  return new Date().toUTCString().replace(/GMT/, '').trim() + ' GMT';
}

async function sign(urlStr) {
  const url = urlStr.split('://')[1];
  const encodedUrl = encodeURIComponent(url);
  const uuidStr = uuid();
  const date = dateFormat();
  const bytesToSign = `MSTranslatorAndroidApp${encodedUrl}${date}${uuidStr}`.toLowerCase();
  const key = base64ToBytes('oik6PdDdMnOXemTbwvMn9de/h9lFnfBaCWbGMMZqqoSaQaqUOqjVGm5NqsmjcBI1x+sS9ugjB55HEJWRiFXYFw==');
  const signData = await hmacSha256(key, bytesToSign);
  const signBase64 = bytesToBase64(signData);
  return `MSTranslatorAndroidApp::${signBase64}::${date}::${uuidStr}`;
}

async function getEndpoint() {
  const now = Date.now() / 1000;

  // 使用缓存的 token（提前5分钟刷新）
  if (tokenInfo.token && tokenInfo.expiredAt && now < tokenInfo.expiredAt - TOKEN_REFRESH_BEFORE_EXPIRY) {
    return tokenInfo.endpoint;
  }

  const endpointUrl = 'https://dev.microsofttranslator.com/apps/endpoint?api-version=1.0';
  const clientId = uuid();

  const response = await fetch(endpointUrl, {
    method: 'POST',
    headers: {
      'Accept-Language': 'zh-Hans',
      'X-ClientVersion': '4.0.530a 5fe1dc6c',
      'X-UserId': '0f04d16a175c411e',
      'X-HomeGeographicRegion': 'zh-Hans-CN',
      'X-ClientTraceId': clientId,
      'X-MT-Signature': await sign(endpointUrl),
      'User-Agent': 'okhttp/4.5.0',
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': '0',
    }
  });

  if (!response.ok) {
    throw new Error('获取 token 失败: HTTP ' + response.status);
  }

  const data = await response.json();
  const jwt = data.t.split('.')[1];
  const decoded = JSON.parse(atob(jwt));

  tokenInfo = {
    endpoint: data,
    token: data.t,
    expiredAt: decoded.exp
  };

  return data;
}

// ---- TTS 合成 ----

function escapeXml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildSSML(text, voice, rate, pitch, volume) {
  return `<speak xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="http://www.w3.org/2001/mstts" version="1.0" xml:lang="zh-CN">
  <voice name="${voice}">
    <prosody rate="${rate}" pitch="${pitch}" volume="${volume}">${escapeXml(text)}</prosody>
  </voice>
</speak>`;
}

async function synthesize(text, voice, rate, pitch, volume) {
  const ep = await getEndpoint();
  const url = `https://${ep.r}.tts.speech.microsoft.com/cognitiveservices/v1`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': ep.t,
      'Content-Type': 'application/ssml+xml',
      'User-Agent': 'okhttp/4.5.0',
      'X-Microsoft-OutputFormat': OUTPUT_FORMAT,
    },
    body: buildSSML(text, voice, rate, pitch, volume)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`TTS 合成失败: HTTP ${response.status} ${errText}`);
  }

  return response.arrayBuffer();
}

// ---- CORS ----

function handleCORS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    }
  });
}

function corsHeaders() {
  return { 'Access-Control-Allow-Origin': '*' };
}

// ---- 入口 ----

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return handleCORS();
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: '仅支持 POST 请求' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() }
      });
    }

    // 鉴权
    if (env.AUTH_KEY) {
      const auth = request.headers.get('Authorization');
      if (!auth || auth !== `Bearer ${env.AUTH_KEY}`) {
        return new Response(JSON.stringify({ error: '鉴权失败' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...corsHeaders() }
        });
      }
    }

    try {
      const body = await request.json();
      const {
        text,
        voice = 'zh-CN-XiaoxiaoNeural',
        rate = '+0%',
        pitch = '+0Hz',
        volume = '+0%'
      } = body;

      if (!text || !text.trim()) {
        return new Response(JSON.stringify({ error: '缺少 text 参数' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders() }
        });
      }

      const audioBuffer = await synthesize(text.trim(), voice, rate, pitch, volume);

      return new Response(audioBuffer, {
        status: 200,
        headers: {
          'Content-Type': 'audio/mpeg',
          ...corsHeaders()
        }
      });

    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() }
      });
    }
  }
};
