// MiniMax TTS Cloudflare Worker 代理
// 解决浏览器直接调 MiniMax API 的 CORS 问题
//
// 环境变量（可选）：
//   AUTH_KEY - 鉴权密钥，设置后请求需带 Authorization: Bearer <key>

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

    // Worker 鉴权（防止被滥用）
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
      const { groupId, apiKey, domain, requestBody } = body;

      if (!groupId || !apiKey || !requestBody) {
        return new Response(JSON.stringify({ error: '缺少必要参数 (groupId, apiKey, requestBody)' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders() }
        });
      }

      const apiDomain = domain || 'api.minimax.chat';
      const apiUrl = `https://${apiDomain}/v1/t2a_v2?GroupId=${groupId}`;

      // 转发请求到 MiniMax
      const apiResponse = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + apiKey
        },
        body: JSON.stringify(requestBody)
      });

      const responseData = await apiResponse.text();

      return new Response(responseData, {
        status: apiResponse.status,
        headers: {
          'Content-Type': 'application/json',
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
